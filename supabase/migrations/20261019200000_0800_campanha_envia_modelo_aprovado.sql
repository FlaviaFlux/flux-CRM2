-- manifest: **Campanha envia modelo aprovado da Meta (distribuição Flux).** `campaigns` ganha `message_kind` (`text` | `template`, default `text`), `template_name`, `template_language` e `template_params` (jsonb: chave do slot → texto com variáveis da campanha, `{{primeiro_nome}}` etc. ou fixo). Sem isto a campanha num número da API oficial só sabia mandar texto livre, que a Meta recusa fora da janela de 24h (131047). Campanha existente vira `text` pelo default e segue idêntica. Número alto de propósito: migration só do fork, longe da numeração do produto.

-- ---- campanha envia modelo aprovado (migration 0800, distribuição Flux) ----
-- Idempotente: as colunas entram com `if not exists`, os CHECKs só se ainda não
-- existem. Nenhuma linha precisa de correção antes dos CHECKs — toda campanha
-- existente nasce `message_kind = 'text'` pelo default, que satisfaz os dois.
alter table public.campaigns
  add column if not exists message_kind text not null default 'text',
  add column if not exists template_name text,
  add column if not exists template_language text,
  add column if not exists template_params jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'campaigns_message_kind_check'
  ) then
    alter table public.campaigns
      add constraint campaigns_message_kind_check
      check (message_kind in ('text', 'template'));
  end if;

  -- Modelo sem nome ou sem idioma não é modelo: `pt_BR` e `pt` são modelos
  -- DISTINTOS na Meta, então o idioma é parte da identidade, não detalhe.
  if not exists (
    select 1 from pg_constraint where conname = 'campaigns_template_identidade_check'
  ) then
    alter table public.campaigns
      add constraint campaigns_template_identidade_check
      check (
        message_kind <> 'template'
        or (coalesce(btrim(template_name), '') <> ''
            and coalesce(btrim(template_language), '') <> '')
      );
  end if;
end $$;

comment on column public.campaigns.message_kind is
  'O que a campanha envia: `text` (message_body, texto livre) ou `template` (modelo aprovado da Meta, para número da API oficial). Vocabulário em lib/campanhas/tipos.ts → TIPOS_DE_MENSAGEM.';
comment on column public.campaigns.template_params is
  'Valor de cada parâmetro do modelo, chaveado por slotKey (lib/channels/meta/build-components.ts). O valor é texto com as variáveis da campanha ({{primeiro_nome}}, {{nome}}, {{saudacao}}, {{lead.x}}, {{contato.x}}) ou texto fixo, resolvido por contato na preparação e no envio.';
