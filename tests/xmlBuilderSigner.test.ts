import { describe, expect, it } from "vitest";
import { carregarPfx } from "../src/client/certificado.js";
import { montarEnvelope } from "../src/client/soapClient.js";
import {
  documento, el, escaparXml, gunzipBase64, gzipBase64, idEvento, minificarXml, NS_BPE,
  verificarRegrasXml, xmlConsSit, xmlConsStatServ, xmlEvento,
} from "../src/client/xmlBuilder.js";
import { assinarXml, verificarAssinatura } from "../src/client/xmlSigner.js";
import { montarChave } from "../src/services/chaveAcesso.js";
import { gerarCertificadoTeste } from "./helpers/cert.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { chave } = montarChave({ cUF: "43", aamm: "2511", cnpj: "11222333000181", serie: 1, nBP: 1, tpEmis: 1, cBP: "12345678" });

describe("xmlBuilder", () => {
  it("escapa < > & \" '", () => {
    expect(escaparXml(`DIAS & DIAS <"x"> 'y'`)).toBe("DIAS &amp; DIAS &lt;&quot;x&quot;&gt; &#39;y&#39;");
  });

  it("suprime tags opcionais vazias/zeradas e mantém obrigatórias", () => {
    const xml = documento(el("raiz", [el("a", ""), el("b", 0), el("c", "0.00"), el("d", "x"), el("e", 0, { obrigatorio: true }), el("g", [el("h", "")])], { attrs: { xmlns: NS_BPE } }));
    expect(xml).toBe(`<?xml version="1.0" encoding="UTF-8"?><raiz xmlns="${NS_BPE}"><d>x</d><e>0</e></raiz>`);
  });

  it("mensagens de status e consulta seguem o MOC", () => {
    expect(xmlConsStatServ(2)).toBe(`<?xml version="1.0" encoding="UTF-8"?><consStatServBPe versao="1.00" xmlns="${NS_BPE}"><tpAmb>2</tpAmb><xServ>STATUS</xServ></consStatServBPe>`);
    expect(xmlConsSit(1, chave)).toContain(`<xServ>CONSULTAR</xServ><chBPe>${chave}</chBPe>`);
  });

  it("evento: Id com 54 caracteres e detalhe por tipo", () => {
    const id = idEvento("110111", chave, 1);
    expect(id).toHaveLength(54);
    expect(id).toBe(`ID110111${chave}01`);
    const { xml } = xmlEvento({ tpEvento: "110116", cOrgao: "43", tpAmb: 2, cnpj: "11222333000181", chBPe: chave, nSeqEvento: 2, nProt: "343250000000001", poltrona: 12, dhEvento: "2025-11-23T10:00:00-03:00" });
    expect(xml).toContain(`<infEvento Id="ID110116${chave}02">`);
    expect(xml).toContain("<evAlteracaoPoltrona><descEvento>Alteração de Poltrona</descEvento><nProt>343250000000001</nProt><poltrona>12</poltrona></evAlteracaoPoltrona>");
    expect(() => xmlEvento({ tpEvento: "110111", cOrgao: "43", tpAmb: 2, cnpj: "1", chBPe: chave, nSeqEvento: 2, nProt: "343250000000001", xJust: "teste" })).toThrow(/636/);
  });

  it("verifica regras de forma (599, 404, 598, 402, 214)", () => {
    expect(verificarRegrasXml(xmlConsStatServ(2))).toEqual([]);
    const cods = (x: string) => verificarRegrasXml(x).map((v) => v.cStat);
    expect(cods(`<a xmlns="${NS_BPE}">\n  <b>1</b></a>`)).toContain(599);
    expect(cods(`<bpe:a xmlns:bpe="${NS_BPE}"/>`)).toContain(404);
    expect(cods(`<a xmlns="http://outro"/>`)).toContain(598);
    expect(cods(`<?xml version="1.0" encoding="ISO-8859-1"?><a/>`)).toContain(402);
    expect(cods(`<a>${"x".repeat(1024 * 1024)}</a>`)).toContain(214);
  });

  it("minifica e compacta GZip+Base64 de forma reversível", () => {
    const x = minificarXml("<a>\n  <b>1</b>\n  <!-- c --></a>");
    expect(x).toBe("<a><b>1</b></a>");
    expect(gunzipBase64(gzipBase64(x))).toBe(x);
  });

  it("envelope SOAP 1.2 sem Header: bpeRecepcao compactado, demais XML puro", () => {
    const rec = montarEnvelope("bpeRecepcao", "<BPe/>");
    expect(rec).not.toContain("Header");
    expect(rec).toMatch(/<bpeDadosMsg xmlns="http:\/\/www.portalfiscal.inf.br\/bpe\/wsdl\/BPeRecepcao">[A-Za-z0-9+/=]+<\/bpeDadosMsg>/);
    const st = montarEnvelope("bpeStatusServicoBP", xmlConsStatServ(2));
    expect(st).toContain(`<bpeDadosMsg xmlns="http://www.portalfiscal.inf.br/bpe/wsdl/BPeStatusServico"><consStatServBPe`);
    expect(st.match(/<\?xml/g)).toHaveLength(1);
  });
});

describe("xmlSigner — XMLDSig Enveloped RSA-SHA1/C14N", () => {
  const cert = gerarCertificadoTeste();
  const bpe = `<?xml version="1.0" encoding="UTF-8"?><BPe xmlns="${NS_BPE}"><infBPe Id="BPe${chave}" versao="1.00"><ide><cUF>43</cUF></ide></infBPe><infBPeSupl><qrCodBPe>x</qrCodBPe></infBPeSupl></BPe>`;

  it("assina infBPe com os algoritmos do MOC e a assinatura é válida", () => {
    const xml = assinarXml(bpe, { chavePrivadaPem: cert.chavePrivadaPem, certificado: cert.certificadoPem });
    expect(xml).toContain(`<Reference URI="#BPe${chave}">`);
    expect(xml).toContain('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">');
    expect(xml).toContain('Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"');
    expect(xml).toContain('Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"');
    expect(xml).toContain('Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"');
    expect(xml).toContain('Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"');
    expect(xml).toMatch(/<\/infBPeSupl><Signature/);
    expect(xml).toMatch(/<X509Data><X509Certificate>[A-Za-z0-9+/=]+<\/X509Certificate><\/X509Data>/);
    expect(xml).not.toMatch(/X509IssuerSerial|X509SubjectName|KeyValue/);
    expect(verificarRegrasXml(xml)).toEqual([]);
    expect(verificarAssinatura(xml, cert.certificadoPem).valida).toBe(true);
    expect(verificarAssinatura(xml.replace("<cUF>43</cUF>", "<cUF>35</cUF>"), cert.certificadoPem).valida).toBe(false);
  });

  it("assina infEvento", () => {
    const { xml } = xmlEvento({ tpEvento: "110111", cOrgao: "43", tpAmb: 2, cnpj: "11222333000181", chBPe: chave, nSeqEvento: 1, nProt: "343250000000001", xJust: "Cancelamento por desistencia do passageiro" });
    const assinado = assinarXml(xml, { chavePrivadaPem: cert.chavePrivadaPem, certificado: cert.certificadoPem });
    expect(assinado).toContain(`URI="#ID110111${chave}01"`);
    expect(verificarAssinatura(assinado, cert.certificadoPem).valida).toBe(true);
  });

  it("carrega PFX e extrai CNPJ", () => {
    const dir = mkdtempSync(join(tmpdir(), "bpe-"));
    const p = join(dir, "teste.pfx");
    writeFileSync(p, cert.pfx);
    const c = carregarPfx(p, "senha123");
    expect(c.cnpj).toBe("11222333000181");
    expect(c.chavePrivadaPem).toContain("PRIVATE KEY");
  });
});
