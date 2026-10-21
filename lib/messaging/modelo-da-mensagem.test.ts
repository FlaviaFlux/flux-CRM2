/**
 * Rodapé e botões do modelo aprovado — a foto gravada no envio e o leitor do
 * balão. O caso de origem: campanha com botão de link que o cliente recebia no
 * WhatsApp e a conversa do CRM não mostrava.
 */
import { describe, expect, it } from "vitest";

import { fotoDoModelo, lerModeloDaMensagem, linkSeguro } from "./modelo-da-mensagem";

const COM_BOTAO = {
  name: "pesquisa_plano_diretor",
  language: "pt_BR",
  components: [
    { type: "BODY", text: "Olá, {{1}}. A pesquisa está aberta." },
    { type: "FOOTER", text: "Clube de Campo Umuarama" },
    {
      type: "BUTTONS",
      buttons: [
        { type: "URL", text: "Responder pesquisa", url: "https://exemplo.com/p/{{1}}" },
        { type: "QUICK_REPLY", text: "Não quero" },
      ],
    },
  ],
};

describe("fotoDoModelo", () => {
  it("guarda rodapé e botões, com o sufixo do link deste envio", () => {
    const foto = fotoDoModelo(COM_BOTAO, { "1": "Ana", "button0:1": "abc123" });
    expect(foto).toEqual({
      rodape: "Clube de Campo Umuarama",
      botoes: [
        { tipo: "URL", texto: "Responder pesquisa", url: "https://exemplo.com/p/abc123", telefone: null },
        { tipo: "QUICK_REPLY", texto: "Não quero", url: null, telefone: null },
      ],
    });
  });

  it("sem rodapé nem botão, não há foto", () => {
    const soCorpo = { ...COM_BOTAO, components: [{ type: "BODY", text: "Oi" }] };
    expect(fotoDoModelo(soCorpo, {})).toBeNull();
  });
});

describe("lerModeloDaMensagem", () => {
  it("lê a foto gravada", () => {
    const foto = fotoDoModelo(COM_BOTAO, { "1": "Ana", "button0:1": "x" });
    expect(lerModeloDaMensagem({ outra: 1, modelo: foto })).toEqual(foto);
  });

  it.each([null, undefined, "x", {}, { modelo: { botoes: "não é lista" } }])(
    "forma inesperada (%j) é null, nunca exceção",
    (metadata) => {
      expect(lerModeloDaMensagem(metadata)).toBeNull();
    },
  );
});

describe("linkSeguro", () => {
  it("aceita só http e https", () => {
    expect(linkSeguro("https://a.com/x")).toBe("https://a.com/x");
    expect(linkSeguro("http://a.com")).toBe("http://a.com/");
    expect(linkSeguro("javascript:alert(1)")).toBeNull();
    expect(linkSeguro("não é url")).toBeNull();
    expect(linkSeguro(null)).toBeNull();
  });
});
