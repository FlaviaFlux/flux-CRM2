/**
 * O ATALHO INDEXÁVEL DO COMANDO NÃO ESCONDE CONVERSA (distribuição Flux).
 *
 * `aplicarComando` põe, ao lado do `in` no campo calculado, predicados em colunas
 * de verdade (`assigned_to_user_id`, `status`) para o banco poder usar índice. Eles
 * só podem cortar o que a regra recusaria: um atalho que exclua uma linha que a
 * regra aceita some com a conversa da tela SEM erro nenhum — a lista continua
 * plausível. Este arquivo enumera os fatos que a regra lê e confere, para TODO
 * subconjunto de comandos do banco, que nenhuma linha aceita pela regra é barrada
 * pelo atalho. A controle negativa prova que a sonda tem dentes.
 */
import { describe, expect, it } from "vitest";

import {
  COMANDOS_DO_BANCO,
  aplicarComando,
  comandoDaConversa,
} from "@/lib/inbox/comando-da-conversa";

type Linha = { status: string; assigned_to_user_id: string | null };
type Predicado = (l: Linha) => boolean;

/** Consulta falsa que só guarda os predicados em coluna — o `in` do campo calculado é a regra. */
function consultaFalsa() {
  const preds: Predicado[] = [];
  const c = {
    preds,
    in: (coluna: string, _valores: readonly string[]) => {
      if (coluna !== "comando_da_conversa") throw new Error(`in inesperado em ${coluna}`);
      return c;
    },
    is: (coluna: string, valor: null) => {
      preds.push((l) => l[coluna as keyof Linha] === valor);
      return c;
    },
    not: (coluna: string, operador: string, valor: unknown) => {
      if (operador === "is") preds.push((l) => l[coluna as keyof Linha] !== valor);
      else if (operador === "in") {
        const lista = String(valor).replace(/[()]/g, "").split(",");
        preds.push((l) => !lista.includes(String(l[coluna as keyof Linha])));
      } else throw new Error(`operador inesperado: ${operador}`);
      return c;
    },
  };
  return c;
}

const STATUS = ["open", "pending", "claimed", "closed", "archived", "resolved"];
const AGORA = new Date("2026-10-27T12:00:00Z");
const SILENCIOS = [null, "infinity", "2026-10-27T13:00:00Z", "2026-10-27T11:00:00Z"];

function linhas() {
  const out: Array<Linha & { comando: string }> = [];
  for (const status of STATUS)
    for (const assigned_to_user_id of [null, "u-1"])
      for (const bot_silenced_until of SILENCIOS)
        for (const trava of [false, true])
          for (const is_group of [false, true]) {
            const { comando } = comandoDaConversa(
              { status, assigned_to_user_id, bot_silenced_until, force_human: trava, is_group },
              AGORA,
            );
            out.push({ status, assigned_to_user_id, comando: comando.quem });
          }
  return out;
}

function subconjuntos<T>(xs: readonly T[]): T[][] {
  return xs.reduce<T[][]>((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]).slice(1);
}

describe("aplicarComando — o atalho só corta o que a regra recusa", () => {
  it.each(subconjuntos(COMANDOS_DO_BANCO).map((s) => [s.join(",")]))(
    "comando=%s não esconde linha que a regra aceita",
    (pedido) => {
      const comandos = pedido.split(",");
      const { preds } = aplicarComando(consultaFalsa(), comandos);
      const escondidas = linhas().filter(
        (l) => comandos.includes(l.comando) && !preds.every((p) => p(l)),
      );
      expect(escondidas).toEqual([]);
    },
  );

  it("a Fila ganha o atalho que o índice parcial usa (dono vazio, status aberto)", () => {
    const { preds } = aplicarComando(consultaFalsa(), ["aguardando", "automatico"]);
    expect(preds).toHaveLength(2);
    const encerrada = { status: "closed", assigned_to_user_id: null };
    const comDono = { status: "open", assigned_to_user_id: "u-1" };
    expect(preds.every((p) => p(encerrada))).toBe(false);
    expect(preds.every((p) => p(comDono))).toBe(false);
  });

  it("controle negativo: um atalho errado é pego pela sonda", () => {
    // Sabotagem: tratar `humano` como se exigisse status aberto. Conversa fechada
    // com dono é `humano` — e sumiria da aba.
    const errado: Predicado = (l) => !["closed", "archived", "resolved"].includes(l.status);
    const escondidas = linhas().filter((l) => l.comando === "humano" && !errado(l));
    expect(escondidas.length).toBeGreaterThan(0);
  });
});
