-- manifest: **A Fila do Inbox e as contagens das abas deixam de pagar a RLS e o comando em cada conversa (distribuição Flux).** `conversations_select` chamava `fn_can_view_conversation(organization_id, assigned_to_user_id)` por LINHA — `security definer` que roda `fn_is_platform_admin()` e duas vezes `fn_user_role_in_org()` (cada uma com `fn_support_context()`) —, e o filtro `comando_da_conversa` (campo calculado, sem índice possível) avaliava a função na organização inteira. Medido em produção (27/10/2026, `pg_stat_statements`): contagem das abas 1,0–1,4 s × ~3.200 chamadas, aba Fila 2–7,4 s e `canceling statement due to statement timeout` intermitente; "Todas" (LIMIT 50 sem filtro) <1 s. Conserto: a policy lê conjuntos de organizações calculados UMA vez (`(select …)` vira initplan), com a mesma decisão da função antiga, e dois índices parciais `assigned_to_user_id is null` servem o atalho que `aplicarComando` põe ao lado do campo calculado. Quem vê o quê não muda. Número alto de propósito: migration só do fork.

-- ---- Inbox: Fila e contagens sem custo por linha (migration 0802, distribuição Flux) ----
--
-- (1) QUEM VÊ A CONVERSA, decidido por conjunto e não por linha.
--
-- `fn_orgs_que_veem_conversas(escopo)` devolve as organizações do usuário em que
-- ele vê: 'todas' (papel viewer/manager/admin, ou visibility_mode = 'all'),
-- 'sem_dono' (visibility_mode = 'own_and_unassigned', o padrão) e 'membro'
-- (qualquer papel). É a MESMA decisão de `fn_can_view_conversation`, só que
-- tirada da linha: o planner executa cada `(select …)` uma vez e compara
-- `organization_id` contra um conjunto pequeno. `fn_can_view_conversation`
-- continua existindo para as policies que a chamam por linha (messages, notas,
-- eventos) — esta migration não as toca.
--
-- Equivalência, ramo a ramo do CASE antigo:
--   platform admin ............ (select fn_is_platform_admin())
--   papel nulo => false ....... os três conjuntos só contêm orgs com papel
--   viewer/manager/admin ...... 'todas'
--   dono = auth.uid() ......... 'membro' e assigned_to_user_id = (select auth.uid())
--   modo 'all' ................ 'todas'
--   modo 'own_and_unassigned'.. 'membro' e sem dono e 'sem_dono'
--   outro modo ................ nenhum ramo => false
create or replace function public.fn_orgs_que_veem_conversas(p_escopo text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select o.org
    from (select public.fn_user_org_ids() as org) o
    cross join lateral (
      select public.fn_user_role_in_org(o.org) as papel,
             coalesce(
               (select org.settings->>'visibility_mode' from public.organizations org where org.id = o.org),
               'own_and_unassigned') as modo
    ) e
   where e.papel is not null
     and case p_escopo
           when 'todas'    then e.papel in ('viewer', 'manager', 'admin') or e.modo = 'all'
           when 'sem_dono' then e.modo = 'own_and_unassigned'
           when 'membro'   then true
           else false
         end;
$fn$;

comment on function public.fn_orgs_que_veem_conversas(text)
  is 'Organizações do usuário por escopo de visão de conversas (todas | sem_dono | membro). Mesma decisão de fn_can_view_conversation, por conjunto: a policy conversations_select a chama em (select …), uma vez por consulta (migration 0802, distribuição Flux).';

revoke execute on function public.fn_orgs_que_veem_conversas(text) from public, anon;
grant  execute on function public.fn_orgs_que_veem_conversas(text) to authenticated, service_role;

drop policy if exists "conversations_select" on public.conversations;
create policy "conversations_select" on public.conversations
  for select using (
    (select public.fn_is_platform_admin())
    or organization_id in (select public.fn_orgs_que_veem_conversas('todas'))
    or (organization_id in (select public.fn_orgs_que_veem_conversas('membro'))
        and (assigned_to_user_id = (select auth.uid())
             or (assigned_to_user_id is null
                 and organization_id in (select public.fn_orgs_que_veem_conversas('sem_dono')))))
  );

-- (2) OS ÍNDICES DO ATALHO DE `aplicarComando`.
--
-- `aguardando` e `automatico` só existem sem dono, então a Fila e a aba
-- Automático pedem `assigned_to_user_id is null` ao lado do campo calculado. O
-- predicado do índice é SÓ `is null` de propósito: o PostgREST manda o resto como
-- parâmetro, e índice parcial com predicado em parâmetro não é provado pelo
-- planner. Ordem da Fila = `ORDEM_DA_ESPERA` (awaiting_since asc nulls last, id
-- asc); a aba Automático ordena por atividade (last_message_at desc nulls last,
-- id desc).
--
-- Sem CONCURRENTLY: o runner envolve a migration numa transação, e CONCURRENTLY
-- não roda dentro de uma. Em banco grande, crie os dois índices antes, à mão,
-- com CONCURRENTLY — o `if not exists` daqui vira no-op.
create index if not exists idx_conversations_org_fila_espera
  on public.conversations (organization_id, awaiting_since asc nulls last, id)
  where assigned_to_user_id is null;

create index if not exists idx_conversations_org_sem_dono_atividade
  on public.conversations (organization_id, last_message_at desc nulls last, id desc)
  where assigned_to_user_id is null;
