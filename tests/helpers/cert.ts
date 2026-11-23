import forge from "node-forge";

/** Gera um certificado autoassinado de teste (NÃO é ICP-Brasil) com CNPJ no CN. */
export function gerarCertificadoTeste(cnpj = "11222333000181") {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const attrs = [{ name: "commonName", value: `EMPRESA TESTE LTDA:${cnpj}` }, { name: "countryName", value: "BR" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], "senha123", { algorithm: "3des" });
  return {
    chavePrivadaPem: forge.pki.privateKeyToPem(keys.privateKey),
    certificadoPem: forge.pki.certificateToPem(cert),
    pfx: Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary"),
  };
}
