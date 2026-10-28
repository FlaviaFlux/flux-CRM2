import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { authRateLimited } from "@/lib/auth/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailConfigurado, sendEmail } from "@/lib/email/roteador";
import { audit } from "@/lib/audit";

/**
 * POST /api/v1/team/[user_id]/password-reset — o admin da organização manda a
 * um membro o link para ele definir uma nova senha.
 *
 * O link sai no formato `token_hash`, gerado pela API administrativa e enviado
 * por nós: o "Esqueci a senha" do provedor, com o modelo padrão, manda um `code`
 * PKCE cujo verificador ficaria no cookie do ADMIN — o membro nunca abriria.
 */

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/auth/rate-limit", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  authRateLimited: vi.fn(async () => false),
}));
vi.mock("@/lib/email/roteador", () => ({
  emailConfigurado: vi.fn(async () => true),
  sendEmail: vi.fn(async () => ({ ok: true, via: "resend" })),
}));
vi.mock("@/lib/branding/saida", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  marcaDaSaida: vi.fn(async () => ({
    nome: "Flux Leads",
    accent: "#2563eb",
    accentFg: "#ffffff",
    logoUrl: null,
  })),
}));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://crm.exemplo.com.br" } }));
vi.mock("@/lib/audit", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  audit: vi.fn(async () => undefined),
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const ALVO = "33333333-3333-4333-8333-333333333333";
const TOKEN = "f0e1d2c3b4a5968778695a4b3c2d1e0f";

let generateLink: ReturnType<typeof vi.fn>;

function cenario({
  vinculo = { id: "m1", user_id: ALVO, revoked_at: null } as unknown,
  email = "Membro@Empresa.com" as string | null,
} = {}) {
  vi.mocked(createClient).mockResolvedValue({
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: vinculo, error: null }) }) }),
      }),
    }),
  } as never);
  generateLink = vi.fn(async () => ({
    data: { properties: { hashed_token: TOKEN } },
    error: null,
  }));
  vi.mocked(createAdminClient).mockReturnValue({
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({
          data: { user: { id: ALVO, email, user_metadata: {} } },
          error: null,
        })),
        generateLink,
      },
    },
  } as never);
}

function pedido() {
  return new NextRequest("http://localhost/api/v1/team/x/password-reset", { method: "POST" });
}
const ctx = (userId = ALVO) => ({ params: Promise.resolve({ user_id: userId }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: ADMIN, idioma: "pt-BR" },
    org: { orgId: ORG },
  } as never);
  vi.mocked(emailConfigurado).mockResolvedValue(true);
  vi.mocked(authRateLimited).mockResolvedValue(false);
  vi.mocked(sendEmail).mockResolvedValue({ ok: true, via: "resend" } as never);
});

describe("link de redefinição de senha pela equipe", () => {
  it("⭐ manda ao e-mail do membro o link token_hash da instalação", async () => {
    cenario();
    const { POST } = await import("./route");

    const res = await POST(pedido(), ctx());
    expect(res.status).toBe(200);
    expect(generateLink).toHaveBeenCalledWith({ type: "recovery", email: "membro@empresa.com" });

    const enviado = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(enviado.to).toBe("membro@empresa.com");
    const esperado = `https://crm.exemplo.com.br/auth/confirm?type=recovery&amp;token_hash=${TOKEN}`;
    expect(enviado.html).toContain(`href="${esperado}"`);
    expect(enviado.text).toContain(
      `https://crm.exemplo.com.br/auth/confirm?type=recovery&token_hash=${TOKEN}`,
    );
  });

  it("o token não sai na resposta nem na auditoria — só o dono da caixa o vê", async () => {
    cenario();
    const { POST } = await import("./route");
    const res = await POST(pedido(), ctx());

    expect(JSON.stringify(await res.json())).not.toContain(TOKEN);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "member.password_reset_link_sent",
        actorUserId: ADMIN,
        organizationId: ORG,
        metadata: expect.objectContaining({ target_user_id: ALVO }),
      }),
    );
    expect(JSON.stringify(vi.mocked(audit).mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(vi.mocked(audit).mock.calls)).not.toContain("membro@empresa.com");
  });

  it("sem envio de e-mail configurado, recusa ANTES de gerar o link", async () => {
    // Gerar e não mandar deixaria um token válido sem dono.
    cenario();
    vi.mocked(emailConfigurado).mockResolvedValue(false);
    const { POST } = await import("./route");

    const res = await POST(pedido(), ctx());
    expect(res.status).toBe(409);
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("respeita o teto do 'Esqueci a senha' por e-mail", async () => {
    cenario();
    vi.mocked(authRateLimited).mockResolvedValue(true);
    const { POST } = await import("./route");

    const res = await POST(pedido(), ctx());
    expect(res.status).toBe(429);
    expect(vi.mocked(authRateLimited).mock.calls[0]![1]).toBe("membro@empresa.com");
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("e-mail que não saiu é erro, e não vira auditoria de 'enviado'", async () => {
    cenario();
    vi.mocked(sendEmail).mockResolvedValue({ ok: false, error: "provider_error" } as never);
    const { POST } = await import("./route");

    const res = await POST(pedido(), ctx());
    expect(res.status).toBe(502);
    expect(audit).not.toHaveBeenCalled();
  });

  it("para a própria senha, aponta o caminho de sempre", async () => {
    cenario();
    const { POST } = await import("./route");

    const res = await POST(pedido(), ctx(ADMIN));
    expect(res.status).toBe(409);
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("membro revogado ou de outra organização não recebe link", async () => {
    cenario({ vinculo: { id: "m1", user_id: ALVO, revoked_at: "2026-10-01T00:00:00Z" } });
    const { POST } = await import("./route");
    expect((await POST(pedido(), ctx())).status).toBe(409);

    cenario({ vinculo: null });
    expect((await POST(pedido(), ctx())).status).toBe(404);
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("CONTROLE — só admin da organização passa", async () => {
    cenario();
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 403 }),
    } as never);
    const { POST } = await import("./route");

    const res = await POST(pedido(), ctx());
    expect(res.status).toBe(403);
    expect(generateLink).not.toHaveBeenCalled();
  });
});
