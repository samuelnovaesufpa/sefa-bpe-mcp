import { describe, expect, it } from "vitest";
import { codigosStatus } from "../src/resources/dataStore.js";
import { diagnosticarRejeicao, extrairComplementos } from "../src/services/diagnostico.js";

describe("bpe_diagnosticar_rejeicao", () => {
  it("215 — falha de schema aponta regra C01", () => {
    const d = diagnosticarRejeicao(215);
    expect(d.encontrado).toBe(true);
    expect(d.mensagem).toBe("Rejeição: Falha no schema XML");
    expect(d.regrasVioladas.map((r) => r.id)).toContain("C01");
    expect(d.acaoCorretiva).toMatch(/XSD/);
  });

  it("539 — duplicidade com diferença de chave aponta F98 e extrai complementos do xMotivo", () => {
    const d = diagnosticarRejeicao("539", "Rejeição: Duplicidade de BP-e, com diferença na Chave de Acesso [chBPe: 43251111222333000181630010000001231100000006][nProt:343250000000001][dhAut: 2025-11-23T10:00:00-03:00]");
    expect(d.regrasVioladas[0]).toMatchObject({ id: "F98", grupo: "F", cStat: 539 });
    expect(d.detalhesXMotivo).toMatchObject({ chBPe: "43251111222333000181630010000001231100000006", nProt: "343250000000001" });
    expect(d.complementoEsperado).toContain("chBPe");
  });

  it("678 — uso indevido lista CI01, CI03, CI04, CI05 e alerta", () => {
    const d = diagnosticarRejeicao(678);
    expect(d.categoria).toBe("uso_indevido");
    expect(d.regrasVioladas.map((r) => r.id)).toEqual(["CI01", "CI03", "CI04", "CI05"]);
    expect(d.alertaUsoIndevido).toMatch(/1 hora/);
  });

  it("filtra regras do grupo J por evento", () => {
    const d = diagnosticarRejeicao(636, undefined, { tpEvento: "110116" });
    expect(d.regrasVioladas).toHaveLength(1);
    expect(d.regrasVioladas[0]).toMatchObject({ id: "J02", evento: "110116" });
    expect(d.regrasVioladas[0]!.regra).toMatch(/99/);
  });

  it("códigos de sucesso", () => {
    expect(diagnosticarRejeicao(100)).toMatchObject({ tipo: "sucesso", encontrado: true });
    expect(diagnosticarRejeicao(107).mensagem).toBe("Serviço em Operação");
  });

  it("código desconhecido", () => {
    expect(diagnosticarRejeicao(123)).toMatchObject({ encontrado: false });
  });

  it("base completa: todos os cStat do MOC 8.2 estão carregados e têm ação corretiva", () => {
    const cods = codigosStatus();
    expect(cods.length).toBe(182);
    for (const c of cods) expect(c.acao_corretiva.length).toBeGreaterThan(5);
    for (const req of [100, 101, 102, 107, 108, 109, 134, 135, 136, 150, 203, 204, 236, 253, 539, 598, 599, 678, 999]) {
      expect(cods.find((c) => c.cStat === req)).toBeDefined();
    }
  });

  it("extrai complementos", () => {
    expect(extrairComplementos("Rejeição: Chave de Acesso inválida [Motivo: DV inválido]")).toEqual({ Motivo: "DV inválido" });
  });
});
