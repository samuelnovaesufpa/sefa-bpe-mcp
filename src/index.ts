#!/usr/bin/env node
/** Entry point do servidor MCP (transporte stdio). Logs vão para stderr; stdout é reservado ao protocolo. */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { criarServidor, NOME, VERSAO } from "./server.js";

async function main(): Promise<void> {
  const { server, svc } = criarServidor();
  await server.connect(new StdioServerTransport());
  console.error(`[${NOME} ${VERSAO}] pronto via stdio — modo=${svc.modo} tpAmb=${svc.cfg.tpAmb} UF=${svc.cfg.uf}`);
}

main().catch((e) => {
  console.error(`[${NOME}] erro fatal:`, e);
  process.exit(1);
});
