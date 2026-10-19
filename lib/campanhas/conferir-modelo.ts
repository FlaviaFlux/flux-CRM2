/**
 * Confere, ao SALVAR a campanha, que o modelo escolhido serve: é deste número
 * oficial, está aprovado e todo parâmetro tem fonte. Devolve o texto do modelo
 * (com as variáveis da campanha) que vira o `message_body`.
 *
 * Conferir ao salvar, e não só no envio, é o que impede o operador de preparar
 * uma lista inteira para um modelo que a Meta vai recusar contato por contato.
 * O envio confere de novo (`conferirDefinicao`, no handler) porque entre um e
 * outro o modelo pode ser pausado na Meta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { linhaDoEspelho } from "@/lib/channels/linha-do-espelho";
import { isStatusSendable } from "@/lib/channels/meta/template-binding";
import { fonteDeTemplates } from "@/lib/channels/templates-fonte";

import { corpoDoModelo, errosDoMapeamento } from "./modelo-da-campanha";

export type ConferenciaDoModelo =
  | { ok: true; corpo: string; categoria: string | null }
  | { ok: false; mensagem: string };

/** O número aceita campanha de modelo? Só o da API oficial, cujos modelos o espelho guarda. */
export async function numeroAceitaModelo(
  admin: SupabaseClient,
  organizationId: string,
  channelSessionId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("channel_sessions")
    .select("provider")
    .eq("organization_id", organizationId)
    .eq("id", channelSessionId)
    .maybeSingle();
  return fonteDeTemplates((data as { provider?: string | null } | null)?.provider) === "oficial";
}

export async function conferirModeloDaCampanha(
  admin: SupabaseClient,
  entrada: {
    organizationId: string;
    channelSessionId: string;
    name: string;
    language: string;
    params: Record<string, string>;
  },
): Promise<ConferenciaDoModelo> {
  if (!(await numeroAceitaModelo(admin, entrada.organizationId, entrada.channelSessionId))) {
    return {
      ok: false,
      mensagem:
        "Modelo aprovado só existe em número da API oficial (Meta). Escolha um número oficial ou envie texto.",
    };
  }

  const { data, error } = await linhaDoEspelho<{
    name: string;
    language: string;
    status: string;
    category: string | null;
    components: unknown;
    parameter_format: string | null;
  }>(admin, "name, language, status, category, components, parameter_format", {
    organizationId: entrada.organizationId,
    name: entrada.name,
    language: entrada.language,
    channelSessionId: entrada.channelSessionId,
  });
  if (error) return { ok: false, mensagem: `Não foi possível ler os modelos: ${error.message}` };
  if (!data) {
    return {
      ok: false,
      mensagem:
        `O modelo "${entrada.name}" (${entrada.language}) não está entre os modelos sincronizados deste ` +
        "número. Sincronize em Conexões › API Oficial › Templates da Meta.",
    };
  }
  if (!isStatusSendable(data.status)) {
    return {
      ok: false,
      mensagem: `O modelo "${entrada.name}" está ${data.status} na Meta — só modelo APROVADO pode ser enviado.`,
    };
  }
  const erros = errosDoMapeamento(data, entrada.params);
  if (erros.length > 0) return { ok: false, mensagem: erros.join(" ") };

  return { ok: true, corpo: corpoDoModelo(data, entrada.params), categoria: data.category };
}
