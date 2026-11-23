/**
 * Montagem de XML no padrão estrito do BP-e — MOC BP-e v1.00b, seções 3.2.1, 3.4 e 8.3.
 *
 *  - UTF-8, uma única declaração <?xml?>
 *  - namespace padrão único http://www.portalfiscal.inf.br/bpe no elemento raiz, sem prefixos
 *  - sem espaços/quebras de linha entre tags, sem comentários
 *  - supressão de tags opcionais vazias (caractere) ou zeradas (numérico)
 *  - escape de < > & " '
 *  - limite de 1024 KB
 *  - GZip + Base64 apenas para bpeRecepcao
 */
import { gunzipSync, gzipSync } from "node:zlib";
import { formatarDataHora } from "../config/index.js";

export const NS_BPE = "http://www.portalfiscal.inf.br/bpe";
export const NS_DSIG = "http://www.w3.org/2000/09/xmldsig#";
export const VERSAO_LEIAUTE = "1.00";
export const LIMITE_BYTES = 1024 * 1024;
export const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';

export function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type ValorXml = string | number | boolean | null | undefined;

export interface NoXml {
  tag: string;
  attrs?: Record<string, ValorXml>;
  /** Valor textual (folha). */
  valor?: ValorXml;
  filhos?: (NoXml | null | undefined | false)[];
  /** Tag obrigatória no leiaute (ocorrência 1-x): é emitida mesmo vazia/zerada. */
  obrigatorio?: boolean;
}

/** Atalho para criar nós. */
export function el(tag: string, conteudo?: ValorXml | (NoXml | null | undefined | false)[], opts: { attrs?: Record<string, ValorXml>; obrigatorio?: boolean } = {}): NoXml {
  return Array.isArray(conteudo)
    ? { tag, filhos: conteudo, attrs: opts.attrs, obrigatorio: opts.obrigatorio }
    : { tag, valor: conteudo, attrs: opts.attrs, obrigatorio: opts.obrigatorio };
}

function valorVazioOuZerado(v: ValorXml): boolean {
  if (v === null || v === undefined || v === false) return true;
  if (typeof v === "number") return v === 0;
  const s = String(v).trim();
  if (s === "") return true;
  // numérico zerado: "0", "0.00", "000"
  return /^0+(\.0+)?$/.test(s);
}

function attrsStr(attrs?: Record<string, ValorXml>): string {
  if (!attrs) return "";
  return Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => ` ${k}="${escaparXml(String(v))}"`)
    .join("");
}

/** Serializa um nó aplicando as regras de supressão. Retorna "" para nós suprimidos. */
export function serializar(no: NoXml): string {
  if (no.filhos) {
    const interno = no.filhos.filter((f): f is NoXml => !!f).map(serializar).join("");
    if (!interno && !no.obrigatorio) return "";
    return `<${no.tag}${attrsStr(no.attrs)}>${interno}</${no.tag}>`;
  }
  if (valorVazioOuZerado(no.valor) && !no.obrigatorio) return "";
  const texto = no.valor === null || no.valor === undefined || no.valor === false ? "" : String(no.valor).trim();
  return `<${no.tag}${attrsStr(no.attrs)}>${escaparXml(texto)}</${no.tag}>`;
}

export function documento(raiz: NoXml, comDeclaracao = true): string {
  const xml = serializar({ ...raiz, obrigatorio: true });
  return comDeclaracao ? XML_DECL + xml : xml;
}

/** Remove espaços/quebras entre tags e comentários (sem alterar o conteúdo dos campos). */
export function minificarXml(xml: string): string {
  return xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .trim();
}

export function removerDeclaracao(xml: string): string {
  return xml.replace(/^\s*<\?xml[^?]*\?>\s*/i, "");
}

export function tamanhoBytes(xml: string): number {
  return Buffer.byteLength(xml, "utf8");
}

/** Compacta em GZip e codifica em Base64 (exclusivo do serviço bpeRecepcao). */
export function gzipBase64(xml: string): string {
  return gzipSync(Buffer.from(xml, "utf8")).toString("base64");
}

export function gunzipBase64(b64: string): string {
  return gunzipSync(Buffer.from(b64, "base64")).toString("utf8");
}

export interface ViolacaoXml {
  regra: string;
  cStat: number;
  mensagem: string;
}

/** Verificações locais de forma (grupos B e C do MOC) antes do envio. */
export function verificarRegrasXml(xml: string): ViolacaoXml[] {
  const v: ViolacaoXml[] = [];
  if (tamanhoBytes(xml) > LIMITE_BYTES) v.push({ regra: "B01", cStat: 214, mensagem: `XML com ${tamanhoBytes(xml)} bytes excede 1024 KB.` });
  const decls = xml.match(/<\?xml[^?]*\?>/g) ?? [];
  if (decls.length > 1) v.push({ regra: "B02", cStat: 243, mensagem: "Mais de uma declaração <?xml?>." });
  if (decls[0] && !/encoding=["']UTF-8["']/i.test(decls[0])) v.push({ regra: "C05", cStat: 402, mensagem: "Declaração XML com codificação diferente de UTF-8." });
  if (/^\s+|\s+$/.test(xml) || />\s+</.test(xml)) v.push({ regra: "C03", cStat: 599, mensagem: "Caracteres de edição (espaço, tab, CR/LF) no início/fim ou entre as tags." });
  if (/<\/?[A-Za-z_][\w.-]*:[A-Za-z_]/.test(removerDeclaracao(xml))) v.push({ regra: "C04", cStat: 404, mensagem: "Uso de prefixo de namespace não permitido." });
  const nss = [...xml.matchAll(/xmlns(?::\w+)?=["']([^"']*)["']/g)].map((m) => m[1]);
  const invalidos = nss.filter((n) => n !== NS_BPE && n !== NS_DSIG);
  if (invalidos.length) v.push({ regra: "C02", cStat: 598, mensagem: `Namespace diverso do padrão: ${[...new Set(invalidos)].join(", ")}` });
  if (/<!--/.test(xml)) v.push({ regra: "C03", cStat: 599, mensagem: "Comentários não são permitidos no XML." });
  return v;
}

// ------------------------------------------------------------------ Mensagens dos Web Services

export function xmlConsStatServ(tpAmb: 1 | 2): string {
  return documento(el("consStatServBPe", [el("tpAmb", tpAmb, { obrigatorio: true }), el("xServ", "STATUS", { obrigatorio: true })], { attrs: { versao: VERSAO_LEIAUTE, xmlns: NS_BPE } }));
}

export function xmlConsSit(tpAmb: 1 | 2, chBPe: string): string {
  return documento(
    el("consSitBPe", [el("tpAmb", tpAmb, { obrigatorio: true }), el("xServ", "CONSULTAR", { obrigatorio: true }), el("chBPe", chBPe, { obrigatorio: true })], {
      attrs: { versao: VERSAO_LEIAUTE, xmlns: NS_BPE },
    }),
  );
}

export type TipoEvento = "110111" | "110115" | "110116";

export interface DadosEvento {
  tpEvento: TipoEvento;
  cOrgao: string;
  tpAmb: 1 | 2;
  cnpj: string;
  chBPe: string;
  nSeqEvento: number;
  nProt: string;
  dhEvento?: Date | string;
  tzOffset?: string;
  /** Cancelamento / Não Embarque */
  xJust?: string;
  /** Alteração de Poltrona */
  poltrona?: number | string;
}

/** Id do evento: "ID" + tpEvento + chBPe + nSeqEvento (2 dígitos) = 54 caracteres. */
export function idEvento(tpEvento: string, chBPe: string, nSeqEvento: number): string {
  return `ID${tpEvento}${chBPe}${String(nSeqEvento).padStart(2, "0")}`;
}

export function detalheEvento(d: DadosEvento): NoXml {
  switch (d.tpEvento) {
    case "110111":
      return el("evCancBPe", [el("descEvento", "Cancelamento", { obrigatorio: true }), el("nProt", d.nProt, { obrigatorio: true }), el("xJust", d.xJust, { obrigatorio: true })]);
    case "110115":
      return el("evNaoEmbBPe", [el("descEvento", "Não Embarque", { obrigatorio: true }), el("nProt", d.nProt, { obrigatorio: true }), el("xJust", d.xJust, { obrigatorio: true })]);
    case "110116":
      return el("evAlteracaoPoltrona", [el("descEvento", "Alteração de Poltrona", { obrigatorio: true }), el("nProt", d.nProt, { obrigatorio: true }), el("poltrona", d.poltrona, { obrigatorio: true })]);
  }
}

/** Monta o XML (não assinado) do pedido de registro de evento. */
export function xmlEvento(d: DadosEvento): { xml: string; id: string } {
  if (d.tpEvento !== "110116" && (!d.xJust || d.xJust.trim().length < 1 || d.xJust.length > 255)) {
    throw new Error("xJust é obrigatória (1 a 255 caracteres) para cancelamento e não embarque.");
  }
  if (d.tpEvento === "110116" && (d.poltrona === undefined || !/^\d{1,3}$/.test(String(d.poltrona)))) {
    throw new Error("poltrona é obrigatória (até 3 dígitos) para alteração de poltrona.");
  }
  const max = d.tpEvento === "110116" ? 99 : 1;
  if (d.nSeqEvento < 1 || d.nSeqEvento > max) throw new Error(`nSeqEvento deve estar entre 1 e ${max} para o evento ${d.tpEvento} (regra J02 / cStat 636).`);
  if (!/^\d{15}$/.test(d.nProt)) throw new Error("nProt deve ter 15 dígitos.");
  const id = idEvento(d.tpEvento, d.chBPe, d.nSeqEvento);
  const dh = typeof d.dhEvento === "string" ? d.dhEvento : formatarDataHora(d.dhEvento ?? new Date(), d.tzOffset ?? "-03:00");
  const xml = documento(
    el(
      "eventoBPe",
      [
        el(
          "infEvento",
          [
            el("cOrgao", d.cOrgao, { obrigatorio: true }),
            el("tpAmb", d.tpAmb, { obrigatorio: true }),
            el("CNPJ", d.cnpj, { obrigatorio: true }),
            el("chBPe", d.chBPe, { obrigatorio: true }),
            el("dhEvento", dh, { obrigatorio: true }),
            el("tpEvento", d.tpEvento, { obrigatorio: true }),
            el("nSeqEvento", d.nSeqEvento, { obrigatorio: true }),
            el("detEvento", [detalheEvento(d)], { attrs: { versaoEvento: VERSAO_LEIAUTE }, obrigatorio: true }),
          ],
          { attrs: { Id: id }, obrigatorio: true },
        ),
      ],
      { attrs: { versao: VERSAO_LEIAUTE, xmlns: NS_BPE } },
    ),
  );
  return { xml, id };
}

/** Consulta cadastro (Web Service da NF-e: CadConsultaCadastro4, leiaute ConsCad 2.00). */
export function xmlConsCad(uf: string, filtro: { CNPJ?: string; CPF?: string; IE?: string }): string {
  const nsNfe = "http://www.portalfiscal.inf.br/nfe";
  const qtd = [filtro.CNPJ, filtro.CPF, filtro.IE].filter(Boolean).length;
  if (qtd !== 1) throw new Error("Informe exatamente um entre CNPJ, CPF ou IE.");
  return documento(
    el(
      "ConsCad",
      [el("infCons", [el("xServ", "CONS-CAD", { obrigatorio: true }), el("UF", uf.toUpperCase(), { obrigatorio: true }), el("IE", filtro.IE), el("CNPJ", filtro.CNPJ), el("CPF", filtro.CPF)], { obrigatorio: true })],
      { attrs: { versao: "2.00", xmlns: nsNfe } },
    ),
  );
}
