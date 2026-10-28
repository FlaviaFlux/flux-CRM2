import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/team/[user_id]/password-reset — quem administra a organização
 * manda a um membro o link para ele definir uma nova senha.
 *
 * ─── Por que um LINK, e não "definir a senha" ───────────────────────────────
 *
 * Um login pode estar em mais de uma organização. Se o admin DESTA escolhesse a
 * senha, mudaria o acesso da pessoa às outras e passaria a conhecer a senha de
 * uma conta que não é só dele. O link vai ao e-mail do próprio membro: o admin
 * não vê nem escolhe nada, e a senha atual vale até a pessoa trocar. Definir a
 * senha direto é poder de quem administra a PLATAFORMA
 * (`/api/v1/admin/tenants/[id]/members/[userId]/password`).
 *
 * ─── Por que o link sai daqui, e não do "Esqueci a senha" do provedor ───────
 *
 * `resetPasswordForEmail` manda o e-mail pelo modelo gravado no provedor de
 * autenticação. Com o modelo padrão, o link carrega um `code` PKCE cujo
 * verificador mora num cookie do navegador que PEDIU — aqui, o do admin —, e o
 * membro nunca conseguiria abri-lo. `generateLink` só GERA o link (não envia), e
 * nós o mandamos no formato `token_hash`, que não depende de cookie nenhum e
 * passa pela tela "Continuar" de `/auth/confirm` (verificador de link de webmail
 * não gasta o token).
 *
 * ─── Guardas ────────────────────────────────────────────────────────────────
 *
 *  - admin da organização ativa (requireRole), membro ATIVO dela, e não a si
 *    mesmo (para si há "Esqueci a senha");
 *  - o mesmo teto por e-mail do "Esqueci a senha" (`AUTH_LIMITS.reset`): sem ele,
 *    a rota viraria disparador de e-mail contra a caixa do membro;
 *  - sem envio de e-mail configurado, recusa ANTES de gerar o link — gerar e não
 *    mandar deixaria um token válido sem dono.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit, hashEmail } from "@/lib/audit";
import { authRateLimited, AUTH_LIMITS } from "@/lib/auth/rate-limit";
import { requireRole } from "@/lib/auth/require-role";
import { marcaDaSaida } from "@/lib/branding/saida";
import { emailConfigurado, sendEmail } from "@/lib/email/roteador";
import { buildRedefinicaoPelaEquipe } from "@/lib/email/templates/redefinicao-pela-equipe";
import { env } from "@/lib/env";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ user_id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { user_id: targetUserId } = await ctx.params;

  const authz = await requireRole("admin", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user: authUser, org: activeOrg } = authz;

  if (targetUserId === authUser.id) {
    return fail(
      "state_conflict",
      t(
        'Para a sua própria senha, use "Esqueci a senha" na tela de login ou troque em Configurações › Segurança.',
      ),
      409,
      { requestId },
    );
  }

  const supabase = await createClient();
  const { data: target, error: fetchErr } = await supabase
    .from("user_organizations")
    .select("id, user_id, revoked_at")
    .eq("organization_id", activeOrg.orgId)
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (fetchErr) return fail("internal_error", fetchErr.message, 500, { requestId });
  if (!target) return fail("not_found", t("Membro não encontrado."), 404, { requestId });
  if (target.revoked_at) {
    return fail("state_conflict", t("Membro está revogado."), 409, { requestId });
  }

  const admin = createAdminClient();
  const { data: lido, error: lerErr } = await admin.auth.admin.getUserById(targetUserId);
  const email = (lido?.user?.email ?? "").toLowerCase();
  if (lerErr || !email) {
    return fail("state_conflict", t("Este membro não tem e-mail de login."), 409, { requestId });
  }

  if (!(await emailConfigurado())) {
    return fail(
      "state_conflict",
      t(
        "O envio de e-mail não está configurado nesta instalação, então o link não teria como chegar.",
      ),
      409,
      { requestId },
    );
  }

  if (await authRateLimited("reset", email, AUTH_LIMITS.reset)) {
    return fail(
      "rate_limited",
      t("Muitos links de redefinição para esta pessoa na última hora. Tente mais tarde."),
      429,
      { requestId },
    );
  }

  const { data: gerado, error: gerarErr } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  const tokenHash = gerado?.properties?.hashed_token;
  if (gerarErr || !tokenHash) {
    logger.error("[team.password-reset] generateLink falhou", {
      requestId,
      organization_id: activeOrg.orgId,
      erro: gerarErr?.message,
    });
    return fail("internal_error", t("Não foi possível gerar o link agora."), 500, { requestId });
  }

  const link = new URL("/auth/confirm", env.NEXT_PUBLIC_APP_URL);
  link.searchParams.set("type", "recovery");
  link.searchParams.set("token_hash", tokenHash);

  const idioma = normalizarIdioma(
    typeof lido.user?.user_metadata?.locale === "string" ? lido.user.user_metadata.locale : null,
  );
  const marca = await marcaDaSaida(activeOrg.orgId, { semMemo: true });
  const corpo = buildRedefinicaoPelaEquipe({ marca, link: link.toString(), idioma });
  const envio = await sendEmail({ to: email, fromName: marca.nome, ...corpo });
  if (!envio.ok) {
    logger.warn("[team.password-reset] e-mail não saiu", {
      requestId,
      organization_id: activeOrg.orgId,
      erro: envio.error,
    });
    return fail(
      "internal_error",
      t("O e-mail com o link não pôde ser enviado. Tente de novo."),
      502,
      {
        requestId,
      },
    );
  }

  await audit({
    action: "member.password_reset_link_sent",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "membership",
    resourceId: target.id,
    requestId,
    metadata: {
      target_user_id: targetUserId,
      email_hash: hashEmail(email),
      via: envio.via ?? null,
    },
  });

  return ok({ user_id: targetUserId, sent: true }, { requestId });
}
