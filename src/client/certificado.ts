/** Leitura de certificado ICP-Brasil A1 (.pfx/.p12) com node-forge. */
import { readFileSync } from "node:fs";
import forge from "node-forge";

export const OID_CNPJ = "2.16.76.1.3.3";

export interface CertificadoCarregado {
  pfx: Buffer;
  senha: string;
  chavePrivadaPem: string;
  certificadoPem: string;
  /** Conteúdo Base64 do certificado (sem cabeçalhos), para X509Certificate. */
  certificadoBase64: string;
  cnpj?: string;
  titular: string;
  validoDe: Date;
  validoAte: Date;
}

/** Procura o CNPJ no otherName OID 2.16.76.1.3.3 (SAN) ou, como fallback, no CN ("RAZAO:CNPJ"). */
export function extrairCnpj(cert: forge.pki.Certificate): string | undefined {
  try {
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const oidDer = forge.asn1.toDer(forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false, forge.asn1.oidToDer(OID_CNPJ).getBytes())).getBytes();
    const pos = der.indexOf(oidDer);
    if (pos >= 0) {
      const trecho = der.slice(pos + oidDer.length, pos + oidDer.length + 40);
      const m = /(\d{14})/.exec(trecho);
      if (m) return m[1];
    }
  } catch {
    /* ignora e tenta o CN */
  }
  const cn = cert.subject.getField("CN")?.value as string | undefined;
  const m = cn ? /:(\d{14})$/.exec(cn) : null;
  return m?.[1];
}

export function carregarPfx(caminho: string, senha: string): CertificadoCarregado {
  const pfx = readFileSync(caminho);
  const p12Asn1 = forge.asn1.fromDer(pfx.toString("binary"));
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, senha);

  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];
  const keyBag = keyBags[0] ?? (p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? [])[0];
  if (!keyBag?.key) throw new Error("Chave privada não encontrada no PFX.");

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  // certificado de usuário final: aquele cuja chave pública corresponde à chave privada
  const priv = keyBag.key as forge.pki.rsa.PrivateKey;
  const cert =
    certBags.map((b) => b.cert).find((c) => c && (c.publicKey as forge.pki.rsa.PublicKey).n.equals(priv.n)) ?? certBags[0]?.cert;
  if (!cert) throw new Error("Certificado não encontrado no PFX.");

  const certificadoPem = forge.pki.certificateToPem(cert);
  return {
    pfx,
    senha,
    chavePrivadaPem: forge.pki.privateKeyToPem(priv),
    certificadoPem,
    certificadoBase64: certificadoPem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, ""),
    cnpj: extrairCnpj(cert),
    titular: (cert.subject.getField("CN")?.value as string) ?? "",
    validoDe: cert.validity.notBefore,
    validoAte: cert.validity.notAfter,
  };
}
