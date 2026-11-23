/**
 * QR Code do DABPE — MOC BP-e v1.00b, seção 10.
 * Padrão ISO/IEC 18004, nível de correção M, caracteres UTF-8.
 *
 * Normal:               <URL>?chBPe=<44>&tpAmb=<1|2>
 * Contingência Off-line: <URL>?chBPe=<44>&tpAmb=<1|2>&sign=<RSA-SHA1(chBPe) em Base64>
 */
import { createSign, createVerify } from "node:crypto";
import QRCode from "qrcode";
import { decomporChave, validarChave } from "./chaveAcesso.js";

export const QRCODE_CONFIG = {
  padrao: "ISO/IEC 18004",
  nivelCorrecao: "M",
  caracteres: "UTF-8",
} as const;

export interface ParamsQrCode {
  /** URL de consulta via QR Code da UF/ambiente (ex.: https://dfe-portal.svrs.rs.gov.br/bpe/qrCode). */
  urlBase: string;
  chBPe: string;
  tpAmb: 1 | 2;
  /** Chave privada PEM do certificado que assina o BP-e (obrigatória em contingência off-line, se sign não for informado). */
  chavePrivadaPem?: string;
  /** Assinatura já calculada (Base64), alternativa a chavePrivadaPem. */
  sign?: string;
}

export interface ResultadoQrCode {
  url: string;
  tpEmis: "1" | "2";
  contingencia: boolean;
  sign?: string;
  config: typeof QRCODE_CONFIG;
}

/** Assina o valor do parâmetro chBPe (44 caracteres) com RSA-SHA1 e retorna em Base64. */
export function assinarChaveQrCode(chBPe: string, chavePrivadaPem: string): string {
  const signer = createSign("RSA-SHA1");
  signer.update(chBPe, "utf8");
  signer.end();
  return signer.sign(chavePrivadaPem, "base64");
}

export function verificarAssinaturaQrCode(chBPe: string, sign: string, certOuChavePublicaPem: string): boolean {
  const v = createVerify("RSA-SHA1");
  v.update(chBPe, "utf8");
  v.end();
  return v.verify(certOuChavePublicaPem, sign, "base64");
}

export function montarUrlQrCode(p: ParamsQrCode): ResultadoQrCode {
  const val = validarChave(p.chBPe);
  if (!val.valida) throw new Error(`Chave de acesso inválida: ${val.motivos.join("; ")}`);
  if (p.tpAmb !== 1 && p.tpAmb !== 2) throw new Error("tpAmb deve ser 1 (Produção) ou 2 (Homologação).");
  if (!/^https?:\/\//i.test(p.urlBase)) throw new Error("urlBase deve ser uma URL http(s).");

  const tpEmis = decomporChave(p.chBPe).tpEmis as "1" | "2";
  const base = p.urlBase.replace(/\?+$/, "");
  let url = `${base}?chBPe=${val.chave}&tpAmb=${p.tpAmb}`;
  let sign: string | undefined;

  if (tpEmis === "2") {
    sign = p.sign ?? (p.chavePrivadaPem ? assinarChaveQrCode(val.chave, p.chavePrivadaPem) : undefined);
    if (!sign) {
      throw new Error("Contingência off-line (tpEmis=2): é obrigatório o parâmetro sign (regra F107 / cStat 482). Informe a chave privada do certificado ou o sign já calculado.");
    }
    // O MOC (10.2.2) concatena o Base64 diretamente, sem URL-encoding.
    url += `&sign=${sign}`;
  } else if (p.sign) {
    throw new Error("Emissão normal (tpEmis=1): o parâmetro sign não deve ser informado (regra F108 / cStat 488).");
  }

  return { url, tpEmis, contingencia: tpEmis === "2", sign, config: QRCODE_CONFIG };
}

/** Gera a imagem do QR Code (SVG) com nível de correção M e UTF-8. */
export async function gerarSvgQrCode(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
}

/** Gera a imagem do QR Code em PNG (data URL Base64). */
export async function gerarPngQrCode(url: string): Promise<string> {
  return QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1 });
}
