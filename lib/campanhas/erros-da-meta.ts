/**
 * O código de erro da Meta, em frase que o operador entende — para a lista
 * "Falharam" da campanha.
 *
 * O código chega por dois caminhos e cai na MESMA coluna
 * (`campaign_recipients.last_error_code`):
 *   - recusa síncrona do envio: o handler grava `meta_<código>: <detalhe>` na
 *     mensagem, e a rodada extrai o número (`codigoDaFalha`);
 *   - falha assíncrona (webhook de status): o gatilho
 *     `fn_campanha_sincroniza_ack` copia `messages.error_code`, que já é o
 *     número cru.
 *
 * Nenhum desses erros é reenviado: a campanha não tem retry (cada destinatário
 * tenta uma vez), e os definitivos abaixo não melhorariam numa segunda tentativa
 * — só gastariam cota e, no 131049, piorariam a relação com o contato.
 */

interface ErroConhecido {
  texto: string;
  /** Não adianta tentar de novo para este contato sem alguém mudar algo. */
  definitivo: boolean;
}

const ERROS: Record<string, ErroConhecido> = {
  "131042": {
    texto: "Problema de pagamento na conta do WhatsApp Business (Meta). Regularize a forma de pagamento.",
    definitivo: true,
  },
  "131026": {
    texto: "Número sem WhatsApp ou que não pode receber esta mensagem.",
    definitivo: true,
  },
  "131049": {
    texto:
      "A Meta segurou a mensagem de marketing para proteger a experiência do contato (limite de marketing por pessoa).",
    definitivo: true,
  },
  "130472": {
    texto: "O contato está num experimento da Meta que não recebe mensagens de marketing.",
    definitivo: true,
  },
  "131047": {
    texto: "Fora da janela de 24h — só modelo aprovado pode ser enviado.",
    definitivo: true,
  },
  "131050": {
    texto: "O contato pediu para não receber mensagens de marketing desta empresa.",
    definitivo: true,
  },
  "132000": {
    texto: "Quantidade de parâmetros diferente da do modelo aprovado — ressincronize os modelos.",
    definitivo: true,
  },
  "132001": {
    texto: "O modelo não existe neste idioma ou ainda não foi aprovado.",
    definitivo: true,
  },
  "132012": {
    texto: "Formato de parâmetro diferente do modelo aprovado — ressincronize os modelos.",
    definitivo: true,
  },
  "132015": { texto: "O modelo foi pausado pela Meta por baixa qualidade.", definitivo: true },
  "132016": { texto: "O modelo foi desativado pela Meta.", definitivo: true },
  "131056": {
    texto: "Muitas mensagens para este contato em pouco tempo (limite da Meta por par de números).",
    definitivo: false,
  },
  "130429": { texto: "Limite de envio por segundo da Meta atingido.", definitivo: false },
  "131048": {
    texto: "A Meta limitou o envio deste número por denúncias ou bloqueios recentes.",
    definitivo: false,
  },
};

/** Os códigos internos do envio (não da Meta), no mesmo vocabulário da lista. */
const ERROS_DO_ENVIO: Record<string, string> = {
  send_failed: "O canal recusou o envio.",
  send_exception: "Erro inesperado no envio.",
  template_not_approved: "O modelo não está aprovado na Meta.",
  template_missing_values: "Faltou valor para um parâmetro do modelo.",
  template_missing: "O modelo não está entre os modelos sincronizados deste número.",
  template_stale: "O modelo mudou na Meta depois de configurado — ressincronize e revise a campanha.",
  parametro_vazio: "Um parâmetro do modelo ficou vazio para este contato.",
};

/** `meta_131026: details` → `131026`; código cru → ele mesmo; resto → `null`. */
export function codigoDaMeta(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  const t = bruto.trim();
  if (/^\d{3,6}$/.test(t)) return t;
  const m = t.match(/^meta_(\d{3,6})\b/);
  return m ? m[1]! : null;
}

/**
 * O código que a rodada grava a partir da mensagem que falhou: o da Meta quando
 * houver, senão o prefixo interno (`template_not_approved: ...` →
 * `template_not_approved`), senão `send_failed`.
 */
export function codigoDaFalha(errorMessage: string | null | undefined): string {
  const meta = codigoDaMeta(errorMessage);
  if (meta) return meta;
  const prefixo = (errorMessage ?? "").trim().match(/^([a-z_]+):/);
  if (prefixo && prefixo[1]! in ERROS_DO_ENVIO) return prefixo[1]!;
  return "send_failed";
}

/** A frase da lista "Falharam". Código desconhecido não some: aparece com o número. */
export function motivoDaFalha(codigo: string | null | undefined): string | null {
  if (!codigo) return null;
  const conhecido = ERROS[codigo];
  if (conhecido) return conhecido.texto;
  if (codigo in ERROS_DO_ENVIO) return ERROS_DO_ENVIO[codigo]!;
  return /^\d+$/.test(codigo) ? `Erro ${codigo} da Meta.` : null;
}

/** Tentar de novo não adianta (sem alguém mudar algo)? Código desconhecido = não sabemos = `false`. */
export function falhaDefinitiva(codigo: string | null | undefined): boolean {
  return !!codigo && ERROS[codigo]?.definitivo === true;
}
