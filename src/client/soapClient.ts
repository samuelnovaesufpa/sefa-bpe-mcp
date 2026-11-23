/**
 * Cliente SOAP 1.2 (Document/Literal) sobre TLS 1.2 com autenticação mútua — MOC BP-e v1.00b, seções 3.2.2 e 3.4.
 *  - sem <soap12:Header>
 *  - requisição em <bpeDadosMsg xmlns="{ns do WSDL}"> e retorno em <bpeResultMsg>
 *  - bpeRecepcao: conteúdo GZip+Base64; demais serviços: XML puro
 */
import { readFileSync } from "node:fs";
import https from "node:https";
import { XMLParser } from "fast-xml-parser";
import { gzipBase64, removerDeclaracao } from "./xmlBuilder.js";

export type MetodoWs = "bpeRecepcao" | "bpeConsultaBP" | "bpeStatusServicoBP" | "bpeRecepcaoEvento" | "consultaCadastro";

export const WSDL_NS: Record<MetodoWs, string> = {
  bpeRecepcao: "http://www.portalfiscal.inf.br/bpe/wsdl/BPeRecepcao",
  bpeConsultaBP: "http://www.portalfiscal.inf.br/bpe/wsdl/BPeConsulta",
  bpeStatusServicoBP: "http://www.portalfiscal.inf.br/bpe/wsdl/BPeStatusServico",
  bpeRecepcaoEvento: "http://www.portalfiscal.inf.br/bpe/wsdl/BPeRecepcaoEvento",
  consultaCadastro: "http://www.portalfiscal.inf.br/nfe/wsdl/CadConsultaCadastro4",
};

const ELEMENTO_DADOS: Record<MetodoWs, string> = {
  bpeRecepcao: "bpeDadosMsg",
  bpeConsultaBP: "bpeDadosMsg",
  bpeStatusServicoBP: "bpeDadosMsg",
  bpeRecepcaoEvento: "bpeDadosMsg",
  consultaCadastro: "nfeDadosMsg",
};

export interface OpcoesTls {
  pfx: Buffer;
  senha: string;
  ca?: Buffer;
  timeoutMs: number;
}

/** Monta o envelope SOAP 1.2 (sem Header). */
export function montarEnvelope(metodo: MetodoWs, xmlDados: string): string {
  const ns = WSDL_NS[metodo];
  const el = ELEMENTO_DADOS[metodo];
  const corpo = metodo === "bpeRecepcao" ? gzipBase64(xmlDados) : removerDeclaracao(xmlDados);
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    `<soap12:Body><${el} xmlns="${ns}">${corpo}</${el}></soap12:Body>` +
    "</soap12:Envelope>"
  );
}

export function soapAction(metodo: MetodoWs): string {
  return `${WSDL_NS[metodo]}/${metodo}`;
}

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: true });

/** Extrai o XML de retorno de dentro de <bpeResultMsg>/<nfeResultMsg>. */
export function extrairResultado(envelope: string): string {
  const m = /<(?:\w+:)?(bpeResultMsg|nfeResultMsg)[^>]*>([\s\S]*?)<\/(?:\w+:)?\1>/.exec(envelope);
  if (!m) {
    const fault = /<(?:\w+:)?Text[^>]*>([\s\S]*?)<\/(?:\w+:)?Text>/.exec(envelope)?.[1] ?? /<faultstring>([\s\S]*?)<\/faultstring>/.exec(envelope)?.[1];
    throw new Error(fault ? `SOAP Fault: ${fault}` : "Resposta SOAP sem bpeResultMsg.");
  }
  return m[2]!.trim();
}

export function parseXml<T = any>(xml: string): T {
  return parser.parse(xml) as T;
}

export interface RespostaSoap {
  httpStatus: number;
  envelope: string;
  xmlRetorno: string;
  retorno: any;
}

export function opcoesTlsDeArquivos(pfxPath: string, senha: string, caPath: string | undefined, timeoutMs: number): OpcoesTls {
  return { pfx: readFileSync(pfxPath), senha, ca: caPath ? readFileSync(caPath) : undefined, timeoutMs };
}

/** Envia a requisição SOAP com mTLS (TLS 1.2+) e devolve o XML de retorno já extraído e parseado. */
export function enviarSoap(url: string, metodo: MetodoWs, xmlDados: string, tls: OpcoesTls): Promise<RespostaSoap> {
  const envelope = montarEnvelope(metodo, xmlDados);
  const u = new URL(url);
  if (u.protocol !== "https:") return Promise.reject(new Error("A comunicação com a SEFAZ exige HTTPS (TLS 1.2 com autenticação mútua)."));

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "POST",
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        pfx: tls.pfx,
        passphrase: tls.senha,
        ca: tls.ca,
        minVersion: "TLSv1.2",
        headers: {
          "Content-Type": `application/soap+xml; charset=utf-8; action="${soapAction(metodo)}"`,
          "Content-Length": Buffer.byteLength(envelope, "utf8"),
        },
        timeout: tls.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const corpo = Buffer.concat(chunks).toString("utf8");
          try {
            const xmlRetorno = extrairResultado(corpo);
            resolve({ httpStatus: res.statusCode ?? 0, envelope: corpo, xmlRetorno, retorno: parseXml(xmlRetorno) });
          } catch (e) {
            reject(new Error(`HTTP ${res.statusCode}: ${(e as Error).message}`));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`Timeout de ${tls.timeoutMs}ms na comunicação com ${u.hostname}.`)));
    req.on("error", reject);
    req.write(envelope);
    req.end();
  });
}
