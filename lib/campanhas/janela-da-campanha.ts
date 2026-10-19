/**
 * Quando a janela de 24h decide quem entra na campanha — puro.
 *
 * ═══ A regra ═══
 *
 * - Campanha de TEXTO num número que só aceita texto livre dentro da janela (API
 *   oficial): quem não escreveu nas últimas 24h para AQUELE número fica fora,
 *   com `janela_fechada`. Antes disto a pessoa entrava na lista, a Meta recusava
 *   com 131047 e ela aparecia em "Falharam" — o operador descobria a regra pelo
 *   prejuízo, depois de apertar.
 * - Campanha de MODELO: a janela não importa. Modelo aprovado é exatamente o que
 *   a plataforma aceita fora dela.
 * - Número QR (sem restrição de janela): a pergunta nem se faz.
 *
 * A régua da janela não é refeita aqui: é `canalAceitaTextoLivreAgora`, a mesma
 * da Inbox e do lembrete de agenda.
 */
import { capabilitiesOf, type ChannelProvider } from "@/lib/channels/capabilities";
import { canalAceitaTextoLivreAgora } from "@/lib/channels/janela";

import type { TipoDeMensagem } from "./tipos";

/** Esta campanha, neste número, depende da janela de 24h? */
export function campanhaDependeDaJanela(
  tipo: TipoDeMensagem,
  provider: string | null | undefined,
): boolean {
  if (tipo === "template") return false;
  if (!provider) return false;
  try {
    return !capabilitiesOf(provider as ChannelProvider).freeformOutsideWindow;
  } catch {
    // Provider que esta imagem não conhece: barrar por uma regra que não
    // existe puniria um canal que talvez envie — mesma direção de
    // `canalAceitaTextoLivreAgora`.
    return false;
  }
}

/** A pessoa está fora da janela, para esta campanha e este número? */
export function foraDaJanela(entrada: {
  tipo: TipoDeMensagem;
  provider: string | null | undefined;
  /** `conversations.last_inbound_at` da conversa DESTE número; `null` = nunca escreveu. */
  ultimaEntrada: string | null;
  agora: Date;
}): boolean {
  if (!campanhaDependeDaJanela(entrada.tipo, entrada.provider)) return false;
  return !canalAceitaTextoLivreAgora(entrada.provider, entrada.ultimaEntrada, entrada.agora);
}
