/**
 * GET /api/v1/campaigns/:id/metrics — a leitura PAGINADA contra o teto do PostgREST.
 *
 * `max_rows = 1000` (`supabase/config.toml`) cortava o `.limit(20_000)` em 1000
 * linhas caladas. Medido em produção: lista de 1485, e a barra de progresso
 * contava 225 enviadas + 758 pendentes + 37 falhas — a soma não fechava com a
 * lista. O falso abaixo impõe esse teto em TODA resposta. A régua da CONTA
 * mora em `lib/campanhas/metricas.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import type { AuthUser } from "@/lib/auth/types";
import type { ContagemDaCampanha } from "@/lib/campanhas/metricas";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const CAMPANHA = "33333333-3333-4333-8333-333333333333";

/** `max_rows = 1000` do PostgREST: o corte é do SERVIDOR, não do `.limit()`. */
const MAX_ROWS = 1000;

type Linha = Record<string, unknown>;

function fakeSupabase(linhas: Linha[]) {
  const faixas: Array<[number, number]> = [];
  const client = {
    from() {
      let pediuCount = false;
      const executar = (faixa: [number, number] | null) => {
        const fatia = faixa ? linhas.slice(faixa[0], faixa[1] + 1) : linhas;
        return {
          data: fatia.slice(0, MAX_ROWS),
          count: pediuCount ? linhas.length : null,
          error: null,
        };
      };
      const builder: Record<string, unknown> = {};
      builder.select = (_c: string, opcoes?: { count?: string }) => {
        pediuCount = opcoes?.count === "exact";
        return builder;
      };
      builder.eq = () => builder;
      builder.order = () => builder;
      builder.range = (inicio: number, fim: number) => {
        faixas.push([inicio, fim]);
        return Promise.resolve(executar([inicio, fim]));
      };
      builder.limit = () => Promise.resolve(executar(null));
      builder.maybeSingle = () => Promise.resolve({ data: { id: CAMPANHA }, error: null });
      return builder;
    },
  };
  return { client, faixas };
}

function destinatario(i: number, status: string, enviado = false): Linha {
  return {
    id: `r${String(i).padStart(5, "0")}`,
    status,
    eligibility_status: "eligible",
    sent_at: enviado ? "2026-10-20T12:00:00.000Z" : null,
    delivered_at: null,
    read_at: null,
    replied_at: null,
    opted_out_at: null,
  };
}

/** O caso medido: 1485 na lista, 225 enviadas, 37 falharam, o resto pendente. */
function listaDaProducao(): Linha[] {
  const linhas: Linha[] = [];
  let i = 0;
  for (let k = 0; k < 225; k++) linhas.push(destinatario(i++, "sent", true));
  for (let k = 0; k < 37; k++) linhas.push(destinatario(i++, "failed"));
  while (i < 1485) linhas.push(destinatario(i++, "pending"));
  return linhas;
}

async function chamar(): Promise<Record<string, unknown>> {
  const { GET } = await import("./route");
  const res = await GET(new NextRequest(`http://localhost/api/v1/campaigns/${CAMPANHA}/metrics`), {
    params: Promise.resolve({ id: CAMPANHA }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: Record<string, unknown> }).data;
}

describe("GET /api/v1/campaigns/:id/metrics", () => {
  beforeEach(() => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: { id: "u", idioma: "pt-BR" } as AuthUser,
      org: { orgId: ORG_ID, name: "Org", role: "manager" },
    } as never);
  });

  it("conta a lista INTEIRA acima de max_rows, e a soma fecha com a lista", async () => {
    const { client, faixas } = fakeSupabase(listaDaProducao());
    vi.mocked(createClient).mockResolvedValue(client as never);

    const data = await chamar();
    const c = data.contagem as ContagemDaCampanha;

    expect(c.total).toBe(1485);
    expect(c.elegiveis).toBe(1485);
    expect(c.enviados).toBe(225);
    expect(c.falharam).toBe(37);
    expect(c.pendentes).toBe(1485 - 225 - 37);
    expect(c.pendentes + c.enviados + c.falharam).toBe(c.elegiveis);
    expect(data.parcial).toBe(false);
    expect(faixas.length).toBe(2);
  });
});
