/**
 * Assinatura XMLDSig Enveloped — MOC BP-e v1.00b, seção 3.2.4.
 *  - CanonicalizationMethod: http://www.w3.org/TR/2001/REC-xml-c14n-20010315
 *  - SignatureMethod: rsa-sha1 | DigestMethod: sha1
 *  - Transforms: enveloped-signature + C14N
 *  - Reference URI="#<Id>" (infBPe Id="BPe{chave}" | infEvento Id="ID{tpEvento}{chave}{nSeq}")
 *  - KeyInfo/X509Data/X509Certificate apenas com o certificado do usuário final (EndCertOnly)
 */
import { SignedXml } from "xml-crypto";

export const ALG_C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
export const ALG_ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
export const ALG_RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
export const ALG_SHA1 = "http://www.w3.org/2000/09/xmldsig#sha1";

export type TagAssinada = "infBPe" | "infEvento";

export interface OpcoesAssinatura {
  chavePrivadaPem: string;
  /** Certificado em PEM ou apenas Base64. */
  certificado: string;
  tag?: TagAssinada;
}

function base64Cert(cert: string): string {
  return cert.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
}

/** Detecta qual elemento assinar (infBPe ou infEvento). */
export function detectarTag(xml: string): TagAssinada {
  if (/<infBPe[\s>]/.test(xml)) return "infBPe";
  if (/<infEvento[\s>]/.test(xml)) return "infEvento";
  throw new Error("XML não contém <infBPe> nem <infEvento> para assinar.");
}

export function assinarXml(xml: string, opts: OpcoesAssinatura): string {
  const tag = opts.tag ?? detectarTag(xml);
  const idMatch = new RegExp(`<${tag}[^>]*\\sId="([^"]+)"`).exec(xml);
  if (!idMatch) throw new Error(`Atributo Id não encontrado em <${tag}>.`);
  const id = idMatch[1]!;
  if (tag === "infBPe" && !/^BPe\d{44}$/.test(id)) throw new Error(`Id de infBPe inválido (esperado "BPe"+44 dígitos): ${id}`);
  if (tag === "infEvento" && !/^ID\d{6}\d{44}\d{2}$/.test(id)) throw new Error(`Id de infEvento inválido (esperado "ID"+tpEvento+chBPe+nSeqEvento): ${id}`);
  if (/<Signature[\s>]/.test(xml)) throw new Error("O XML já possui <Signature>.");

  const cert = base64Cert(opts.certificado);
  const sig = new SignedXml({
    privateKey: opts.chavePrivadaPem,
    publicCert: opts.certificado.includes("BEGIN") ? opts.certificado : undefined,
    canonicalizationAlgorithm: ALG_C14N,
    signatureAlgorithm: ALG_RSA_SHA1,
    getKeyInfoContent: () => `<X509Data><X509Certificate>${cert}</X509Certificate></X509Data>`,
  });
  sig.addReference({
    xpath: `//*[local-name(.)='${tag}']`,
    transforms: [ALG_ENVELOPED, ALG_C14N],
    digestAlgorithm: ALG_SHA1,
  });
  // A assinatura é o último filho do elemento raiz (após infBPe/infBPeSupl ou infEvento).
  sig.computeSignature(xml, { location: { reference: "/*", action: "append" } });
  const assinado = sig.getSignedXml();
  // xml-crypto usa o atributo Id já existente; garante URI correta
  if (!assinado.includes(`URI="#${id}"`)) throw new Error("Falha ao montar Reference URI da assinatura.");
  return assinado;
}

/** Verifica a assinatura (útil para testes e para conferir o XML antes do envio). */
export function verificarAssinatura(xml: string, certificadoPem: string): { valida: boolean; erros: string[] } {
  const m = /<Signature[\s\S]*<\/Signature>/.exec(xml);
  if (!m) return { valida: false, erros: ["Signature não encontrada"] };
  const sig = new SignedXml({ publicCert: certificadoPem });
  sig.loadSignature(m[0]);
  try {
    const ok = sig.checkSignature(xml);
    return { valida: ok, erros: ok ? [] : ["Assinatura inválida"] };
  } catch (e) {
    return { valida: false, erros: [(e as Error).message] };
  }
}
