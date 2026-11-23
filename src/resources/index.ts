/** Exposição dos JSONs de data/ como MCP Resources (bpe://data/...). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataDir, listarArquivosData } from "./dataStore.js";

const DESCRICOES: Record<string, string> = {
  "codigos_status.json": "Tabela completa de cStat do BP-e (MOC 8.2) com ação corretiva e regras relacionadas",
  "codigos_consulta_publica.json": "Códigos 201–208 da consulta pública / QR Code (MOC 11.3)",
  "tipos_evento.json": "Tipos de evento 110111, 110115, 110116 e 240140 com campos e regras",
  "contingencia_offline.json": "Regras da contingência off-line (tpEmis=2, dhCont, xJust, prazos)",
  "endpoints_uf.json": "Estrutura de endpoints Produção/Homologação e QR Code por UF",
  "regras_validacao/certificado_xml.json": "Grupos A, B, C, D e E: transmissor, mensagem, forma do XML, certificado e assinatura",
  "regras_validacao/negocio_bpe.json": "Grupos F (regras de negócio do BP-e), G (consulta situação) e H (consulta status)",
  "regras_validacao/eventos.json": "Grupos I (eventos, parte geral) e J (cancelamento, não embarque, poltrona)",
  "regras_validacao/uso_indevido.json": "Regras CI01, CI03, CI04, CI05 — Rejeição 678 (Uso Indevido)",
};

export function uriDe(rel: string): string {
  return `bpe://data/${rel}`;
}

export function registrarResources(server: McpServer): string[] {
  const arquivos = listarArquivosData();
  for (const rel of arquivos) {
    const uri = uriDe(rel);
    server.registerResource(
      rel.replace(/\.json$/, "").replace(/\//g, "_"),
      uri,
      { title: rel, description: DESCRICOES[rel] ?? `Base BP-e: ${rel}`, mimeType: "application/json" },
      async () => ({ contents: [{ uri, mimeType: "application/json", text: readFileSync(join(dataDir(), rel), "utf-8") }] }),
    );
  }
  return arquivos.map(uriDe);
}
