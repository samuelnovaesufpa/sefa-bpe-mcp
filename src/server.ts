import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BpeService } from "./client/bpeService.js";
import { carregarConfig, type Config } from "./config/index.js";
import { registrarResources } from "./resources/index.js";
import { registrarTools } from "./tools/index.js";

export const NOME = "mcp-sefaz-bpe";
export const VERSAO = "0.1.0";

export function criarServidor(cfg: Config = carregarConfig()): { server: McpServer; svc: BpeService } {
  const server = new McpServer(
    { name: NOME, version: VERSAO },
    {
      instructions:
        "Servidor MCP do BP-e (Bilhete de Passagem Eletrônico, modelo 63) conforme MOC BP-e v1.00b. " +
        "Use bpe_diagnosticar_rejeicao para explicar cStat, bpe_validar_regras_negocio antes de autorizar, e os resources bpe://data/* para consultar regras. " +
        "Respeite os limites anti-678: não repita envios rejeitados e aguarde 3 minutos entre consultas de status.",
    },
  );
  const svc = new BpeService(cfg);
  registrarTools(server, svc);
  registrarResources(server);
  return { server, svc };
}
