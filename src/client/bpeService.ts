/**
 * Orquestração das chamadas aos Web Services do BP-e com suporte a modo mock/dry-run.
 * Em modo mock nenhuma requisição é enviada: devolve o XML/envelope que SERIA enviado e um retorno simulado.
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { type Config, formatarDataHora, modoEfetivo } from "../config/index.js";
import { lerJson } from "../resources/dataStore.js";
import { validarChave, decomporChave } from "../services/chaveAcesso.js";
import { codigoDaUf, ufDoCodigo } from "../services/ufs.js";
import { carregarPfx, type CertificadoCarregado } from "./certificado.js";
import { RateLimiter, type ServicoBPe } from "./rateLimiter.js";
import { enviarSoap, montarEnvelope, opcoesTlsDeArquivos, parseXml, type MetodoWs } from "./soapClient.js";
import { assinarXml } from "./xmlSigner.js";
import {
  type DadosEvento,
  type TipoEvento,
  minificarXml,
  verificarRegrasXml,
  xmlConsCad,
  xmlConsSit,
  xmlConsStatServ,
  xmlEvento,
  XML_DECL,
} from "./xmlBuilder.js";

export interface ResultadoWs {
  modo: "mock" | "real";
  servico: MetodoWs;
  url?: string;
  cStat?: number;
  xMotivo?: string;
  sucesso?: boolean;
  xmlEnviado: string;
  envelopeSoap?: string;
  xmlRetorno?: string;
  retorno?: unknown;
  avisos?: string[];
}

const SUCESSO: Record<MetodoWs, number[]> = {
  bpeRecepcao: [100, 150],
  bpeConsultaBP: [100, 101, 102, 150],
  bpeStatusServicoBP: [107],
  bpeRecepcaoEvento: [134, 135, 136],
  consultaCadastro: [111, 112],
};

export class BpeService {
  readonly limiter: RateLimiter;
  private cert?: CertificadoCarregado;

  constructor(readonly cfg: Config, limiter?: RateLimiter) {
    this.limiter = limiter ?? new RateLimiter();
  }

  get modo(): "mock" | "real" {
    return modoEfetivo(this.cfg);
  }

  certificado(): CertificadoCarregado | undefined {
    if (!this.cfg.certPfxPath) return undefined;
    if (!this.cert) this.cert = carregarPfx(resolve(this.cfg.certPfxPath), this.cfg.certPfxSenha ?? "");
    return this.cert;
  }

  /** Resolve a URL do serviço: .env > data/endpoints_uf.json (autorizador da UF). */
  url(servico: MetodoWs, uf = this.cfg.uf, tpAmb = this.cfg.tpAmb): string | undefined {
    const override = this.cfg.urls[servico];
    if (override) return override;
    if (servico === "consultaCadastro") return undefined;
    const ep = lerJson<any>("endpoints_uf.json");
    const info = ep.ufs.find((u: any) => u.UF === uf.toUpperCase());
    const amb = tpAmb === 1 ? "producao" : "homologacao";
    if (info?.[amb]?.[servico]) return info[amb][servico];
    const aut = info?.autorizador && ep.autorizadores[info.autorizador];
    return aut?.[amb]?.[servico];
  }

  urlQrCode(uf = this.cfg.uf, tpAmb = this.cfg.tpAmb): string | undefined {
    if (this.cfg.urls.qrCode) return this.cfg.urls.qrCode;
    const ep = lerJson<any>("endpoints_uf.json");
    const info = ep.ufs.find((u: any) => u.UF === uf.toUpperCase());
    const amb = tpAmb === 1 ? "producao" : "homologacao";
    return info?.[amb]?.qrCode ?? (info?.autorizador && ep.autorizadores[info.autorizador]?.[amb]?.qrCode);
  }

  private async executar(servico: MetodoWs, xml: string, opts: { documento?: string; mock: () => string; url?: string; uf?: string }): Promise<ResultadoWs> {
    const avisos: string[] = [];
    const violacoes = verificarRegrasXml(xml);
    if (violacoes.length) {
      return { modo: this.modo, servico, sucesso: false, xmlEnviado: xml, avisos: violacoes.map((v) => `${v.regra} (cStat ${v.cStat}): ${v.mensagem}`), cStat: violacoes[0]!.cStat, xMotivo: "Bloqueado localmente: XML fora do padrão do MOC" };
    }
    const assinatura = createHash("sha1").update(xml).digest("hex");
    const lim = servico as ServicoBPe;
    this.limiter.exigir(lim, { documento: opts.documento, assinatura });

    const url = opts.url ?? this.url(servico, opts.uf);
    const envelopeSoap = montarEnvelope(servico, xml);

    if (this.modo === "mock") {
      this.limiter.registrarEnvio(lim, { documento: opts.documento, assinatura });
      const xmlRetorno = opts.mock();
      const retorno = parseXml(xmlRetorno);
      const { cStat, xMotivo } = extrairStatus(retorno);
      if (!url) avisos.push("URL do serviço não configurada (veja data/endpoints_uf.json ou .env).");
      avisos.push("MODO MOCK/DRY-RUN: nenhuma requisição foi enviada à SEFAZ. Configure BPE_CERT_PFX_PATH no .env para modo real.");
      return { modo: "mock", servico, url, cStat, xMotivo, sucesso: cStat !== undefined && SUCESSO[servico].includes(cStat), xmlEnviado: xml, envelopeSoap, xmlRetorno, retorno, avisos };
    }

    if (!url) throw new Error(`URL do serviço ${servico} não configurada para a UF ${opts.uf ?? this.cfg.uf}. Defina no .env ou em data/endpoints_uf.json.`);
    if (!this.cfg.certPfxPath) throw new Error("Modo real exige BPE_CERT_PFX_PATH.");
    const tls = opcoesTlsDeArquivos(resolve(this.cfg.certPfxPath), this.cfg.certPfxSenha ?? "", this.cfg.caPath, this.cfg.timeoutMs);
    this.limiter.registrarEnvio(lim, { documento: opts.documento, assinatura });
    const resp = await enviarSoap(url, servico, xml, tls);
    const { cStat, xMotivo } = extrairStatus(resp.retorno);
    const sucesso = cStat !== undefined && SUCESSO[servico].includes(cStat);
    if (cStat === 678) this.limiter.registrarRejeicao678(lim);
    else if (opts.documento && cStat !== undefined) this.limiter.registrarResultado(lim, opts.documento, cStat, sucesso);
    return { modo: "real", servico, url, cStat, xMotivo, sucesso, xmlEnviado: xml, xmlRetorno: resp.xmlRetorno, retorno: resp.retorno, avisos };
  }

  private agora(): string {
    return formatarDataHora(new Date(), this.cfg.tzOffset);
  }

  // ------------------------------------------------------------------ serviços

  async consultarStatus(uf?: string): Promise<ResultadoWs> {
    const tpAmb = this.cfg.tpAmb;
    const cUF = codigoDaUf(uf ?? this.cfg.uf) ?? this.cfg.cUF;
    const xml = xmlConsStatServ(tpAmb);
    return this.executar("bpeStatusServicoBP", xml, {
      uf,
      mock: () => `<retConsStatServBPe versao="1.00" xmlns="http://www.portalfiscal.inf.br/bpe"><tpAmb>${tpAmb}</tpAmb><verAplic>MOCK-1.0</verAplic><cStat>107</cStat><xMotivo>Servico em Operacao</xMotivo><cUF>${cUF}</cUF><dhRecbto>${this.agora()}</dhRecbto><tMed>1</tMed></retConsStatServBPe>`,
    });
  }

  async consultarSituacao(chBPe: string): Promise<ResultadoWs> {
    const v = validarChave(chBPe);
    if (!v.valida) {
      return { modo: this.modo, servico: "bpeConsultaBP", sucesso: false, cStat: 236, xMotivo: `Rejeição: Chave de Acesso inválida [Motivo: ${v.motivos.join("; ")}] (verificação local, nada enviado)`, xmlEnviado: "" };
    }
    const tpAmb = this.cfg.tpAmb;
    const uf = ufDoCodigo(decomporChave(chBPe).cUF);
    const xml = xmlConsSit(tpAmb, v.chave);
    return this.executar("bpeConsultaBP", xml, {
      documento: v.chave,
      uf,
      mock: () => `<retConsSitBPe versao="1.00" xmlns="http://www.portalfiscal.inf.br/bpe"><tpAmb>${tpAmb}</tpAmb><verAplic>MOCK-1.0</verAplic><cStat>100</cStat><xMotivo>Autorizado o uso do BP-e (simulado)</xMotivo><cUF>${v.componentes!.cUF}</cUF><protBPe versao="1.00"><infProt><tpAmb>${tpAmb}</tpAmb><verAplic>MOCK-1.0</verAplic><chBPe>${v.chave}</chBPe><dhRecbto>${this.agora()}</dhRecbto><nProt>3${v.componentes!.cUF}${String(new Date().getFullYear()).slice(2)}0000000001</nProt><cStat>100</cStat><xMotivo>Autorizado o uso do BP-e (simulado)</xMotivo></infProt></protBPe></retConsSitBPe>`,
    });
  }

  /** Autoriza um BP-e. Aceita XML assinado ou não (assina se houver certificado). */
  async autorizar(xmlBPe: string, opts: { assinar?: boolean } = {}): Promise<ResultadoWs> {
    let xml = minificarXml(xmlBPe);
    if (!xml.startsWith("<?xml")) xml = XML_DECL + xml;
    const id = /<infBPe[^>]*\sId="BPe(\d{44})"/.exec(xml)?.[1];
    if (!id) throw new Error("XML do BP-e sem <infBPe Id=\"BPe{chave}\"> válido.");
    const avisos: string[] = [];
    const jaAssinado = /<Signature[\s>]/.test(xml);
    if (!jaAssinado && opts.assinar !== false) {
      const cert = this.modo === "real" || this.cfg.certPfxPath ? this.certificadoSeguro() : undefined;
      if (cert) xml = assinarXml(xml, { chavePrivadaPem: cert.chavePrivadaPem, certificado: cert.certificadoPem });
      else avisos.push("XML não assinado: sem certificado configurado. Em modo real a SEFAZ rejeitaria (215/298).");
    }
    const tpAmb = Number(/<tpAmb>(\d)<\/tpAmb>/.exec(xml)?.[1] ?? this.cfg.tpAmb);
    const res = await this.executar("bpeRecepcao", xml, {
      documento: id,
      uf: ufDoCodigo(id.slice(0, 2)),
      mock: () => `<retBPe versao="1.00" xmlns="http://www.portalfiscal.inf.br/bpe"><tpAmb>${tpAmb}</tpAmb><cUF>${id.slice(0, 2)}</cUF><verAplic>MOCK-1.0</verAplic><cStat>100</cStat><xMotivo>Autorizado o uso do BP-e (simulado)</xMotivo><protBPe versao="1.00"><infProt><tpAmb>${tpAmb}</tpAmb><verAplic>MOCK-1.0</verAplic><chBPe>${id}</chBPe><dhRecbto>${this.agora()}</dhRecbto><nProt>3${id.slice(0, 2)}${String(new Date().getFullYear()).slice(2)}0000000001</nProt><digVal>MOCK</digVal><cStat>100</cStat><xMotivo>Autorizado o uso do BP-e (simulado)</xMotivo></infProt></protBPe></retBPe>`,
    });
    res.avisos = [...avisos, ...(res.avisos ?? [])];
    return res;
  }

  private certificadoSeguro(): CertificadoCarregado | undefined {
    try {
      return this.certificado();
    } catch (e) {
      if (this.modo === "real") throw e;
      return undefined;
    }
  }

  async registrarEvento(d: Omit<DadosEvento, "cOrgao" | "tpAmb" | "cnpj"> & { cnpj?: string; cOrgao?: string }): Promise<ResultadoWs> {
    const v = validarChave(d.chBPe);
    if (!v.valida) throw new Error(`Chave de acesso inválida: ${v.motivos.join("; ")}`);
    const cnpj = d.cnpj ?? this.cfg.cnpjEmitente ?? v.componentes!.cnpj;
    const cOrgao = d.cOrgao ?? v.componentes!.cUF;
    const tpAmb = this.cfg.tpAmb;
    const { xml: xmlNaoAssinado, id } = xmlEvento({ ...d, cnpj, cOrgao, tpAmb, tzOffset: this.cfg.tzOffset });
    const avisos: string[] = [];
    let xml = xmlNaoAssinado;
    const cert = this.certificadoSeguro();
    if (cert) xml = assinarXml(xml, { chavePrivadaPem: cert.chavePrivadaPem, certificado: cert.certificadoPem, tag: "infEvento" });
    else avisos.push("Evento não assinado: sem certificado configurado.");
    const desc: Record<TipoEvento, string> = { "110111": "Cancelamento", "110115": "Nao Embarque", "110116": "Alteracao de Poltrona" };
    const res = await this.executar("bpeRecepcaoEvento", xml, {
      documento: id,
      uf: ufDoCodigo(v.componentes!.cUF),
      mock: () => `<retEventoBPe versao="1.00" xmlns="http://www.portalfiscal.inf.br/bpe"><infEvento><tpAmb>${tpAmb}</tpAmb><verAplic>MOCK-1.0</verAplic><cOrgao>${cOrgao}</cOrgao><cStat>135</cStat><xMotivo>Evento registrado e vinculado a BP-e (simulado)</xMotivo><chBPe>${v.chave}</chBPe><tpEvento>${d.tpEvento}</tpEvento><xEvento>${desc[d.tpEvento]}</xEvento><nSeqEvento>${d.nSeqEvento}</nSeqEvento><dhRegEvento>${this.agora()}</dhRegEvento><nProt>3${cOrgao}${String(new Date().getFullYear()).slice(2)}0000000002</nProt></infEvento></retEventoBPe>`,
    });
    res.avisos = [...avisos, ...(res.avisos ?? [])];
    return res;
  }

  async consultarCadastro(uf: string, filtro: { CNPJ?: string; CPF?: string; IE?: string }, url?: string): Promise<ResultadoWs> {
    const xml = xmlConsCad(uf, filtro);
    const doc = filtro.CNPJ ?? filtro.CPF ?? filtro.IE ?? "";
    const res = await this.executar("consultaCadastro", xml, {
      documento: doc,
      url: url ?? this.url("consultaCadastro"),
      mock: () => `<retConsCad versao="2.00" xmlns="http://www.portalfiscal.inf.br/nfe"><infCons><verAplic>MOCK-1.0</verAplic><cStat>111</cStat><xMotivo>Consulta cadastro com uma ocorrencia (simulado)</xMotivo><UF>${uf.toUpperCase()}</UF>${filtro.CNPJ ? `<CNPJ>${filtro.CNPJ}</CNPJ>` : ""}<dhCons>${this.agora()}</dhCons><cUF>${codigoDaUf(uf) ?? ""}</cUF><infCad><IE>${filtro.IE ?? "0000000000"}</IE>${filtro.CNPJ ? `<CNPJ>${filtro.CNPJ}</CNPJ>` : ""}<UF>${uf.toUpperCase()}</UF><cSit>1</cSit><xNome>CONTRIBUINTE SIMULADO</xNome></infCad></infCons></retConsCad>`,
    });
    if (!res.url) res.avisos = [...(res.avisos ?? []), "A consulta cadastro usa o Web Service da NF-e (CadConsultaCadastro4) de cada UF: informe a URL no parâmetro 'url' ou em BPE_URL_CONSULTA_CADASTRO."];
    return res;
  }
}

/** Extrai cStat/xMotivo do retorno parseado (procura no 1º e 2º nível, incluindo protBPe/infProt). */
export function extrairStatus(retorno: any): { cStat?: number; xMotivo?: string } {
  const raiz = retorno && typeof retorno === "object" ? (Object.values(retorno).find((v) => v && typeof v === "object") as any) : undefined;
  if (!raiz) return {};
  const alvo = raiz.cStat !== undefined ? raiz : raiz.infEvento ?? raiz.infCons ?? raiz;
  const prot = raiz.protBPe?.infProt;
  // em bpeRecepcao o status do BP-e fica no protocolo quando presente
  const fonte = prot?.cStat !== undefined && raiz.cStat !== undefined && String(raiz.cStat) !== String(prot.cStat) ? prot : alvo;
  return { cStat: fonte?.cStat !== undefined ? Number(fonte.cStat) : undefined, xMotivo: fonte?.xMotivo };
}
