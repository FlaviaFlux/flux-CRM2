import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * A LEITURA DOS DESTINATÁRIOS NÃO PAGA A REGRA DE ESCRITA (migration 0801).
 *
 * `campaign_recipients_write` era `for all`, e `for all` vale também para
 * SELECT: o Postgres junta as permissivas por OR, e o plano avaliava
 * `fn_is_platform_admin_full()` e `fn_role_at_least(organization_id, 'manager')`
 * — esta chama `fn_user_role_in_org` → `fn_support_context`, uma junção de quatro
 * tabelas — em CADA destinatário. Medido em produção com `EXPLAIN ANALYZE`
 * (23/10/2026), campanha de 1511: 11.961 ms com RLS contra 2 ms sem ela. A tela
 * da campanha estourava o `statement_timeout` de 8 s: números zerados, card de
 * Progresso sumido e a lista "Quem está na lista" vazia.
 *
 * Gêmeo de `catalogo-leitura-nao-avalia-a-regra-de-escrita.test.ts` (0553): a
 * prova é o PLANO da leitura, como `authenticated` — tempo é ruído de máquina, o
 * plano não. Com o `for all` de volta, o filtro cita a função e o caso reprova.
 *
 * Não há caso de escrita como no catálogo: `authenticated` só tem GRANT de
 * SELECT nesta tabela (quem escreve é o servidor, com a service role), então o
 * trio insert/update/delete existe pela paridade com o `for all` e pela
 * expressão que `platform-admin-full-so-escreve` confere em `_write`.
 *
 * Conectar como `postgres` mediria NADA (rolbypassrls = t).
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

function comoUsuario(userId: string, script: string): string {
  return sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    ${script}
  `);
}

function noBanco(script: string): string {
  return sql(`reset role;\n${script}`).split("\n").pop() ?? "";
}

const ORG = "dddddddd-0801-4000-8000-00000000000a";
const MANAGER = "dddddddd-0801-4000-8000-0000000000a1";
const CAMPANHA = "dddddddd-0801-4000-8000-0000000000c1";

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${MANAGER}', 'destinatarios-0801-mgr@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'destinatarios-0801', 'Destinatarios 0801', 'Destinatarios 0801')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${MANAGER}', '${ORG}', 'manager', now())
      on conflict do nothing;
  `);
});

describe("campaign_recipients — a leitura não avalia a regra de escrita", () => {
  it("o plano da leitura da campanha não chama fn_role_at_least nem o _full", () => {
    // A forma das duas rotas da tela (métricas e lista): filtro por organização
    // e campanha, ordenado.
    const plano = comoUsuario(
      MANAGER,
      `explain (costs off, verbose) select status, sent_at from public.campaign_recipients
        where organization_id = '${ORG}' and campaign_id = '${CAMPANHA}'
        order by created_at, id limit 5;`,
    );
    // Controle positivo: é mesmo o plano com a RLS (sem ele, um plano vazio passaria).
    expect(plano).toContain("fn_user_org_ids");
    expect(plano).not.toContain("fn_role_at_least");
    expect(plano).not.toContain("fn_is_platform_admin_full");
  });

  it("nenhuma policy além da de leitura vale para SELECT", () => {
    const n = noBanco(`
      select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'campaign_recipients'
         and cmd in ('ALL', 'SELECT') and policyname <> 'campaign_recipients_select';
    `);
    expect(n).toBe("0");
  });

  it("a escrita continua coberta: insert, update e delete exigem manager", () => {
    const linhas = noBanco(`
      select string_agg(cmd || ':' || (coalesce(qual, '') || coalesce(with_check, '') like '%fn_role_at_least%')::text, ',' order by cmd)
        from pg_policies
       where schemaname = 'public' and tablename = 'campaign_recipients'
         and cmd in ('INSERT', 'UPDATE', 'DELETE');
    `);
    expect(linhas).toBe("DELETE:true,INSERT:true,UPDATE:true");
  });
});
