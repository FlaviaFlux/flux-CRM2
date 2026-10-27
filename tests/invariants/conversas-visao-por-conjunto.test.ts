import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * QUEM VÊ A CONVERSA, DECIDIDO POR CONJUNTO (migration 0802, distribuição Flux).
 *
 * `conversations_select` chamava `fn_can_view_conversation` em CADA linha — e a
 * função roda `fn_is_platform_admin()` e duas vezes `fn_user_role_in_org()`. Em
 * produção (27/10/2026) a contagem das abas custava 1,0–1,4 s e a Fila estourava
 * o `statement_timeout`. A 0802 tira a decisão da linha: a policy compara
 * `organization_id` com conjuntos calculados uma vez por consulta.
 *
 * Trocar a forma da policy só vale se a DECISÃO for a mesma. Este arquivo cruza,
 * para cada papel em cada modo de visibilidade, o que a policy deixa ver com o
 * que `fn_can_view_conversation` (a régua antiga, que segue viva para messages e
 * notas) responderia para as mesmas linhas. A segunda parte prova pelo PLANO que
 * a função por linha saiu: tempo é ruído de máquina, o plano não.
 *
 * Conectar como `postgres` mediria NADA (rolbypassrls = t) — a policy é medida
 * como `authenticated`; a régua antiga, como `postgres` com o mesmo `sub`.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error(
    "TEST_DB_CONTAINER not set — rode esta suíte via `pnpm test:db` (scripts/test-db.sh)",
  );
}
const containerName: string = container;

function sql(script: string): string {
  return execFileSync(
    "docker",
    [
      "exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-",
    ],
    { input: script, encoding: "utf8" },
  ).trim();
}

const claims = (userId: string) =>
  `select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);`;

/** Só os ids de conversa da saída — `set role` e `set_config` também imprimem. */
function ultimo(saida: string): string[] {
  return saida
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^eeeeeeee-0802-4000-8000-0{8}cc\d\d$/.test(l))
    .sort();
}

const P = "eeeeeeee-0802-4000-8000-";
const VIEWER = `${P}0000000000a1`;
const AGENT = `${P}0000000000a2`;
const MANAGER = `${P}0000000000a3`;
const ADMIN = `${P}0000000000a4`;
const FORA = `${P}0000000000a5`;
const USUARIOS = { VIEWER, AGENT, MANAGER, ADMIN, FORA };

/** Um modo de visibilidade por organização — `null` é o padrão (own_and_unassigned). */
const ORGS = [
  { id: `${P}00000000000a`, modo: null },
  { id: `${P}00000000000b`, modo: "all" },
  { id: `${P}00000000000c`, modo: "own" },
] as const;

beforeAll(() => {
  const usuarios = Object.entries(USUARIOS)
    .map(([nome, id]) => `('${id}', 'visao-0802-${nome.toLowerCase()}@invariant.test')`)
    .join(",\n");
  let seed = `insert into auth.users (id, email) values ${usuarios} on conflict (id) do nothing;\n`;
  ORGS.forEach((o, i) => {
    const settings = o.modo ? `jsonb_build_object('visibility_mode', '${o.modo}')` : `'{}'::jsonb`;
    const sessao = `${o.id.slice(0, -4)}5e5${i}`;
    seed += `
      insert into public.organizations (id, slug, legal_name, display_name, settings)
        values ('${o.id}', 'visao-0802-${i}', 'Visao 0802 ${i}', 'Visao 0802 ${i}', ${settings})
        on conflict (id) do nothing;
      insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
        ('${VIEWER}', '${o.id}', 'viewer', now()),
        ('${AGENT}', '${o.id}', 'agent', now()),
        ('${MANAGER}', '${o.id}', 'manager', now()),
        ('${ADMIN}', '${o.id}', 'admin', now())
        on conflict do nothing;
      do $s$ begin
        insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
          values ('${sessao}', '${o.id}', 'visao-0802-${i}', '\\x00'::bytea);
      exception when unique_violation then null; end $s$;
    `;
    // Sem dono, do agent e do manager — os três casos que o modo distingue.
    [null, AGENT, MANAGER].forEach((dono, j) => {
      const contato = `${o.id.slice(0, -4)}c0${i}${j}`;
      const conversa = `${o.id.slice(0, -4)}cc${i}${j}`;
      seed += `
        insert into public.contacts (id, organization_id, display_name)
          values ('${contato}', '${o.id}', 'Visao 0802 ${i}${j}') on conflict do nothing;
        insert into public.conversations
            (id, organization_id, contact_id, channel_session_id, status, assigned_to_user_id, assignee_kind)
          values ('${conversa}', '${o.id}', '${contato}', '${sessao}', 'open',
                  ${dono ? `'${dono}'` : "null"}, ${dono ? "'user'" : "null"})
          on conflict do nothing;
      `;
    });
  });
  sql(seed);
});

const DO_TESTE = `organization_id in (${ORGS.map((o) => `'${o.id}'`).join(",")})`;

function pelaPolicy(userId: string): string[] {
  return ultimo(
    sql(`set role authenticated;\n${claims(userId)}\nselect id from public.conversations where ${DO_TESTE};`),
  );
}

function pelaReguaAntiga(userId: string): string[] {
  return ultimo(
    sql(`reset role;\n${claims(userId)}
      select id from public.conversations
       where ${DO_TESTE}
         and public.fn_can_view_conversation(organization_id, assigned_to_user_id);`),
  );
}

describe("conversations_select — a mesma decisão, por conjunto", () => {
  it.each(Object.entries(USUARIOS))("%s vê exatamente o que fn_can_view_conversation deixa", (_nome, id) => {
    expect(pelaPolicy(id)).toEqual(pelaReguaAntiga(id));
  });

  it("controle: os modos distinguem de verdade (a igualdade acima não é vazia)", () => {
    // 9 conversas no total. Viewer vê tudo; agent: padrão 2 (sem dono + suas),
    // 'all' 3, 'own' 1 = 6; quem está fora não vê nada.
    expect(pelaPolicy(VIEWER)).toHaveLength(9);
    expect(pelaPolicy(AGENT)).toHaveLength(6);
    expect(pelaPolicy(FORA)).toHaveLength(0);
  });

  it("o plano da contagem não chama fn_can_view_conversation por linha", () => {
    const plano = sql(`set role authenticated;\n${claims(AGENT)}
      explain (costs off, verbose) select count(*) from public.conversations
        where organization_id = '${ORGS[0].id}';`);
    // Controle positivo: é mesmo o plano com a RLS.
    expect(plano).toContain("fn_orgs_que_veem_conversas");
    expect(plano).not.toContain("fn_can_view_conversation");
  });
});
