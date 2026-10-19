/**
 * O que a campanha entrega ao `sendMessageHandler` — texto ou modelo — num
 * lugar só, para a rodada e o envio de teste não divergirem.
 *
 * O modelo vai pelo MESMO caminho da Inbox: `type: "template"` com nome, idioma
 * e valores por `slotKey`. O handler confere a definição aprovada
 * (`conferirDefinicao`), escolhe o transporte da conexão e grava a mensagem na
 * conversa. A campanha não fala com a Graph API.
 */
import type { MensagemDaCampanha } from "./preparacao";
import { resolverParametrosDoModelo } from "./modelo-da-campanha";
import { renderizar, type ValoresDoDestinatario } from "./renderizador";
import type { TipoDeMensagem } from "./tipos";

/** As colunas de `campaigns` que dizem o que ela manda. */
export interface ConteudoDaCampanha {
  channel_session_id: string;
  message_body: string | null;
  message_kind?: string | null;
  template_name?: string | null;
  template_language?: string | null;
  template_params?: unknown;
}

export const COLUNAS_DO_CONTEUDO = "message_kind, template_name, template_language, template_params";

export function tipoDaCampanha(c: Pick<ConteudoDaCampanha, "message_kind">): TipoDeMensagem {
  return c.message_kind === "template" ? "template" : "text";
}

/** O jsonb do banco lido sem confiar no shape: só pares texto → texto. */
export function parametrosGuardados(valor: unknown): Record<string, string> {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  const saida: Record<string, string> = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    if (typeof v === "string") saida[k] = v;
  }
  return saida;
}

export function mensagemDaCampanha(c: ConteudoDaCampanha): MensagemDaCampanha {
  const tipo = tipoDaCampanha(c);
  return {
    tipo,
    corpo: c.message_body ?? "",
    parametros: tipo === "template" ? parametrosGuardados(c.template_params) : {},
    channelSessionId: c.channel_session_id,
  };
}

/** O corpo do `sendMessageHandler`, sem `conversation_id` e `metadata` (são de quem chama). */
export type ConteudoDoEnvio =
  | { type: "text"; body: string }
  | {
      type: "template";
      body: string;
      template_name: string;
      template_language: string;
      template_values: Record<string, string>;
    };

/**
 * Monta o envio de UM contato, na hora do envio.
 *
 * `corpoCongelado` é o `rendered_body` do destinatário (ou o corpo da campanha,
 * no teste). `valoresCongelados` são os `template_values` do snapshot; sem eles
 * (envio de teste), os parâmetros saem da campanha com os `valores` do contato.
 *
 * Devolve `faltando` em vez de mandar: parâmetro que ficou vazio na hora do
 * envio é recusado pela Meta, e o motivo precisa chegar à lista.
 */
export function conteudoDoEnvio(
  c: ConteudoDaCampanha,
  entrada: {
    corpoCongelado: string;
    valoresCongelados?: Record<string, string> | null;
    valores: ValoresDoDestinatario;
    quando: { agora: Date; fuso: string };
  },
): { conteudo: ConteudoDoEnvio; faltando: string[] } {
  const corpo = renderizar(entrada.corpoCongelado, entrada.valores, entrada.quando);
  if (tipoDaCampanha(c) !== "template") {
    return { conteudo: { type: "text", body: corpo.texto }, faltando: corpo.faltando };
  }
  const fonte = entrada.valoresCongelados ?? parametrosGuardados(c.template_params);
  const p = resolverParametrosDoModelo(fonte, entrada.valores, entrada.quando);
  return {
    conteudo: {
      type: "template",
      // O texto que fica no histórico da conversa: o modelo como o contato o lê.
      body: corpo.texto,
      template_name: c.template_name ?? "",
      template_language: c.template_language ?? "",
      template_values: p.valores,
    },
    faltando: [...new Set([...corpo.faltando, ...p.faltando])],
  };
}
