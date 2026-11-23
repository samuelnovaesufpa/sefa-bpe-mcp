import { describe, expect, it } from "vitest";
import { aammDeData, calcularDV, decomporChave, gerarCodigoNumerico, montarChave, restoModulo11, validarChave } from "../src/services/chaveAcesso.js";

describe("chaveAcesso — Módulo 11", () => {
  it("reproduz o exemplo do MOC 8.4 (soma 644, resto 6, DV 5)", () => {
    const base = "5206043300991100250655012000000780026730161";
    expect(restoModulo11(base)).toBe(6);
    expect(calcularDV(base)).toBe(5);
  });

  it("resto 0 → DV 0", () => {
    const base = "4325111122233300018163001000000123110087109";
    expect(restoModulo11(base)).toBe(0);
    expect(calcularDV(base)).toBe(0);
  });

  it("resto 1 → DV 0", () => {
    const base = "4325111122233300018163001000000123110023757";
    expect(restoModulo11(base)).toBe(1);
    expect(calcularDV(base)).toBe(0);
  });

  it("restos normais → DV = 11 - resto", () => {
    const base = "4325111122233300018163001000000123110000000";
    expect(restoModulo11(base)).toBe(5);
    expect(calcularDV(base)).toBe(6);
  });

  it("rejeita base que não tem 43 dígitos", () => {
    expect(() => calcularDV("123")).toThrow();
    expect(() => calcularDV("a".repeat(43))).toThrow();
  });
});

describe("chaveAcesso — montagem e validação", () => {
  const comp = { cUF: "43", aamm: "2511", cnpj: "11.222.333/0001-81", serie: 1, nBP: 123, tpEmis: 1, cBP: "10000000" } as const;

  it("monta a chave com 44 dígitos na ordem cUF+AAMM+CNPJ+63+serie+nBP+tpEmis+cBP+DV", () => {
    const { chave, id, dv } = montarChave(comp);
    expect(chave).toHaveLength(44);
    expect(chave).toBe("4325111122233300018163001000000123110000000" + "6");
    expect(dv).toBe(6);
    expect(id).toBe(`BPe${chave}`);
    const d = decomporChave(chave);
    expect(d).toMatchObject({ cUF: "43", aamm: "2511", cnpj: "11222333000181", mod: "63", serie: "001", nBP: "000000123", tpEmis: "1", cBP: "10000000", cDV: "6" });
  });

  it("gera cBP aleatório de 8 dígitos quando omitido", () => {
    const { cBP, chave } = montarChave({ ...comp, cBP: undefined });
    expect(cBP).toMatch(/^\d{8}$/);
    expect(validarChave(chave, new Date("2025-12-01")).valida).toBe(true);
    expect(gerarCodigoNumerico(12345678)).not.toBe("12345678");
  });

  it("valida chave correta", () => {
    const { chave } = montarChave(comp);
    expect(validarChave(chave, new Date("2025-12-01"))).toMatchObject({ valida: true, motivos: [] });
  });

  it("aponta os motivos da rejeição 236", () => {
    const { chave } = montarChave(comp);
    const dvErrado = chave.slice(0, 43) + ((Number(chave[43]) + 1) % 10);
    expect(validarChave(dvErrado, new Date("2025-12-01")).motivos).toContain("DV inválido");

    const base = "99" + "1613" + "00000000000000" + "55" + "001" + "000000000" + "7" + "12345678";
    const r = validarChave(base + calcularDV(base), new Date("2025-12-01"));
    expect(r.valida).toBe(false);
    expect(r.motivos).toEqual(expect.arrayContaining(["UF inválida", "Ano < 2017 ou maior que atual", "Mês inválido (0 ou > 12)", "CNPJ zerado", "Modelo diferente de 63", "Número zerado", "Tipo de emissão inválido"]));
  });

  it("rejeita chave com tamanho errado", () => {
    expect(validarChave("123").valida).toBe(false);
  });

  it("extrai AAMM de data ISO", () => {
    expect(aammDeData("2025-11-23T10:00:00-03:00")).toBe("2511");
  });
});
