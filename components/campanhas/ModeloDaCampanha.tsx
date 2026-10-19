"use client";
/**
 * O seletor de MODELO APROVADO da campanha (migration 0800) — aparece no lugar
 * do texto livre quando o número escolhido é da API oficial.
 *
 * ═══ A mesma lista da Inbox ═══
 *
 * Lê a rota que a Inbox lê na janela fechada (`rotaDeTemplates`), com a mesma
 * chave de cache, e filtra `APPROVED` do mesmo jeito. Quem confere de verdade
 * que o modelo é DESTE número e está aprovado é o servidor, ao salvar.
 *
 * ═══ Um campo por parâmetro, com fonte ═══
 *
 * Cada `{{n}}` do modelo recebe uma fonte: o primeiro nome, o nome completo, a
 * saudação da hora ou um texto fixo. O valor gravado é o texto com a variável
 * da campanha (`{{primeiro_nome}}`), resolvido por contato pelo mesmo
 * renderizador do texto livre — e quem não tem o dado fica fora da lista.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { corpoDoModelo, slotsDoModelo } from "@/lib/campanhas/modelo-da-campanha";
import { renderTemplatePreview } from "@/lib/channels/meta/render-template";
import { rotaDeTemplates, type FonteDeTemplates } from "@/lib/channels/templates-fonte";

interface ModeloDaLista {
  name: string;
  language: string;
  status: string;
  category?: string | null;
  parameterFormat?: string;
  components?: unknown[];
  savedValues?: Record<string, string>;
}

export interface EscolhaDoModelo {
  nome: string;
  idioma: string;
  params: Record<string, string>;
}

/** O que o formulário precisa saber do modelo escolhido para a prévia e o botão salvar. */
export interface ResumoDoModelo {
  corpo: string;
  completo: boolean;
  categoria: string | null;
}

const FONTES = [
  { valor: "{{primeiro_nome}}", rotulo: "Primeiro nome do contato" },
  { valor: "{{nome}}", rotulo: "Nome completo do contato" },
  { valor: "{{saudacao}}", rotulo: "Saudação da hora (Bom dia / Boa tarde / Boa noite)" },
] as const;

const FIXO = "__fixo__";

function fonteDoValor(valor: string | undefined): string {
  if (valor === undefined) return "";
  return FONTES.some((f) => f.valor === valor) ? valor : FIXO;
}

/** O resumo a partir da escolha — puro, para o formulário calcular sem esperar o componente. */
export function resumirModelo(
  modelo: ModeloDaLista | null,
  params: Record<string, string>,
): ResumoDoModelo | null {
  if (!modelo) return null;
  const def = {
    name: modelo.name,
    language: modelo.language,
    parameter_format: modelo.parameterFormat ?? null,
    components: modelo.components ?? [],
  };
  const slots = slotsDoModelo(def);
  return {
    corpo: corpoDoModelo(def, params) || modelo.name,
    completo: slots.every((s) => (params[s.chave] ?? "").trim() !== ""),
    categoria: modelo.category ?? null,
  };
}

export function useModelosAprovados(fonte: FonteDeTemplates | null) {
  const consulta = useQuery({
    // A MESMA chave da janela fechada da Inbox: a lista é a mesma.
    queryKey: ["templates-da-conversa", fonte],
    enabled: fonte !== null,
    queryFn: async () =>
      apiClient.get<{ data: { templates: ModeloDaLista[] } }>(rotaDeTemplates(fonte!)),
    staleTime: 30_000,
  });
  const aprovados = useMemo(
    () =>
      (consulta.data?.data.templates ?? []).filter(
        (tpl) => tpl.status?.toUpperCase() === "APPROVED",
      ),
    [consulta.data],
  );
  return { ...consulta, aprovados };
}

export function ModeloDaCampanha({
  fonte,
  valor,
  onChange,
}: {
  fonte: FonteDeTemplates;
  valor: EscolhaDoModelo;
  onChange: (v: EscolhaDoModelo) => void;
}) {
  const t = useT();
  const { aprovados, isLoading, isError } = useModelosAprovados(fonte);
  const atual =
    aprovados.find((tpl) => tpl.name === valor.nome && tpl.language === valor.idioma) ?? null;

  const def = atual
    ? {
        name: atual.name,
        language: atual.language,
        parameter_format: atual.parameterFormat ?? null,
        components: atual.components ?? [],
      }
    : null;
  const slots = def ? slotsDoModelo(def) : [];
  const previa = atual
    ? renderTemplatePreview(atual.components ?? [], valor.params, {
        name: atual.name,
        language: atual.language,
        ...(atual.parameterFormat ? { parameterFormat: atual.parameterFormat } : {}),
      })
    : null;
  const categoria = (atual?.category ?? "").toUpperCase();

  function escolher(chave: string) {
    const novo = aprovados.find((tpl) => `${tpl.name}|${tpl.language}` === chave) ?? null;
    if (!novo) {
      onChange({ nome: "", idioma: "", params: {} });
      return;
    }
    // Links de mídia salvos no modelo (Conexões › Templates) já vêm preenchidos;
    // o resto começa vazio, para a fonte ser escolha do operador e não chute.
    onChange({ nome: novo.name, idioma: novo.language, params: { ...(novo.savedValues ?? {}) } });
  }

  function mudarParam(chave: string, v: string) {
    onChange({ ...valor, params: { ...valor.params, [chave]: v } });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="modelo">{t("Modelo aprovado")}</Label>
        <select
          id="modelo"
          className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
          value={atual ? `${atual.name}|${atual.language}` : ""}
          onChange={(e) => escolher(e.target.value)}
          disabled={isLoading}
        >
          <option value="">
            {isLoading ? t("Carregando modelos…") : t("Escolha um modelo aprovado")}
          </option>
          {aprovados.map((tpl) => (
            <option key={`${tpl.name}|${tpl.language}`} value={`${tpl.name}|${tpl.language}`}>
              {tpl.name} ({tpl.language}){tpl.category ? ` · ${tpl.category}` : ""}
            </option>
          ))}
        </select>
        {isError && (
          <p className="text-sm text-error-fg">
            {t("Não foi possível carregar os modelos deste número.")}
          </p>
        )}
        {!isLoading && !isError && aprovados.length === 0 && (
          <p className="text-sm text-warning-fg">
            {t(
              "Nenhum modelo aprovado. Sincronize em Conexões › API Oficial › Templates da Meta, ou crie um modelo no WhatsApp Manager.",
            )}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {t(
            "Número oficial só envia texto livre para quem escreveu nas últimas 24h. Modelo aprovado chega a quem está fora dessa janela.",
          )}
        </p>
      </div>

      {atual && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className="rounded-full border border-border bg-surface-elevated px-2 py-0.5 font-medium"
              data-testid="categoria-do-modelo"
            >
              {categoria || t("Sem categoria")}
            </span>
            <span className="text-muted-foreground">{atual.language}</span>
          </div>
          {categoria === "MARKETING" && (
            <p
              className="rounded-md border border-warning-fg/40 p-2 text-sm text-warning-fg"
              role="note"
            >
              {t(
                "Modelo de MARKETING: a Meta cobra por mensagem entregue, com tarifa maior que a de UTILITY, e pode segurar entregas para quem já recebeu muito marketing (erro 131049). Para aviso, pesquisa ou lembrete, prefira um modelo UTILITY.",
              )}
            </p>
          )}

          {previa && (
            <div
              className="space-y-1.5 rounded-md border border-border bg-surface-elevated p-3 text-sm"
              data-testid="previa-do-modelo"
            >
              {previa.cabecalho && <p className="font-semibold">{previa.cabecalho}</p>}
              {previa.midia && (
                <p className="text-xs text-muted-foreground">
                  [{previa.midia.formato}] {previa.midia.link ?? t("falta o link da mídia")}
                </p>
              )}
              <p className="whitespace-pre-wrap">{previa.corpo}</p>
              {previa.rodape && <p className="text-xs text-muted-foreground">{previa.rodape}</p>}
              {previa.botoes.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {previa.botoes.map((b, i) => (
                    <span
                      key={i}
                      className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs"
                    >
                      {b.texto}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {slots.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("Este modelo não tem parâmetros: sai igual para todos.")}
            </p>
          ) : (
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">{t("De onde vem cada parâmetro")}</legend>
              {slots.map((s) => {
                const v = valor.params[s.chave];
                const fonteAtual = fonteDoValor(v);
                const texto = s.espera === "text";
                return (
                  <div key={s.chave} className="space-y-1">
                    <Label htmlFor={`param-${s.chave}`}>
                      <span className="font-mono">{s.rotulo}</span> — {t(s.onde)}
                      {s.contextoAntes || s.contextoDepois ? (
                        <span className="ml-1 font-normal text-muted-foreground">
                          “…{s.contextoAntes}
                          <strong>{s.rotulo}</strong>
                          {s.contextoDepois}…”
                        </span>
                      ) : null}
                    </Label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      {texto && (
                        <select
                          id={`param-${s.chave}`}
                          aria-label={`${t("Fonte do parâmetro")} ${s.rotulo}`}
                          className="h-9 rounded-md border border-border bg-surface px-2 text-sm sm:w-72"
                          value={fonteAtual}
                          onChange={(e) =>
                            mudarParam(s.chave, e.target.value === FIXO ? "" : e.target.value)
                          }
                        >
                          <option value="">{t("Escolha a fonte")}</option>
                          {FONTES.map((f) => (
                            <option key={f.valor} value={f.valor}>
                              {t(f.rotulo)}
                            </option>
                          ))}
                          <option value={FIXO}>{t("Texto fixo")}</option>
                        </select>
                      )}
                      {(!texto || fonteAtual === FIXO) && (
                        <Input
                          id={texto ? undefined : `param-${s.chave}`}
                          aria-label={`${t("Valor do parâmetro")} ${s.rotulo}`}
                          value={v ?? ""}
                          onChange={(e) => mudarParam(s.chave, e.target.value)}
                          placeholder={
                            texto
                              ? t("Texto igual para todos")
                              : t("Link (https://…) ou valor do parâmetro")
                          }
                        />
                      )}
                    </div>
                  </div>
                );
              })}
              <p className="text-sm text-muted-foreground">
                {t(
                  "Quem não tiver o dado escolhido fica fora da lista, com o motivo — parâmetro vazio a Meta recusa.",
                )}
              </p>
            </fieldset>
          )}
        </>
      )}
    </div>
  );
}
