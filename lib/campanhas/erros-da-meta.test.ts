import { describe, expect, it } from "vitest";

import { codigoDaFalha, codigoDaMeta, falhaDefinitiva, motivoDaFalha } from "./erros-da-meta";

describe("codigoDaMeta", () => {
  it("lê o código do erro síncrono gravado pelo handler", () => {
    expect(codigoDaMeta("meta_131026: Message undeliverable")).toBe("131026");
  });
  it("aceita o código cru que o webhook grava", () => {
    expect(codigoDaMeta("131049")).toBe("131049");
  });
  it("não inventa código de texto qualquer", () => {
    expect(codigoDaMeta("template_not_approved: x")).toBeNull();
    expect(codigoDaMeta(null)).toBeNull();
  });
});

describe("codigoDaFalha", () => {
  it("prefere o código da Meta, depois o prefixo interno, depois send_failed", () => {
    expect(codigoDaFalha("meta_131042: Business eligibility payment issue")).toBe("131042");
    expect(codigoDaFalha('template_not_approved: "x" (pt_BR) está PAUSED')).toBe("template_not_approved");
    expect(codigoDaFalha("algo estranho")).toBe("send_failed");
    expect(codigoDaFalha(undefined)).toBe("send_failed");
  });
});

describe("motivoDaFalha", () => {
  it.each([
    ["131042", /pagamento/],
    ["131026", /sem WhatsApp/],
    ["131049", /marketing/],
    ["130472", /experimento/],
  ])("%s tem frase legível", (codigo, frase) => {
    expect(motivoDaFalha(codigo)).toMatch(frase);
  });

  it("código desconhecido da Meta aparece com o número, não some", () => {
    expect(motivoDaFalha("999999")).toBe("Erro 999999 da Meta.");
  });

  it("os quatro erros do roteiro são definitivos — não se reenvia", () => {
    for (const c of ["131042", "131026", "131049", "130472"]) expect(falhaDefinitiva(c)).toBe(true);
    expect(falhaDefinitiva("130429")).toBe(false);
  });
});
