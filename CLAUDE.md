# CLAUDE.md — mcp-sefaz-bpe

Servidor MCP (TypeScript, `@modelcontextprotocol/sdk`, transporte stdio) para o **BP-e — Bilhete de Passagem Eletrônico (modelo 63)**, seguindo o **MOC BP-e v1.00b** (`docs/moc_bpe_visaogeral_v1-00b.pdf`).

## Comandos

```bash
npm install          # dependências
npm run build        # tsc -> dist/
npm test             # vitest run (tests/**/*.test.ts)
npm run dev          # roda src/index.ts com tsx (stdio)
npm start            # roda dist/index.js
npm run typecheck    # tsc --noEmit
```

## Arquitetura

```
src/index.ts              entry point stdio (logs SOMENTE em stderr; stdout é do protocolo MCP)
src/server.ts             cria McpServer, registra tools e resources
src/config/               .env -> Config (tpAmb, UF, modo, certificado, URLs, fuso) + formatarDataHora
src/client/
  soapClient.ts           SOAP 1.2 Document/Literal, sem Header, TLS 1.2+ mTLS (pfx), bpeDadosMsg/bpeResultMsg
  xmlSigner.ts            XMLDSig Enveloped RSA-SHA1/SHA-1, transforms enveloped+C14N, Reference URI="#Id"
  xmlBuilder.ts           XML estrito (UTF-8, ns único sem prefixo, minificado, supressão de vazios, escape, 1024 KB, GZip+Base64)
  rateLimiter.ts          proteção local anti-Rejeição 678 (status 3 min, CI01, CI03, CI04, CI05)
  certificado.ts          leitura de PFX A1 (node-forge) e extração do CNPJ (OID 2.16.76.1.3.3)
  bpeService.ts           orquestra serviços (mock/dry-run x real), assina, aplica rate limit
src/services/
  chaveAcesso.ts          chave de 44 dígitos + DV Módulo 11 + validação (motivos da 236)
  qrCode.ts               URL do QR Code (normal e off-line com sign RSA-SHA1) + SVG/PNG
  validadorLocal.ts       pré-validação das regras do Grupo F
  diagnostico.ts          cStat -> causa, regras, ação corretiva
  documentos.ts / ufs.ts  CNPJ/CPF, tabela de UFs IBGE
src/tools/index.ts        registro das MCP Tools (schemas zod)
src/resources/            data/ exposto como bpe://data/... ; dataStore.ts lê os JSONs
data/                     bases JSON extraídas do MOC (fonte da verdade para diagnóstico)
schemas/                  XSDs oficiais (PL_BPe) — baixar do Portal SVRS
tests/                    Vitest
```

## Regras fiscais/técnicas que NÃO podem ser quebradas (MOC BP-e v1.00b)

- **SOAP 1.2** Document/Literal, **sem `<soap12:Header>`**; requisição em `bpeDadosMsg`, retorno em `bpeResultMsg`.
- **TLS 1.2 com autenticação mútua**; certificado ICP-Brasil A1/A3 com CNPJ no `otherName OID 2.16.76.1.3.3`.
- **Somente `bpeRecepcao`** envia GZip + Base64, **um BP-e por requisição (sem lote)**. Demais serviços: XML puro.
- XML: UTF-8, uma única declaração `<?xml?>`, namespace único `http://www.portalfiscal.inf.br/bpe` sem prefixo
  (apenas `<Signature>` declara `http://www.w3.org/2000/09/xmldsig#`), sem espaços/quebras entre tags, sem comentários,
  sem tags opcionais vazias/zeradas, escape de `< > & " '`, máximo 1024 KB.
- Assinatura: Enveloped, RSA-SHA1, SHA-1, transforms Enveloped + C14N (`REC-xml-c14n-20010315`), Base64, apenas
  `X509Certificate` do usuário final. Assinar `<infBPe Id="BPe{chave}">` e `<infEvento Id="ID{tpEvento}{chave}{nSeq 2 díg}">`.
  Nunca alterar o XML depois de assinado.
- Data/hora: `AAAA-MM-DDTHH:MM:SS±HH:MM`.
- Chave: `cUF(2)+AAMM(4)+CNPJ(14)+63+serie(3)+nBP(9)+tpEmis(1)+cBP(8)+DV(1)`; DV Módulo 11 (pesos 2..9, resto 0/1 => 0).
  Em contingência manter o mesmo `cBP`.
- QR Code: `URL?chBPe=..&tpAmb=..`; off-line adiciona `&sign=` (RSA-SHA1 Base64 da chave com o certificado que assina o BP-e).
  Nível M, UTF-8. Vai em `infBPeSupl/qrCodBPe`.
- **Uso indevido (678)**: nunca criar loops de reenvio. Status ≥ 3 min entre consultas; bloqueio local antes de
  >30 rejeições iguais (autorização), >10 consultas/hora por chave, >20 rejeições iguais (eventos), >60 envios repetidos/5 min.
  Toda chamada a Web Service passa por `RateLimiter.exigir()` em `bpeService.executar()`.

## Convenções

- ESM (`"type": "module"`), imports relativos com sufixo `.js`.
- Tools retornam JSON em `content[0].text`; erros com `isError: true`.
- Sem certificado no `.env` => **modo mock/dry-run** (nada é enviado; retorna o XML/envelope que seria enviado).
- Segredos: `.env`, `*.pfx`, `*.p12`, `*.pem`, `*.key`, `*.crt`, `certs/`, `logs/` estão no `.gitignore` — nunca versionar.
- Ao alterar regras, edite os JSONs de `data/` e mantenha o índice `regras` de `codigos_status.json` coerente.

## Pendências conhecidas

- `data/endpoints_uf.json`: URLs da SVRS preenchidas pelo padrão público — **confirmar** em https://dfe-portal.svrs.rs.gov.br/BPe/Servicos;
  UFs com autorizador próprio (MG, MS, MT, PR) e URLs de `consultaCadastro` por UF estão como `PENDENTE`.
- `schemas/`: baixar o Pacote de Liberação PL_BPe e implementar validação XSD (C01/215) localmente.
- Leiaute completo do BP-e (Anexo I) ainda não modelado: `bpe_autorizar` recebe o XML pronto.
- Validação de DV de IE por UF, tabela de municípios IBGE (F14, F16, F30, F36...).
