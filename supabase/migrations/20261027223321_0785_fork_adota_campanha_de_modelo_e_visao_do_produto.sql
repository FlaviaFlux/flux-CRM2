-- manifest: **O fork adota a campanha de modelo aprovado e a visão de conversas do produto (distribuição Flux, sync v1.94.0).** A 0800 do fork e a 0710 do produto implementaram a mesma campanha pelo número oficial com colunas diferentes (`message_kind`/`template_*` × `message_mode`/`provider_template_*`); a 0802 do fork e a 0726 do produto resolveram o escopo da conversa por conjunto, e a do produto ainda tem o ramo de PARTICIPANTE (0661/9016). Esta migration converte as campanhas de modelo do fork para as colunas do produto, remove as colunas do fork, devolve `conversations_select` à forma do produto e apaga `fn_orgs_que_veem_conversas`. Os dois índices parciais da 0802 ficam. Número num vão que o produto já passou (0785), para não colidir.

-- ---- fork adota a campanha de modelo e a visão de conversas do produto (migration 0785, distribuição Flux) ----
--
-- (1) CAMPANHA DE MODELO APROVADO: as colunas da 0800 viram as da 0710.
--
-- Converte só o que é do fork e ainda não foi convertido (`message_kind =
-- 'template'` com `message_mode = 'text'`), então reaplicar não muda nada. O
-- valor de cada parâmetro era TEXTO com variável; o produto guarda a ORIGEM:
--   {{primeiro_nome}} -> contact_first_name     {{nome}} -> contact_name
--   {{lead.x}}        -> lead_custom (key x)     outro texto -> fixed
-- Texto que misturava variável e palavras vira `fixed` literal: só importa para
-- campanha ainda não enviada, e a tela do produto mostra o valor para revisão.
-- Dinâmico porque, em banco que nunca teve a 0800, as colunas não existem.
do $fork_campanha$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'campaigns' and column_name = 'message_kind'
  ) then
    execute $sql$
      update public.campaigns c
         set message_mode = 'template',
             provider_template_name = c.template_name,
             provider_template_language = c.template_language,
             provider_template_variables = coalesce((
               select jsonb_object_agg(p.key, case
                   when btrim(p.value) = '{{primeiro_nome}}'
                     then jsonb_build_object('kind', 'contact_first_name')
                   when btrim(p.value) = '{{nome}}'
                     then jsonb_build_object('kind', 'contact_name')
                   when btrim(p.value) ~ '^\{\{lead\.[A-Za-z0-9_]+\}\}$'
                     then jsonb_build_object('kind', 'lead_custom', 'key',
                            substring(btrim(p.value) from '^\{\{lead\.([A-Za-z0-9_]+)\}\}$'))
                   else jsonb_build_object('kind', 'fixed', 'value', left(btrim(p.value), 1000))
                 end)
                 from jsonb_each_text(c.template_params) p
                where btrim(p.value) <> ''
             ), '{}'::jsonb)
       where c.message_kind = 'template'
         and c.message_mode = 'text'
         and coalesce(btrim(c.template_name), '') <> ''
         and coalesce(btrim(c.template_language), '') <> ''
    $sql$;
  end if;
end
$fork_campanha$;

alter table public.campaigns drop constraint if exists campaigns_message_kind_check;
alter table public.campaigns drop constraint if exists campaigns_template_identidade_check;
alter table public.campaigns
  drop column if exists message_kind,
  drop column if exists template_name,
  drop column if exists template_language,
  drop column if exists template_params;

-- (2) QUEM VÊ A CONVERSA: a policy do produto (0726 + ramo de participante da
-- 9016), que na cadeia vem ANTES da 0802 e foi sobrescrita por ela. Mesma
-- decisão da 0802 para dono e modo, mais quem participa da conversa.
drop policy if exists "conversations_select" on public.conversations;
create policy "conversations_select" on public.conversations
  for select using (
    (select public.fn_is_platform_admin())
    or organization_id in (
         select s.organization_id from public.fn_conversation_scope() s where s.org_wide_read
       )
    or (
         assigned_to_user_id = auth.uid()
         and organization_id in (select s.organization_id from public.fn_conversation_scope() s)
       )
    or (
         assigned_to_user_id is null
         and organization_id in (
              select s.organization_id from public.fn_conversation_scope() s where s.sees_unassigned
            )
       )
    or exists (
         select 1
           from public.conversation_participants cp
          where cp.conversation_id = conversations.id
            and cp.organization_id = conversations.organization_id
            and cp.user_id = auth.uid()
            and cp.left_at is null
            and not exists (
              select 1 from public.contacts pc
               where pc.id=conversations.contact_id
                 and pc.organization_id=conversations.organization_id
                 and pc.is_personal
            )
       )
  );

drop function if exists public.fn_orgs_que_veem_conversas(text);
