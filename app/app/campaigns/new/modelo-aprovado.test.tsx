/**
 * Campanha por número OFICIAL troca o texto livre pelo MODELO APROVADO
 * (migration 0800). Mede a tela: o seletor só aparece para número oficial, só
 * lista modelo APROVADO, mostra categoria e o aviso de custo do MARKETING, e o
 * que sai no POST é o modelo com o mapeamento de cada parâmetro.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NovaCampanha } from "./_client";

const criar = vi.hoisted(() => ({
  mutateAsync: vi.fn(async () => ({ id: "nova" })),
  isPending: false,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));
vi.mock("@/hooks/campanhas/useCampanhas", () => ({
  useCriarCampanha: () => criar,
  usePreviaDaAudiencia: () => ({ isPending: false, mutate: vi.fn(), data: undefined }),
}));
// O provider sai da CAPACIDADE, nunca do nome (doutrina restricao-de-canal).
vi.mock("@/hooks/channels/useChannelSessions", async () => {
  const { PROVIDERS_DE_MENSAGEM, capabilitiesOf } = await import("@/lib/channels/capabilities");
  const { fonteDeTemplates } = await import("@/lib/channels/templates-fonte");
  const oficial = PROVIDERS_DE_MENSAGEM.find((p) => fonteDeTemplates(p) === "oficial");
  const qr = PROVIDERS_DE_MENSAGEM.find((p) => capabilitiesOf(p).freeformOutsideWindow);
  const canais = [
    { id: "oficial", provider: oficial, display_name: "Clube de Campo Umuarama" },
    { id: "qr", provider: qr, display_name: "Recepção (QR)" },
  ];
  return {
    useChannelSessions: () => ({ data: canais, isLoading: false }),
    channelLabel: (c: { display_name?: string | null }) => c.display_name ?? "Número sem nome",
  };
});
vi.mock("@/hooks/campanhas/useDestinoDaCampanha", () => ({
  useFunis: () => ({ data: [], isLoading: false }),
  useEtapas: () => ({ data: [], isLoading: false }),
  useAgentesPublicados: () => ({ data: [], isLoading: false }),
}));

const MODELOS = [
  {
    name: "pesquisa_plano_diretor",
    language: "pt_BR",
    status: "APPROVED",
    category: "UTILITY",
    parameterFormat: "POSITIONAL",
    components: [
      { type: "BODY", text: "Olá {{1}}! O clube quer ouvir você sobre o plano diretor." },
      { type: "FOOTER", text: "Clube de Campo Umuarama" },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Quero responder" }] },
    ],
  },
  {
    name: "promo_verao",
    language: "pt_BR",
    status: "APPROVED",
    category: "MARKETING",
    components: [{ type: "BODY", text: "Promoção de verão!" }],
  },
  {
    name: "ainda_em_analise",
    language: "pt_BR",
    status: "PENDING",
    category: "UTILITY",
    components: [],
  },
];

vi.mock("@/lib/api/client", () => ({
  apiClient: { get: vi.fn(async () => ({ data: { waba: "w1", templates: MODELOS } })) },
}));

function comConsulta(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

function preencherBasico() {
  fireEvent.change(screen.getByLabelText("Nome da campanha"), {
    target: { value: "Plano diretor" },
  });
  fireEvent.change(screen.getByLabelText("Com alguma destas etiquetas"), {
    target: { value: "teste" },
  });
}

describe("nova campanha por número oficial: modelo aprovado", () => {
  beforeEach(() => criar.mutateAsync.mockClear());

  it("número QR continua com texto livre e sem seletor de modelo", () => {
    render(comConsulta(<NovaCampanha />));
    fireEvent.change(screen.getByLabelText("Enviar pelo número"), { target: { value: "qr" } });
    expect(screen.getByLabelText("Texto da mensagem")).toBeInTheDocument();
    expect(screen.queryByLabelText("Modelo aprovado")).not.toBeInTheDocument();
  });

  it("número oficial: só modelos APROVADOS, com categoria e prévia; o POST leva o mapeamento", async () => {
    render(comConsulta(<NovaCampanha />));
    preencherBasico();
    fireEvent.change(screen.getByLabelText("Enviar pelo número"), { target: { value: "oficial" } });

    const seletor = await screen.findByLabelText("Modelo aprovado");
    await waitFor(() => expect(seletor.querySelectorAll("option").length).toBe(3));
    expect(seletor.textContent).not.toMatch(/ainda_em_analise/);

    fireEvent.change(seletor, { target: { value: "pesquisa_plano_diretor|pt_BR" } });
    expect(screen.getByTestId("categoria-do-modelo")).toHaveTextContent("UTILITY");
    expect(screen.getByTestId("previa-do-modelo")).toHaveTextContent("Clube de Campo Umuarama");
    expect(screen.getByTestId("previa-do-modelo")).toHaveTextContent("Quero responder");

    // Sem fonte para o {{1}}, não salva.
    const salvar = screen.getByRole("button", { name: "Salvar rascunho" });
    expect(salvar).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Fonte do parâmetro {{1}}"), {
      target: { value: "{{primeiro_nome}}" },
    });
    expect(screen.getByTestId("previa-do-modelo")).toHaveTextContent("Olá {{primeiro_nome}}!");
    expect(salvar).toBeEnabled();

    fireEvent.click(salvar);
    await waitFor(() => expect(criar.mutateAsync).toHaveBeenCalledTimes(1));
    expect(criar.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_session_id: "oficial",
        message_kind: "template",
        template_name: "pesquisa_plano_diretor",
        template_language: "pt_BR",
        template_params: { "1": "{{primeiro_nome}}" },
        message_body: "Olá {{primeiro_nome}}! O clube quer ouvir você sobre o plano diretor.",
        channel_session_ids: [],
      }),
    );
  });

  it("modelo de MARKETING mostra o aviso de custo", async () => {
    render(comConsulta(<NovaCampanha />));
    fireEvent.change(screen.getByLabelText("Enviar pelo número"), { target: { value: "oficial" } });
    const seletor = await screen.findByLabelText("Modelo aprovado");
    await waitFor(() => expect(seletor.querySelectorAll("option").length).toBe(3));
    fireEvent.change(seletor, { target: { value: "promo_verao|pt_BR" } });
    expect(screen.getByRole("note")).toHaveTextContent(/MARKETING/);
  });

  it("texto livre no número oficial avisa que só chega a quem está na janela de 24h", () => {
    render(comConsulta(<NovaCampanha />));
    fireEvent.change(screen.getByLabelText("Enviar pelo número"), { target: { value: "oficial" } });
    fireEvent.click(screen.getByLabelText(/Texto livre/));
    expect(screen.getByLabelText("Texto da mensagem")).toBeInTheDocument();
    expect(screen.getByText(/a Meta recusa texto livre fora dessa janela/)).toBeInTheDocument();
  });
});
