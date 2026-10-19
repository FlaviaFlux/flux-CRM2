/**
 * Campanha que envia MODELO APROVADO da Meta — a parte pura.
 *
 * ═══ Por que modelo ═══
 *
 * Número da API oficial só manda texto livre para quem escreveu nas últimas
 * 24h. Uma campanha fala, por definição, com quem não escreveu: o texto livre
 * dela é recusado pela Meta (131047) para quase toda a lista. O caminho
 * legítimo é o modelo aprovado — o mesmo que a Inbox oferece quando a janela
 * fecha e que o follow-up manda no lugar da IA.
 *
 * ═══ O parâmetro é TEXTO COM VARIÁVEIS, não um enum de fontes ═══
 *
 * Cada `{{n}}` do modelo recebe um texto da campanha: `{{primeiro_nome}}`,
 * `{{nome}}`, `{{saudacao}}`, `{{lead.x}}`, `{{contato.x}}` ou texto fixo. É o
 * vocabulário que o operador já escreve no texto livre da campanha, resolvido
 * pelo MESMO `renderizar()` — com a mesma regra de falta (contato sem nome sai
 * da lista com `variavel_ausente`) e a mesma saudação da hora do envio. Um enum
 * próprio de fontes seria um segundo vocabulário para o mesmo fato.
 *
 * ═══ A chave é a `slotKey` do envio ═══
 *
 * `template_params` é chaveado por `slotKey` (`lib/channels/meta/build-components.ts`)
 * — a função que a Inbox e o montador do payload usam. O `{{1}}` do cabeçalho e
 * o `{{1}}` do corpo são parâmetros diferentes; chave montada de outro jeito é o
 * erro 132000 voltando.
 */
import { slotKey } from "@/lib/channels/meta/build-components";
import { renderTemplateBody } from "@/lib/channels/meta/render-template";
import { deriveTemplateContract, describeAddress } from "@/lib/channels/meta/template-contract";

import { renderizar, type ValoresDoDestinatario } from "./renderizador";

/** A linha do espelho (`meta_templates`) que importa aqui. */
export interface DefinicaoDoModelo {
  name: string;
  language: string;
  parameter_format?: string | null;
  components: unknown;
}

export interface SlotDoModelo {
  /** `slotKey` — a chave de `template_params` e de `template_values`. */
  chave: string;
  /** "corpo", "cabeçalho", "botão 1 (url)" — para a tela e para a mensagem de erro. */
  onde: string;
  /** O `{{n}}` como o operador o vê no modelo. */
  rotulo: string;
  /** `text`, `url_suffix`, `image`… — decide o que faz sentido pôr ali. */
  espera: string;
  contextoAntes: string;
  contextoDepois: string;
}

function contrato(def: DefinicaoDoModelo) {
  return deriveTemplateContract({
    name: def.name,
    language: def.language,
    ...(def.parameter_format ? { parameter_format: def.parameter_format } : {}),
    components: def.components as never,
  });
}

/** Os parâmetros do modelo, na ordem da definição. */
export function slotsDoModelo(def: DefinicaoDoModelo): SlotDoModelo[] {
  return contrato(def).slots.map((s) => ({
    chave: slotKey(s.address, s.key),
    onde: describeAddress(s.address),
    rotulo: `{{${s.key}}}`,
    espera: s.expects,
    contextoAntes: s.contextBefore,
    contextoDepois: s.contextAfter,
  }));
}

/**
 * O que está errado no mapeamento, em frases. Vazio = serve.
 *
 * Parâmetro sem fonte é recusado AQUI, ao salvar, e não na preparação: um
 * mapeamento incompleto tiraria a lista inteira com `variavel_ausente`, e o
 * operador procuraria o defeito nos contatos.
 */
export function errosDoMapeamento(
  def: DefinicaoDoModelo,
  params: Record<string, string>,
): string[] {
  const slots = slotsDoModelo(def);
  const conhecidas = new Set(slots.map((s) => s.chave));
  const erros: string[] = [];
  for (const s of slots) {
    if ((params[s.chave] ?? "").trim() === "") {
      erros.push(`O parâmetro ${s.rotulo} do ${s.onde} está sem valor.`);
    }
  }
  for (const chave of Object.keys(params)) {
    if (!conhecidas.has(chave)) erros.push(`O modelo não tem o parâmetro "${chave}".`);
  }
  return erros;
}

/** O que a Meta aceita num parâmetro de texto: sem quebra de linha, tab nem 4+ espaços seguidos. */
function parametroAceitavel(valor: string): string {
  return valor
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

/**
 * Os valores de UM contato.
 *
 * Sem `quando` (preparação): `{{saudacao}}` fica literal e o valor do cadastro
 * fica blindado — exatamente como `rendered_body`. Com `quando` (envio): a
 * saudação sai na hora do envio, a blindagem sai e o texto é limpo para o que a
 * Meta aceita num parâmetro.
 */
export function resolverParametrosDoModelo(
  params: Record<string, string>,
  valores: ValoresDoDestinatario,
  quando?: { agora: Date; fuso: string },
): { valores: Record<string, string>; faltando: string[] } {
  const saida: Record<string, string> = {};
  const faltando = new Set<string>();
  for (const [chave, fonte] of Object.entries(params)) {
    const r = renderizar(fonte, valores, quando);
    for (const f of r.faltando) faltando.add(f);
    const texto = quando ? parametroAceitavel(r.texto) : r.texto;
    if (texto.trim() === "") faltando.add(`parametro:${chave}`);
    saida[chave] = texto;
  }
  return { valores: saida, faltando: [...faltando] };
}

/**
 * O texto do modelo com as variáveis da campanha no lugar de cada `{{n}}` —
 * cabeçalho e corpo, como `renderTemplateBody`.
 *
 * Vira o `message_body` da campanha de modelo: a prévia, a lista e o histórico
 * da conversa mostram o que a pessoa lê, e a preparação o renderiza por contato
 * com a mesma função do texto livre.
 */
export function corpoDoModelo(def: DefinicaoDoModelo, params: Record<string, string>): string {
  return renderTemplateBody(def.components, params, {
    name: def.name,
    language: def.language,
    ...(def.parameter_format ? { parameterFormat: def.parameter_format } : {}),
  });
}
