import { describe, expect, it } from "vitest";

import { CHANNEL_PROVIDER_META, CHANNEL_PROVIDER_WAHA } from "@/lib/channels/capabilities";

import { classificarAudiencia, type CandidatoDaAudiencia } from "./elegibilidade";
import { campanhaDependeDaJanela, foraDaJanela } from "./janela-da-campanha";

const AGORA = new Date("2026-10-19T15:00:00Z");
const HA_2H = new Date(AGORA.getTime() - 2 * 3_600_000).toISOString();
const HA_3_DIAS = new Date(AGORA.getTime() - 72 * 3_600_000).toISOString();

describe("campanhaDependeDaJanela", () => {
  it("texto no número oficial depende da janela", () => {
    expect(campanhaDependeDaJanela("text", CHANNEL_PROVIDER_META)).toBe(true);
  });
  it("modelo no número oficial NÃO depende — é o que sai fora da janela", () => {
    expect(campanhaDependeDaJanela("template", CHANNEL_PROVIDER_META)).toBe(false);
  });
  it("número QR não tem janela", () => {
    expect(campanhaDependeDaJanela("text", CHANNEL_PROVIDER_WAHA)).toBe(false);
  });
  it("provider desconhecido não barra ninguém", () => {
    expect(campanhaDependeDaJanela("text", "provider_do_futuro")).toBe(false);
  });
});

describe("foraDaJanela", () => {
  const base = { provider: CHANNEL_PROVIDER_META, agora: AGORA };

  it("texto: quem escreveu há 2h está dentro", () => {
    expect(foraDaJanela({ ...base, tipo: "text", ultimaEntrada: HA_2H })).toBe(false);
  });
  it("texto: quem escreveu há 3 dias está fora", () => {
    expect(foraDaJanela({ ...base, tipo: "text", ultimaEntrada: HA_3_DIAS })).toBe(true);
  });
  it("texto: quem nunca escreveu para o número está fora", () => {
    expect(foraDaJanela({ ...base, tipo: "text", ultimaEntrada: null })).toBe(true);
  });
  it("modelo: janela fechada ou nunca aberta não importa", () => {
    expect(foraDaJanela({ ...base, tipo: "template", ultimaEntrada: HA_3_DIAS })).toBe(false);
    expect(foraDaJanela({ ...base, tipo: "template", ultimaEntrada: null })).toBe(false);
  });
});

describe("preparação: o veto janela_fechada na classificação", () => {
  const ana: CandidatoDaAudiencia = {
    contactId: "ana",
    nome: "Ana",
    telefone: "+5544999990001",
    bloqueado: false,
    pessoal: false,
    anonimizado: false,
    recusouMarketing: false,
  };
  const bia: CandidatoDaAudiencia = {
    ...ana,
    contactId: "bia",
    nome: "Bia",
    telefone: "+5544999990002",
  };
  const ultimaEntrada: Record<string, string | null> = { ana: HA_2H, bia: null };

  const classificar = (tipo: "text" | "template") =>
    classificarAudiencia([ana, bia], {
      excluidosAMao: new Set(),
      jaEmCampanha: new Set(),
      suprimidos: new Set(),
      hashDoEndereco: (e) => `h:${e}`,
      renderizar: (c) => ({ texto: `Oi ${c.nome}`, faltando: [] }),
      janelaFechada: (c) =>
        foraDaJanela({
          tipo,
          provider: CHANNEL_PROVIDER_META,
          ultimaEntrada: ultimaEntrada[c.contactId] ?? null,
          agora: AGORA,
        }),
    });

  it("campanha de texto no oficial: quem está fora da janela vai para 'Fora da lista'", () => {
    const linhas = classificar("text");
    expect(linhas.map((l) => [l.candidato.contactId, l.elegivel, l.motivo])).toEqual([
      ["ana", true, null],
      ["bia", false, "janela_fechada"],
    ]);
  });

  it("campanha de modelo no oficial: ninguém sai por janela", () => {
    const linhas = classificar("template");
    expect(linhas.every((l) => l.elegivel)).toBe(true);
  });

  it("os vetos por pessoa continuam valendo na campanha de modelo", () => {
    const linhas = classificarAudiencia([{ ...bia, bloqueado: true }], {
      excluidosAMao: new Set(),
      jaEmCampanha: new Set(),
      suprimidos: new Set(),
      hashDoEndereco: (e) => e,
      renderizar: () => ({ texto: "x", faltando: [] }),
      janelaFechada: () => false,
    });
    expect(linhas[0]?.motivo).toBe("opt_out");
  });

  it("modelo com parâmetro sem dado do contato: variavel_ausente, não janela", () => {
    const linhas = classificarAudiencia([{ ...bia, nome: null }], {
      excluidosAMao: new Set(),
      jaEmCampanha: new Set(),
      suprimidos: new Set(),
      hashDoEndereco: (e) => e,
      renderizar: () => ({ texto: "Olá {{primeiro_nome}}", faltando: ["primeiro_nome"] }),
      janelaFechada: () => false,
    });
    expect(linhas[0]?.motivo).toBe("variavel_ausente");
  });
});
