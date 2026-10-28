import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * PATCH /api/v1/admin/tenants/[id]/members/[userId]/password — o admin da
 * PLATAFORMA define a senha de um membro (emergência). A guarda de quem
 * administra é a de verdade (`requirePlatformAdminEscrita`), com a linha de
 * `platform_admins` controlada aqui; o resto do banco é falso.
 */

const g = vi.hoisted(() => ({
  linhaDoAdmin: null as Record<string, unknown> | null,
  mfaEmDivida: vi.fn(async () => false),
}));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`redirect:${destino}`);
  },
}));
vi.mock("@/lib/auth/server", () => ({ mfaEmDividaEstrita: g.mfaEmDivida }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "11111111-1111-4111-8111-111111111111" } } }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1" } }) },
    },
    from: () => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.is = () => c;
      c.maybeSingle = async () => ({ data: g.linhaDoAdmin, error: null });
      return c;
    },
  }),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/email/roteador", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/branding/saida", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  marcaDaSaida: vi.fn(async () => ({
    nome: "Marca X",
    logoUrl: null,
    accent: "#123456",
    accentFg: "#ffffff",
  })),
}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/email/roteador";
import { createAdminClient } from "@/lib/supabase/admin";

import { PATCH } from "./route";

const ORG = "22222222-2222-4222-8222-222222222222";
const ALVO = "33333333-3333-4333-8333-333333333333";
const ADMIN = "11111111-1111-4111-8111-111111111111";
const SENHA = "Nova-Senha-Forte-123";

let updateUserById: ReturnType<typeof vi.fn>;

function adminFalso(
  opts: {
    membro?: boolean;
    ehAdminDaPlataforma?: boolean;
    erroNoUpdate?: { code?: string; message: string };
  } = {},
) {
  updateUserById = vi.fn(async () => ({
    data: opts.erroNoUpdate
      ? null
      : { user: { id: ALVO, email: "membro@empresa.com", user_metadata: {} } },
    error: opts.erroNoUpdate ?? null,
  }));
  const leitura = (data: unknown) => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.is = () => b;
    b.maybeSingle = async () => ({ data, error: null });
    return b;
  };
  vi.mocked(createAdminClient).mockReturnValue({
    from: (tabela: string) => {
      if (tabela === "user_organizations")
        return leitura(opts.membro === false ? null : { id: "m1" });
      if (tabela === "platform_admins")
        return leitura(opts.ehAdminDaPlataforma ? { user_id: ALVO } : null);
      return leitura({ timezone: "America/Sao_Paulo" });
    },
    auth: { admin: { updateUserById } },
  } as never);
}

function pedido(password: unknown = SENHA) {
  return PATCH(
    new NextRequest(`http://x/api/v1/admin/tenants/${ORG}/members/${ALVO}/password`, {
      method: "PATCH",
      body: JSON.stringify({ password }),
    }),
    { params: Promise.resolve({ id: ORG, userId: ALVO }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  g.linhaDoAdmin = { user_id: ADMIN, scope: "full", mfa_required: false, revoked_at: null };
  vi.mocked(sendEmail).mockResolvedValue({ ok: true } as never);
});

describe("admin da plataforma define a senha de um membro", () => {
  it("⭐ troca a senha, avisa o dono da conta e audita sem a senha", async () => {
    adminFalso();
    const res = await pedido();

    expect(res.status).toBe(200);
    expect(updateUserById).toHaveBeenCalledWith(ALVO, { password: SENHA });
    expect(vi.mocked(sendEmail).mock.calls[0]![0].to).toBe("membro@empresa.com");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "member.password_set_by_platform_admin",
        actorUserId: ADMIN,
        actingAsPlatformAdmin: true,
        organizationId: ORG,
        resourceId: ALVO,
      }),
    );
    const tudo = JSON.stringify([
      vi.mocked(audit).mock.calls,
      vi.mocked(sendEmail).mock.calls,
      await res.json(),
    ]);
    expect(tudo).not.toContain(SENHA);
  });

  it("aviso que não saiu não desfaz a troca, e a resposta diz que não saiu", async () => {
    adminFalso();
    vi.mocked(sendEmail).mockResolvedValue({ ok: false, error: "not_configured" } as never);
    const res = await pedido();

    expect(res.status).toBe(200);
    expect((await res.json()).data.aviso_ao_dono).toBe("sem_envio_configurado");
  });

  it("senha curta é recusada antes do provedor", async () => {
    adminFalso();
    const res = await pedido("curta");
    expect(res.status).toBe(400);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("a senha de outro administrador da plataforma não se troca por aqui", async () => {
    adminFalso({ ehAdminDaPlataforma: true });
    const res = await pedido();
    expect(res.status).toBe(403);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("quem não é membro ativo deste tenant não tem a senha trocada", async () => {
    adminFalso({ membro: false });
    const res = await pedido();
    expect(res.status).toBe(404);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("senha fraca recusada pelo provedor volta como 400, sem auditoria", async () => {
    adminFalso({ erroNoUpdate: { code: "weak_password", message: "weak" } });
    const res = await pedido();
    expect(res.status).toBe(400);
    expect(audit).not.toHaveBeenCalled();
  });

  it("CONTROLE — admin da plataforma só-leitura não passa", async () => {
    adminFalso();
    g.linhaDoAdmin = {
      user_id: ADMIN,
      scope: "support_readonly",
      mfa_required: false,
      revoked_at: null,
    };
    const res = await pedido();
    expect(res.status).toBe(403);
    expect(updateUserById).not.toHaveBeenCalled();
  });
});
