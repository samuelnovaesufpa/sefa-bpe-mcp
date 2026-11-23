# mcp-sefaz-bpe

Servidor **MCP (Model Context Protocol)** em TypeScript para integração, validação, consulta e diagnóstico do
**Bilhete de Passagem Eletrônico (BP-e — Modelo 63)** junto às SEFAZ estaduais e à SVRS, seguindo o
**MOC BP-e v1.00b** (abril/2019).

## O que ele faz

| Tool | Serviço | Descrição |
|---|---|---|
| `bpe_gerar_chave_acesso` | — | Monta/valida a chave de 44 dígitos com DV Módulo 11 (motivos da rejeição 236) |
| `bpe_gerar_qrcode` | — | URL do QR Code (ISO/IEC 18004, nível M, UTF-8), normal e contingência off-line com `sign` RSA-SHA1 |
| `bpe_diagnosticar_rejeicao` | — | `cStat` → mensagem oficial, causa, regras violadas (A–J, CI) e ação corretiva |
| `bpe_validar_regras_negocio` | — | Pré-validação local do Grupo F (datas, contingência, viagem, valores, descontos, pagamentos, substituição, QR Code) |
| `bpe_consultar_status` | `bpeStatusServicoBP` | Status do autorizador (respeita 3 min entre consultas) |
| `bpe_consultar_situacao` | `bpeConsultaBP` | Situação do BP-e pela chave (máx. 10/hora por chave) |
| `bpe_autorizar` | `bpeRecepcao` | Minifica, verifica forma, assina, GZip+Base64 e envia (1 BP-e por requisição) |
| `bpe_registrar_evento` | `bpeRecepcaoEvento` | Cancelamento `110111`, Não Embarque `110115`, Alteração de Poltrona `110116` |
| `bpe_consultar_cadastro` | `consultaCadastro` | Cadastro de contribuintes ICMS (WS da NF-e) |
| `bpe_info_ambiente` | — | Modo, URLs resolvidas, certificado e estado do limitador anti-678 |

Sem certificado configurado, os serviços rodam em **modo mock/dry-run**: nada é enviado, e a resposta traz o XML e o
envelope SOAP que seriam transmitidos, mais um retorno simulado.

**Resources**: todos os arquivos de `data/` ficam disponíveis como `bpe://data/...` (ex.: `bpe://data/codigos_status.json`).

## Bases de dados (`data/`)

Extraídas do MOC BP-e v1.00b (PDF em `docs/`):

- `codigos_status.json`: os 182 códigos `cStat` da seção 8.2, com categoria, ação corretiva e índice das regras que os geram
- `codigos_consulta_publica.json`: códigos 201–208 da consulta pública/QR Code (11.3)
- `tipos_evento.json`: 110111, 110115, 110116 e 240140 com campos, schemas e regras
- `contingencia_offline.json`: `tpEmis=2`, `dhCont`, `xJust`, prazos, ações e riscos (seção 12)
- `endpoints_uf.json`: estrutura Prod/Hom e QR Code por UF (**parcial**, veja pendências)
- `regras_validacao/certificado_xml.json`: grupos A, B, C, D, E
- `regras_validacao/negocio_bpe.json`: grupo F (F01–F112), G (consulta situação) e H (consulta status)
- `regras_validacao/eventos.json`: grupos I (geral) e J (cancelamento, não embarque, poltrona)
- `regras_validacao/uso_indevido.json`: CI01, CI03, CI04, CI05 (Rejeição 678)

## Instalação

```bash
npm install
cp .env.example .env      # edite tpAmb, UF, CNPJ e certificado
npm run build
npm test
```

### Usar no Claude Code / Claude Desktop

```bash
claude mcp add sefaz-bpe -- node /caminho/para/mcp-sefaz-bpe/dist/index.js
```

ou em `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sefaz-bpe": {
      "command": "node",
      "args": ["/caminho/para/mcp-sefaz-bpe/dist/index.js"],
      "env": { "BPE_TP_AMB": "2", "BPE_UF": "RS", "BPE_MODO": "mock" }
    }
  }
}
```

## Escopo técnico (MOC BP-e v1.00b)

- **Comunicação:** SOAP 1.2 (`Document/Literal`, sem Header) sobre TLS 1.2 com autenticação mútua; `bpeDadosMsg` / `bpeResultMsg`.
- **Certificado:** ICP-Brasil A1/A3 com CNPJ no OID `2.16.76.1.3.3`.
- **Assinatura:** XMLDSig Enveloped, RSA-SHA1, SHA-1, transforms Enveloped + C14N, em `infBPe` e `infEvento`.
- **XML:** UTF-8, namespace único sem prefixo, minificado, sem tags vazias, escape de caracteres especiais, até 1024 KB.
- **Compactação:** apenas `bpeRecepcao` (GZip + Base64).
- **Uso indevido:** bloqueio preventivo local antes dos limites da seção 9.2.

## Segurança

`.env`, certificados (`*.pfx`, `*.p12`, `*.pem`, `*.key`, `*.crt`, `certs/`) e `logs/` estão no `.gitignore`.
Guarde o certificado fora do repositório e aponte `BPE_CERT_PFX_PATH` para ele.

## Pendências

- Confirmar as URLs em `data/endpoints_uf.json` no [Portal Nacional do BP-e](https://dfe-portal.svrs.rs.gov.br/BPe/Servicos) e preencher as UFs com autorizador próprio e as URLs de `consultaCadastro`.
- Baixar o Pacote de Liberação **PL_BPe** em `schemas/` e adicionar a validação XSD local.
- Modelar o leiaute completo do BP-e (Anexo I) para gerar o XML a partir de JSON.
- Tabela IBGE de municípios e validação de IE por UF.

## Estrutura

```
docs/      MOC BP-e v1.00b (PDF), Anexos I/II e NTs
schemas/   XSDs oficiais (PL_BPe + xmldsig-core)
data/      bases JSON do MOC
src/       servidor MCP (tools, resources, cliente SOAP/TLS, serviços)
tests/     Vitest
```
