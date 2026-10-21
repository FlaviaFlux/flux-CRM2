/**
 * O que o modelo aprovado mostrou ALÉM do texto: rodapé e botões.
 *
 * ═══ O defeito ═══
 *
 * A mensagem de modelo grava em `body` só cabeçalho e corpo (é o texto que a
 * busca, a IA e a lista leem). Rodapé e botões ficavam de fora, então a
 * conversa mostrava uma mensagem sem o botão de link que o cliente recebeu —
 * medido numa campanha com botão "Responder pesquisa": no WhatsApp o botão
 * estava lá, no CRM não.
 *
 * ═══ Por que FOTO no envio, e não leitura do espelho na hora de desenhar ═══
 *
 * O balão é histórico. O modelo pode ser editado, reprovado ou apagado depois,
 * e o sufixo `{{n}}` de um botão de link é valor DESTE envio — nenhum dos dois
 * se reconstrói depois. A foto sai da mesma definição que o pré-voo
 * (`conferirDefinicao`) acabou de conferir, com os mesmos valores do envio.
 *
 * ═══ Por que um leitor só ═══
 *
 * `metadata` é jsonb: sem um leitor central, cada tela leria o caminho do seu
 * jeito (anti-pattern 6). Quem escreve é `fotoDoModelo`; quem lê é
 * `lerModeloDaMensagem`, que devolve `null` para qualquer forma inesperada em
 * vez de quebrar o balão.
 */
import { z } from "zod";

import { renderTemplatePreview } from "@/lib/channels/meta/render-template";

const botaoSchema = z.object({
  tipo: z.string(),
  texto: z.string(),
  url: z.string().nullable(),
  telefone: z.string().nullable(),
});

const modeloSchema = z.object({
  rodape: z.string().nullable(),
  botoes: z.array(botaoSchema),
});

export type ModeloDaMensagem = z.infer<typeof modeloSchema>;

/** A definição como o espelho (`meta_templates`) a guarda. */
export interface DefinicaoDoEnvio {
  name: string;
  language: string;
  components: unknown;
  parameter_format?: string | null;
}

/**
 * A foto do rodapé e dos botões, com os valores do envio aplicados. `null`
 * quando o modelo não tem nenhum dos dois — não há o que guardar.
 */
export function fotoDoModelo(
  def: DefinicaoDoEnvio,
  valores: Record<string, string>,
): ModeloDaMensagem | null {
  const previa = renderTemplatePreview(def.components, valores, {
    name: def.name,
    language: def.language,
    ...(def.parameter_format ? { parameterFormat: def.parameter_format } : {}),
  });
  if (!previa.rodape && previa.botoes.length === 0) return null;
  return { rodape: previa.rodape, botoes: previa.botoes };
}

/** Lê `metadata.modelo`. Forma inesperada é `null`, nunca exceção. */
export function lerModeloDaMensagem(metadata: unknown): ModeloDaMensagem | null {
  if (!metadata || typeof metadata !== "object") return null;
  const r = modeloSchema.safeParse((metadata as Record<string, unknown>).modelo);
  return r.success ? r.data : null;
}

/**
 * O link que o balão pode abrir. Só http(s): o valor vem da definição e de
 * parâmetro do envio, e um `javascript:` ali viraria clique perigoso.
 */
export function linkSeguro(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}
