-- manifest: **A leitura de `campaign_recipients` deixa de pagar a regra de escrita (distribuição Flux).** `campaign_recipients_write` era `for all`, que vale também para SELECT: toda leitura avaliava `fn_is_platform_admin_full()` e `fn_role_at_least()` → `fn_support_context()` em CADA destinatário. Medido em produção com `EXPLAIN ANALYZE` (23/10/2026), campanha de 1511: 11.961 ms com RLS contra 2 ms sem ela — acima do `statement_timeout`, e a tela da campanha mostrava números zerados e a lista vazia. Mesmo conserto da 0553 (catálogo): escrita em `insert`/`update`/`delete`, chamada sem dependência da linha em `(select …)`. Quem lê e quem escreve continua idêntico. Número alto de propósito: migration só do fork, longe da numeração do produto.

-- ---- leitura de destinatários sem a regra de escrita (migration 0801, distribuição Flux) ----
-- A ESCRITA é `insert`/`update`/`delete`, NUNCA `for all`: `for all` vale também
-- para SELECT, e o OR das permissivas fazia toda leitura avaliar
-- `fn_role_at_least` (security definer, que chama `fn_support_context`) em cada
-- destinatário — ~8 ms por linha, e a tela da campanha estourava o
-- statement_timeout de 8 s. Chamada que não depende da linha vai em `(select …)`:
-- o planner a executa uma vez. Idempotente: `drop policy if exists` antes de cada
-- `create policy`.
drop policy if exists campaign_recipients_select on public.campaign_recipients;
create policy campaign_recipients_select on public.campaign_recipients
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or (select public.fn_is_platform_admin())
  );

drop policy if exists campaign_recipients_write on public.campaign_recipients;

drop policy if exists campaign_recipients_insert on public.campaign_recipients;
create policy campaign_recipients_insert on public.campaign_recipients
  for insert with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

-- O nome `_write` fica com o UPDATE: é por ele que a 0533 e o invariante
-- `platform-admin-full-so-escreve` conferem a expressão da escrita.
create policy campaign_recipients_write on public.campaign_recipients
  for update using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists campaign_recipients_delete on public.campaign_recipients;
create policy campaign_recipients_delete on public.campaign_recipients
  for delete using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );
