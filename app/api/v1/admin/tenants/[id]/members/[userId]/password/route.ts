/**
 * PATCH /api/v1/admin/tenants/[id]/members/[userId]/password — o administrador
 * da PLATAFORMA define a senha de um membro, para a emergência de quem ficou
 * trancado para fora (e-mail não chega, link não abre).
 *
 * É o poder que o admin da ORGANIZAÇÃO não tem de propósito: um login pode estar
 * em várias organizações, e quem escolhe a senha passa a conhecer a conta
 * inteira. Lá o caminho é mandar o link (`/api/v1/team/[user_id]/password-reset`).
 *
 * Mesmas guardas da troca de e-mail ao lado (`../email/route.ts`): membro ATIVO
 * deste tenant, e nunca outro administrador da plataforma — esse só o próprio
 * dono muda. Depois de trocar, avisa o dono da conta por e-mail (melhor esforço:
 * sem envio configurado, a troca vale e a auditoria registra que o aviso não
 * saiu). A senha nunca vai para log, auditoria nem resposta.
 *
 * O que NÃO faz: encerrar as sessões abertas da pessoa. O provedor só encerra
 * sessão a partir do token dela; quem precisa disso usa "Sair de todos os
 * aparelhos" depois de entrar com a senha nova.
 */
import { type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import {
  falhaDaEscritaDePlatformAdmin,
  requirePlatformAdminEscrita,
  type PlatformAdminContext,
} from "@/lib/auth/requirePlatformAdmin";
import { marcaDaSaida } from "@/lib/branding/saida";
import { sendEmail } from "@/lib/email/roteador";
import { buildAvisoDeSenhaDefinida } from "@/lib/email/templates/redefinicao-pela-equipe";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { FUSO_PADRAO, fusoValido } from "@/lib/tempo/fusos";

const bodySchema = z.object({
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres").max(72),
});

type AvisoAoDono = "enviado" | "sem_envio_configurado" | "sem_email" | "falhou";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const requestId = randomUUID();
  const { id, userId } = await params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(userId).success) {
    return fail("not_found", "Membro não encontrado", 404, { requestId });
  }

  const supportDenied = await requireSupportWrite(id);
  if (supportDenied) return supportDenied;

  let adminCtx: PlatformAdminContext;
  try {
    adminCtx = await requirePlatformAdminEscrita();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }

  let password: string;
  try {
    password = bodySchema.parse(await req.json()).password;
  } catch {
    return fail("validation_failed", "A senha precisa ter entre 8 e 72 caracteres.", 400, {
      requestId,
    });
  }

  const admin = createAdminClient();
  const [lidoVinculo, lidoAdmin, lidoOrg] = await Promise.all([
    admin
      .from("user_organizations")
      .select("id")
      .eq("user_id", userId)
      .eq("organization_id", id)
      .is("revoked_at", null)
      .maybeSingle(),
    admin
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .maybeSingle(),
    admin.from("organizations").select("timezone").eq("id", id).maybeSingle(),
  ]);
  const erroDeLeitura = lidoVinculo.error ?? lidoAdmin.error ?? lidoOrg.error;
  if (erroDeLeitura) {
    logger.error("[admin.members.password] leitura das guardas falhou; senha NÃO trocada", {
      requestId,
      organization_id: id,
      erro: erroDeLeitura.message,
    });
    return fail("internal_error", "Não foi possível trocar a senha agora.", 500, { requestId });
  }
  if (!lidoVinculo.data) {
    return fail("not_found", "Membro sem acesso ativo neste tenant.", 404, { requestId });
  }
  if (lidoAdmin.data) {
    return fail(
      "forbidden",
      "A senha de um administrador da plataforma não se troca por aqui: só o próprio dono da conta pode mudá-la.",
      403,
      { requestId },
    );
  }

  const { data: atualizado, error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "weak_password" || code === "validation_failed") {
      return fail(
        "validation_failed",
        "O provedor de autenticação recusou esta senha. Escolha uma mais forte.",
        400,
        {
          requestId,
        },
      );
    }
    logger.error("[admin.members.password] updateUserById falhou", {
      requestId,
      organization_id: id,
      erro: error.message,
    });
    return fail("internal_error", "Não foi possível trocar a senha agora.", 500, { requestId });
  }

  let avisoAoDono: AvisoAoDono = "sem_email";
  const email = atualizado?.user?.email ?? "";
  if (email) {
    try {
      const idioma = normalizarIdioma(
        typeof atualizado.user.user_metadata?.locale === "string"
          ? atualizado.user.user_metadata.locale
          : null,
      );
      const fuso = lidoOrg.data?.timezone;
      const data = new Intl.DateTimeFormat(idioma, {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: fuso && fusoValido(fuso) ? fuso : FUSO_PADRAO,
      }).format(new Date());
      const marca = await marcaDaSaida(id, { semMemo: true });
      const envio = await sendEmail({
        to: email,
        fromName: marca.nome,
        ...buildAvisoDeSenhaDefinida({ marca, data, idioma }),
      });
      avisoAoDono = envio.ok
        ? "enviado"
        : envio.error === "not_configured"
          ? "sem_envio_configurado"
          : "falhou";
    } catch (err) {
      avisoAoDono = "falhou";
      logger.warn("[admin.members.password] aviso ao dono lançou", {
        requestId,
        organization_id: id,
        erro: err instanceof Error ? err.message : String(err),
      });
    }
  }

  void audit({
    action: "member.password_set_by_platform_admin",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: id,
    resourceType: "user",
    resourceId: userId,
    requestId,
    metadata: { aviso_ao_dono: avisoAoDono },
  });

  return ok({ user_id: userId, aviso_ao_dono: avisoAoDono }, { requestId });
}
