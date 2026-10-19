import { describe, expect, it } from "vitest";

import {
  corpoDoModelo,
  errosDoMapeamento,
  resolverParametrosDoModelo,
  slotsDoModelo,
} from "./modelo-da-campanha";

/** O modelo do roteiro de teste: `pesquisa_plano_diretor`, pt_BR, um parâmetro no corpo. */
const PESQUISA = {
  name: "pesquisa_plano_diretor",
  language: "pt_BR",
  parameter_format: "POSITIONAL",
  components: [
    { type: "BODY", text: "Olá {{1}}! O clube quer ouvir você sobre o plano diretor." },
    { type: "FOOTER", text: "Clube de Campo Umuarama" },
    { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Quero responder" }] },
  ],
};

const COM_LINK = {
  name: "convite",
  language: "pt_BR",
  components: [
    { type: "HEADER", format: "TEXT", text: "{{1}}, temos novidade" },
    { type: "BODY", text: "{{1}}, {{2}}" },
    { type: "BUTTONS", buttons: [{ type: "URL", text: "Abrir", url: "https://x.com/{{1}}" }] },
  ],
};

describe("slotsDoModelo", () => {
  it("lista a chave de cada parâmetro com o endereço — a mesma slotKey do envio", () => {
    expect(slotsDoModelo(PESQUISA).map((s) => s.chave)).toEqual(["1"]);
    expect(slotsDoModelo(COM_LINK).map((s) => s.chave)).toEqual(["header:1", "1", "2", "button0:1"]);
  });
});

describe("errosDoMapeamento", () => {
  it("aceita quando todo parâmetro tem fonte", () => {
    expect(errosDoMapeamento(PESQUISA, { "1": "{{primeiro_nome}}" })).toEqual([]);
  });

  it("aponta o parâmetro sem fonte e a chave que o modelo não tem", () => {
    const erros = errosDoMapeamento(PESQUISA, { "2": "x" });
    expect(erros.join(" ")).toMatch(/\{\{1\}\}/);
    expect(erros.join(" ")).toMatch(/2/);
  });

  it("valor em branco conta como sem fonte", () => {
    expect(errosDoMapeamento(PESQUISA, { "1": "   " })).toHaveLength(1);
  });
});

describe("resolverParametrosDoModelo", () => {
  it("resolve {{primeiro_nome}} por contato", () => {
    const r = resolverParametrosDoModelo({ "1": "{{primeiro_nome}}" }, { nome: "Ana Maria Souza" });
    expect(r.faltando).toEqual([]);
    expect(r.valores).toEqual({ "1": "Ana" });
  });

  it("texto fixo passa como está", () => {
    const r = resolverParametrosDoModelo({ "1": "Associado" }, { nome: null });
    expect(r).toEqual({ valores: { "1": "Associado" }, faltando: [] });
  });

  it("contato sem o dado exigido: FALTA, nunca parâmetro vazio", () => {
    const r = resolverParametrosDoModelo({ "1": "{{primeiro_nome}}" }, { nome: "  " });
    expect(r.faltando).toEqual(["primeiro_nome"]);
  });

  it("{{saudacao}} fica literal sem instante e resolve no envio, no fuso do canal", () => {
    const params = { "1": "{{saudacao}}, {{primeiro_nome}}" };
    const congelado = resolverParametrosDoModelo(params, { nome: "Ana" });
    expect(congelado.valores["1"]).toBe("{{saudacao}}, Ana");

    const final = resolverParametrosDoModelo(congelado.valores, { nome: "Ana" }, {
      agora: new Date("2026-10-19T13:00:00Z"),
      fuso: "America/Sao_Paulo",
    });
    expect(final.valores["1"]).toBe("Bom dia, Ana");
  });

  it("valor do cadastro com chaves não vira token na segunda passada", () => {
    const congelado = resolverParametrosDoModelo({ "1": "{{nome}}" }, { nome: "{{saudacao}} Ana" });
    const final = resolverParametrosDoModelo(congelado.valores, { nome: "x" }, {
      agora: new Date("2026-10-19T13:00:00Z"),
      fuso: "America/Sao_Paulo",
    });
    expect(final.valores["1"]).toBe("{{saudacao}} Ana");
  });

  it("no envio, quebra de linha e espaço em excesso viram um espaço (a Meta recusa parâmetro com \\n)", () => {
    const final = resolverParametrosDoModelo({ "1": "Ana\n\tMaria     Souza" }, { nome: null }, {
      agora: new Date("2026-10-19T13:00:00Z"),
      fuso: "America/Sao_Paulo",
    });
    expect(final.valores["1"]).toBe("Ana Maria Souza");
  });
});

describe("corpoDoModelo", () => {
  it("é o texto do modelo com as variáveis da campanha no lugar de cada {{n}}", () => {
    expect(corpoDoModelo(PESQUISA, { "1": "{{primeiro_nome}}" })).toBe(
      "Olá {{primeiro_nome}}! O clube quer ouvir você sobre o plano diretor.",
    );
  });

  it("cabeçalho e corpo não confundem o {{1}} de um com o do outro", () => {
    expect(corpoDoModelo(COM_LINK, { "header:1": "{{nome}}", "1": "Oi", "2": "fixo" })).toBe(
      "{{nome}}, temos novidade\n\nOi, fixo",
    );
  });
});
