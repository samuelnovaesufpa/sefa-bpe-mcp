import { describe, expect, it } from "vitest";
import { montarChave } from "../src/services/chaveAcesso.js";
import { validarRegrasNegocio, type PayloadBPe } from "../src/services/validadorLocal.js";

const agora = new Date("2025-11-23T13:00:00Z"); // 10:00 em -03:00
const { chave, cBP } = montarChave({ cUF: "43", aamm: "2511", cnpj: "11222333000181", serie: 1, nBP: 55, tpEmis: 1, cBP: "13572468" });

const valido: PayloadBPe = {
  cUF: "43", tpEmis: 1, tpBPe: 0, modal: 1, serie: 1, nBP: 55, cBP, chBPe: chave,
  dhEmi: "2025-11-23T10:00:00-03:00",
  UFIni: "RS", cMunIni: "4314902", UFFim: "SC", cMunFim: "4205407",
  emitente: { CNPJ: "11222333000181", IE: "0960000001", UF: "RS", cMun: "4314902", TAR: "123" },
  passageiro: { xNome: "Fulano", CPF: "52998224725" },
  viagens: [{ tpTrecho: 1, dhViagem: "2025-11-24T08:00:00-03:00", tpServ: 1 }],
  dhEmb: "2025-11-24T08:00:00-03:00",
  dhValidade: "2026-11-23T10:00:00-03:00",
  valores: { vBP: 150, vDesconto: 0, vPgto: 150, componentes: [{ vComp: 140 }, { vComp: 10 }] },
  icms: { vBC: 150, pICMS: 12, vICMS: 18 },
  pagamentos: [{ tPag: "01", vPag: 150 }],
};

const ids = (p: PayloadBPe) => validarRegrasNegocio(p, agora).erros.map((e) => e.regra);

describe("validadorLocal", () => {
  it("payload válido passa", () => {
    const r = validarRegrasNegocio(valido, agora);
    expect(r.erros).toEqual([]);
    expect(r.valido).toBe(true);
    expect(r.regrasVerificadas).toContain("F59");
  });

  it("contingência: F05, F06, F07", () => {
    expect(ids({ ...valido, dhCont: "2025-11-23T09:00:00-03:00", xJust: "x" })).toContain("F05");
    expect(ids({ ...valido, tpEmis: 2, chBPe: undefined })).toContain("F06");
    expect(ids({ ...valido, tpEmis: 2, chBPe: undefined, dhCont: "2025-11-23T11:00:00-03:00", xJust: "falha de comunicacao com a sefaz" })).toContain("F07");
  });

  it("datas: embarque antes da emissão (F54), > 1 ano (F53), validade (F55), emissão futura (F51)", () => {
    expect(ids({ ...valido, dhEmb: "2025-11-22T08:00:00-03:00", viagens: [{ tpTrecho: 1 }] })).toContain("F54");
    expect(ids({ ...valido, dhEmb: "2026-12-01T08:00:00-03:00", viagens: [{ tpTrecho: 1 }] })).toContain("F53");
    expect(ids({ ...valido, dhValidade: "2026-11-22T10:00:00-03:00" })).toContain("F55");
    expect(ids({ ...valido, dhEmi: "2025-11-23T10:30:00-03:00", chBPe: undefined, dhValidade: undefined })).toContain("F51");
  });

  it("valores: componentes (F59), desconto (F60/F61/F62/F63), vPgto (F68), pagamentos (F67), ICMS (F58)", () => {
    expect(ids({ ...valido, valores: { ...valido.valores!, componentes: [{ vComp: 100 }] } })).toContain("F59");
    expect(ids({ ...valido, valores: { ...valido.valores!, tpDesconto: "99" } })).toEqual(expect.arrayContaining(["F60", "F61", "F63"]));
    expect(ids({ ...valido, valores: { ...valido.valores!, vDesconto: 10, vPgto: 140 } })).toContain("F62");
    expect(ids({ ...valido, valores: { ...valido.valores!, vPgto: 100 } })).toContain("F68");
    expect(ids({ ...valido, pagamentos: [{ tPag: "01", vPag: 10 }] })).toContain("F67");
    expect(ids({ ...valido, icms: { vBC: 150, pICMS: 12, vICMS: 20 } })).toContain("F58");
    expect(ids({ ...valido, pagamentos: [{ tPag: "03", vPag: 150 }] })).toContain("F69");
  });

  it("viagem: interestadual sem passageiro (F18), conexão fora do ferroviário (F21/F22/F23)", () => {
    expect(ids({ ...valido, passageiro: undefined })).toContain("F18");
    const r = ids({ ...valido, viagens: [{ tpTrecho: 2 }, { tpTrecho: 3 }] });
    expect(r).toEqual(expect.arrayContaining(["F21", "F23"]));
    expect(ids({ ...valido, modal: 4, viagens: [{ tpTrecho: 1 }, { tpTrecho: 3, dhConexao: "2025-11-24T10:00:00-03:00" }] })).toContain("F22");
    expect(ids({ ...valido, UFIni: "SC", cMunIni: "4205407" })).toContain("F13");
    expect(ids({ ...valido, cMunFim: "4314902" })).toContain("F15");
  });

  it("substituição (F73/F74/F75) e chave (F11)", () => {
    expect(ids({ ...valido, tpBPe: 3 })).toContain("F73");
    expect(ids({ ...valido, substituicao: { chBPe: chave, tpSub: 1 } })).toContain("F74");
    expect(ids({ ...valido, tpBPe: 3, substituicao: { chBPe: "1".repeat(44), tpSub: 1 } })).toContain("F75");
    expect(ids({ ...valido, chBPe: chave.slice(0, 43) + ((Number(chave[43]) + 1) % 10) })).toContain("F11");
  });

  it("QR Code: sign em emissão normal (F108) e chave divergente (F106)", () => {
    expect(ids({ ...valido, qrCode: `https://x/qrcode?chBPe=${chave}&tpAmb=2&sign=abc+/=` })).toContain("F108");
    expect(ids({ ...valido, qrCode: `https://x/qrcode?chBPe=${"9".repeat(44)}&tpAmb=2` })).toContain("F106");
  });

  it("emitente: CNPJ inválido (F28) e TAR no rodoviário (F37)", () => {
    expect(ids({ ...valido, emitente: { ...valido.emitente!, CNPJ: "11222333000182" } })).toContain("F28");
    expect(ids({ ...valido, emitente: { ...valido.emitente!, TAR: undefined } })).toContain("F37");
  });
});
