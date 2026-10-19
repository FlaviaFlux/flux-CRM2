/**
 * PREPARAR — o recorte vira uma lista de destinatários congelada.
 *
 * ═══ Por que congelar ═══
 *
 * Depois daqui, mexer na etiqueta de um contato não muda mais quem recebe
 * AQUELA execução. Sem isso, a lista muda no meio do envio: o número que o
 * operador conferiu antes de apertar não é o número que sai, e "por que essa
 * pessoa recebeu?" fica sem resposta possível — o recorte de ontem não existe
 * mais em lugar nenhum.
 *
 * ═══ Por que o excluído vira LINHA, e não some ═══
 *
 * Quem foi pulado, e por quê, é a informação que o operador mais precisa: uma
 * lista de 500 que vira 80 envios tem um problema, e o problema tem nome
 * (bloqueado, sem telefone, duplicado). Sumir com eles devolveria "80" sem
 * explicação. A linha excluída nasce `skipped` e nunca entra na fila.
 *
 * ═══ Por que roda na requisição, e não num worker ═══
 *
 * O que a doutrina proíbe no Route Handler é o LOTE DE ENVIO — mandar N
 * mensagens dentro de uma requisição. Preparar é três consultas e um insert em
 * massa, com teto de 5.000 linhas; empurrar isso para um worker acrescentaria um
 * estado intermediário observável ("preparando" que nunca termina) e um caminho
 * de retomada, para economizar segundos. O envio, esse sim, é do cron.
 *
 * ═══ Idempotência ═══
 *
 * A transição `draft → preparing` é compare-and-set: dois cliques simultâneos,
 * e só um entra. Preparar de novo (depois de voltar ao rascunho) apaga a lista
 * anterior e reconstrói — o que só é permitido enquanto NADA saiu, guarda que
 * vive na rota.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { FILTRO_VAZIO, filtroDeAudienciaSchema, type FiltroDeAudiencia } from "./audiencia";
import { buscarCandidatos, contatosJaEmCampanha } from "./consulta-de-audiencia";
import { hashDoEndereco, hashesExcluidos } from "./exclusoes";
import {
  classificarAudiencia,
  contarExclusoes,
  type CandidatoDaAudiencia,
} from "./elegibilidade";
import { campanhaDependeDaJanela, foraDaJanela } from "./janela-da-campanha";
import { resolverParametrosDoModelo } from "./modelo-da-campanha";
import { renderizar, type ValoresDoDestinatario } from "./renderizador";
import type { MotivoDeExclusao, TipoDeMensagem } from "./tipos";

/**
 * O que a campanha manda, do ponto de vista de quem prepara a lista.
 *
 * `corpo` é o texto livre ou, na campanha de modelo, o texto do modelo com as
 * variáveis da campanha no lugar de cada `{{n}}` (`corpoDoModelo`). Os
 * `parametros` só existem no modelo — inclusive os que não aparecem no corpo
 * (sufixo de link de botão), que também tiram da lista quem não tem o dado.
 */
export interface MensagemDaCampanha {
  tipo: TipoDeMensagem;
  corpo: string;
  parametros: Record<string, string>;
  /** O número PRINCIPAL — é contra a janela dele que a lista de texto é conferida. */
  channelSessionId: string | null;
}

export interface ResumoDoSnapshot {
  total: number;
  elegiveis: number;
  excluidos: number;
  motivos: Partial<Record<MotivoDeExclusao, number>>;
}

/** Quantas linhas vão num insert. Acima disso o payload do PostgREST fica grande demais. */
const LOTE_DE_INSERT = 500;

/**
 * A PRÉVIA: o mesmo recorte, a mesma classificação, sem gravar nada.
 *
 * Usa as MESMAS funções da preparação de propósito — prévia que mede por outro
 * caminho é prévia que mente, e a mentira só aparece depois do envio.
 */
export async function preverAudiencia(
  admin: SupabaseClient,
  entrada: {
    organizationId: string;
    filtro: FiltroDeAudiencia;
    mensagem: MensagemDaCampanha;
    agora: Date;
    /** Campanha a ignorar na conta de "já em campanha" (a que está sendo editada). */
    campanhaId?: string;
  },
): Promise<
  ResumoDoSnapshot & {
    /** O recorte bateu o teto de 20.000 negócios e há linha além dele (#2404). */
    truncado: boolean;
    amostra: Array<{ nome: string | null; motivo: MotivoDeExclusao | null }>;
  }
> {
  const { linhas, truncado } = await classificar(admin, entrada);
  const elegiveis = linhas.filter((l) => l.elegivel).length;
  return {
    total: linhas.length,
    elegiveis,
    excluidos: linhas.length - elegiveis,
    motivos: contarExclusoes(linhas),
    truncado,
    // Amostra curta: a tela mostra "quem" para o operador reconhecer a lista,
    // não para ele conferir 500 nomes numa página.
    amostra: linhas.slice(0, 20).map((l) => ({ nome: l.candidato.nome, motivo: l.motivo })),
  };
}

async function classificar(
  admin: SupabaseClient,
  entrada: {
    organizationId: string;
    filtro: FiltroDeAudiencia;
    mensagem: MensagemDaCampanha;
    agora: Date;
    campanhaId?: string;
  },
): Promise<{ linhas: ReturnType<typeof classificarAudiencia>; truncado: boolean }> {
  const { mensagem } = entrada;
  const { candidatos, truncado } = await buscarCandidatos(admin, {
    organizationId: entrada.organizationId,
    filtro: entrada.filtro,
    agora: entrada.agora,
    // Os campos personalizados são lidos quando o TEXTO os usa — e no modelo o
    // texto inclui os parâmetros que não aparecem no corpo (link de botão).
    corpo: [mensagem.corpo, ...Object.values(mensagem.parametros)].join("\n"),
  });
  const jaEmCampanha = await contatosJaEmCampanha(
    admin,
    entrada.organizationId,
    entrada.campanhaId,
  );
  const suprimidos = await hashesExcluidos(admin, entrada.organizationId);
  const janelaFechada = await vetoDaJanela(admin, {
    organizationId: entrada.organizationId,
    channelSessionId: mensagem.channelSessionId,
    tipo: mensagem.tipo,
    agora: entrada.agora,
  });
  return {
    linhas: classificarAudiencia(candidatos, {
      excluidosAMao: new Set(entrada.filtro.excluir_contatos),
      jaEmCampanha,
      suprimidos,
      hashDoEndereco,
      ...(janelaFechada ? { janelaFechada } : {}),
      // A saudação NÃO é resolvida aqui: ela é da hora do envio. O token fica no
      // corpo congelado e o despacho o troca — ver `rodada.ts`.
      renderizar: (c: CandidatoDaAudiencia) => {
        const valores = valoresDoCandidato(c);
        const r = renderizar(mensagem.corpo, valores);
        if (mensagem.tipo !== "template") return { texto: r.texto, faltando: r.faltando };
        // Modelo: falta em QUALQUER parâmetro tira a pessoa da lista — a Meta
        // recusa parâmetro vazio, e "Olá , tudo bem?" seria pior que não mandar.
        const p = resolverParametrosDoModelo(mensagem.parametros, valores);
        return { texto: r.texto, faltando: [...new Set([...r.faltando, ...p.faltando])] };
      },
    }),
    truncado,
  };
}

function valoresDoCandidato(c: CandidatoDaAudiencia): ValoresDoDestinatario {
  return { nome: c.nome, lead: c.lead, contato: c.contato };
}

/** Linhas lidas por página na consulta da janela. */
const PAGINA_DA_JANELA = 1000;

/**
 * O veto da janela para ESTA campanha, ou `undefined` quando ela não depende de
 * janela (campanha de modelo, número QR, número que não se achou).
 *
 * Lê só as conversas do número com entrada nas últimas 24h — quem não aparece
 * nelas está fora da janela. É a lista pequena (quem escreveu ontem), nunca a
 * lista inteira da campanha numa `in (...)` de URL.
 */
async function vetoDaJanela(
  admin: SupabaseClient,
  entrada: {
    organizationId: string;
    channelSessionId: string | null;
    tipo: TipoDeMensagem;
    agora: Date;
  },
): Promise<((c: CandidatoDaAudiencia) => boolean) | undefined> {
  if (!entrada.channelSessionId || entrada.tipo === "template") return undefined;
  const { data: sessao } = await admin
    .from("channel_sessions")
    .select("provider")
    .eq("organization_id", entrada.organizationId)
    .eq("id", entrada.channelSessionId)
    .maybeSingle();
  const provider = (sessao as { provider?: string | null } | null)?.provider ?? null;
  if (!campanhaDependeDaJanela(entrada.tipo, provider)) return undefined;

  const desde = new Date(entrada.agora.getTime() - 24 * 3_600_000).toISOString();
  const ultimaEntrada = new Map<string, string>();
  for (let de = 0; ; de += PAGINA_DA_JANELA) {
    const { data, error } = await admin
      .from("conversations")
      .select("contact_id, last_inbound_at")
      .eq("organization_id", entrada.organizationId)
      .eq("channel_session_id", entrada.channelSessionId)
      .gte("last_inbound_at", desde)
      .order("id", { ascending: true })
      .range(de, de + PAGINA_DA_JANELA - 1);
    if (error) throw new Error(`preparação: janela de 24h — ${error.message}`);
    const linhas = (data ?? []) as Array<{ contact_id: string; last_inbound_at: string }>;
    for (const l of linhas) {
      const atual = ultimaEntrada.get(l.contact_id);
      if (!atual || atual < l.last_inbound_at) ultimaEntrada.set(l.contact_id, l.last_inbound_at);
    }
    if (linhas.length < PAGINA_DA_JANELA) break;
  }

  return (c) =>
    foraDaJanela({
      tipo: entrada.tipo,
      provider,
      ultimaEntrada: ultimaEntrada.get(c.contactId) ?? null,
      agora: entrada.agora,
    });
}

/**
 * O que fica congelado no destinatário. No modelo, também o valor de cada
 * parâmetro — já resolvido com os campos do contato e com `{{saudacao}}` ainda
 * literal, como o `rendered_body`. O envio só resolve a saudação: reler os
 * campos na hora mandaria um valor que o operador não viu na lista.
 */
function variaveisCongeladas(
  mensagem: MensagemDaCampanha,
  linha: ReturnType<typeof classificarAudiencia>[number],
): Record<string, unknown> {
  const base = { nome: linha.candidato.nome };
  if (mensagem.tipo !== "template" || !linha.elegivel) return base;
  const p = resolverParametrosDoModelo(mensagem.parametros, valoresDoCandidato(linha.candidato));
  return { ...base, template_values: p.valores };
}

/**
 * Materializa o snapshot. A campanha já tem de estar em `preparing` — quem faz a
 * transição é a rota, que é quem sabe recusar o clique repetido.
 */
export async function prepararCampanha(
  admin: SupabaseClient,
  entrada: {
    campanhaId: string;
    organizationId: string;
    filtro: unknown;
    mensagem: MensagemDaCampanha;
    contentVersion: number;
    agora: Date;
  },
): Promise<ResumoDoSnapshot> {
  const filtro = filtroDeAudienciaSchema.safeParse(entrada.filtro);
  if (!filtro.success) {
    throw new Error(`Filtro de audiência inválido: ${filtro.error.issues[0]?.message ?? "sem critério"}`);
  }

  const { linhas } = await classificar(admin, {
    organizationId: entrada.organizationId,
    filtro: filtro.data,
    mensagem: entrada.mensagem,
    agora: entrada.agora,
    campanhaId: entrada.campanhaId,
  });

  // Reconstrução limpa: a rota só chega aqui quando nada saiu, então apagar a
  // lista anterior não apaga histórico de envio nenhum.
  const { error: erroLimpeza } = await admin
    .from("campaign_recipients")
    .delete()
    .eq("organization_id", entrada.organizationId)
    .eq("campaign_id", entrada.campanhaId);
  if (erroLimpeza) throw new Error(`preparação: limpeza — ${erroLimpeza.message}`);

  const agoraIso = entrada.agora.toISOString();
  const registros = linhas.map((l) => ({
    organization_id: entrada.organizationId,
    campaign_id: entrada.campanhaId,
    contact_id: l.candidato.contactId,
    // Endereço só de quem vai receber: o excluído não precisa dele, e guardar
    // telefone que ninguém vai usar é PII sem finalidade.
    recipient_address: l.elegivel ? l.candidato.telefone : null,
    status: l.elegivel ? "pending" : "skipped",
    eligibility_status: l.elegivel ? "eligible" : "excluded",
    exclusion_reason: l.motivo,
    rendered_body: l.corpo,
    content_version: entrada.contentVersion,
    variables: variaveisCongeladas(entrada.mensagem, l),
    cancelled_at: null,
    created_at: agoraIso,
  }));

  for (let i = 0; i < registros.length; i += LOTE_DE_INSERT) {
    const { error } = await admin
      .from("campaign_recipients")
      .insert(registros.slice(i, i + LOTE_DE_INSERT));
    if (error) throw new Error(`preparação: gravação — ${error.message}`);
  }

  const elegiveis = linhas.filter((l) => l.elegivel).length;
  return {
    total: linhas.length,
    elegiveis,
    excluidos: linhas.length - elegiveis,
    motivos: contarExclusoes(linhas),
  };
}

/** O filtro guardado no banco, ou o vazio quando a campanha ainda não escolheu. */
export function filtroGuardado(valor: unknown): FiltroDeAudiencia {
  const r = filtroDeAudienciaSchema.safeParse(valor);
  return r.success ? r.data : FILTRO_VAZIO;
}
