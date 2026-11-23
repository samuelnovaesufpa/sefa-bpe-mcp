import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { montarChave } from "../src/services/chaveAcesso.js";
import { assinarChaveQrCode, gerarSvgQrCode, montarUrlQrCode, QRCODE_CONFIG, verificarAssinaturaQrCode } from "../src/services/qrCode.js";

const URL_SVRS = "https://dfe-portal.svrs.rs.gov.br/bpe/qrCode";
const base = { cUF: "43", aamm: "2511", cnpj: "11222333000181", serie: 1, nBP: 10, cBP: "87654321" };

describe("qrCode", () => {
  it("emissão normal: URL?chBPe=...&tpAmb=... sem sign", () => {
    const { chave } = montarChave({ ...base, tpEmis: 1 });
    const r = montarUrlQrCode({ urlBase: URL_SVRS, chBPe: chave, tpAmb: 2 });
    expect(r.url).toBe(`${URL_SVRS}?chBPe=${chave}&tpAmb=2`);
    expect(r.contingencia).toBe(false);
    expect(r.sign).toBeUndefined();
    expect(r.config).toEqual(QRCODE_CONFIG);
    expect(QRCODE_CONFIG.nivelCorrecao).toBe("M");
  });

  it("emissão normal com sign é rejeitada (F108/488)", () => {
    const { chave } = montarChave({ ...base, tpEmis: 1 });
    expect(() => montarUrlQrCode({ urlBase: URL_SVRS, chBPe: chave, tpAmb: 1, sign: "abc" })).toThrow(/488/);
  });

  it("contingência off-line: inclui sign RSA-SHA1 Base64 verificável", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
    const { chave } = montarChave({ ...base, tpEmis: 2 });
    const r = montarUrlQrCode({ urlBase: URL_SVRS + "?", chBPe: chave, tpAmb: 1, chavePrivadaPem: pem });
    expect(r.contingencia).toBe(true);
    expect(r.url.startsWith(`${URL_SVRS}?chBPe=${chave}&tpAmb=1&sign=`)).toBe(true);
    expect(r.sign).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(verificarAssinaturaQrCode(chave, r.sign!, pub)).toBe(true);
    expect(assinarChaveQrCode(chave, pem)).toBe(r.sign); // RSA PKCS#1 v1.5 é determinístico
  });

  it("contingência sem sign/chave é rejeitada (F107/482)", () => {
    const { chave } = montarChave({ ...base, tpEmis: 2 });
    expect(() => montarUrlQrCode({ urlBase: URL_SVRS, chBPe: chave, tpAmb: 1 })).toThrow(/482/);
  });

  it("rejeita chave inválida e tpAmb inválido", () => {
    expect(() => montarUrlQrCode({ urlBase: URL_SVRS, chBPe: "1".repeat(44), tpAmb: 1 })).toThrow(/inválida/);
    const { chave } = montarChave({ ...base, tpEmis: 1 });
    expect(() => montarUrlQrCode({ urlBase: URL_SVRS, chBPe: chave, tpAmb: 3 as 1 })).toThrow();
  });

  it("gera SVG do QR Code", async () => {
    const svg = await gerarSvgQrCode(`${URL_SVRS}?chBPe=1&tpAmb=2`);
    expect(svg).toContain("<svg");
  });
});
