/** Carregamento de configuração a partir de variáveis de ambiente (.env). */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { codigoDaUf } from "../services/ufs.js";

export type ModoOperacao = "auto" | "mock" | "real";
export type TpAmb = 1 | 2;

export interface Config {
  tpAmb: TpAmb;
  uf: string;
  cUF: string;
  cnpjEmitente?: string;
  modo: ModoOperacao;
  certPfxPath?: string;
  certPfxSenha?: string;
  caPath?: string;
  timeoutMs: number;
  tzOffset: string;
  urls: {
    bpeRecepcao?: string;
    bpeConsultaBP?: string;
    bpeStatusServicoBP?: string;
    bpeRecepcaoEvento?: string;
    consultaCadastro?: string;
    qrCode?: string;
  };
}

let carregado = false;

function vazio(v: string | undefined): string | undefined {
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export function carregarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (!carregado && env === process.env) {
    // quiet: o protocolo stdio do MCP não pode receber logs no stdout
    dotenv.config({ quiet: true } as dotenv.DotenvConfigOptions);
    carregado = true;
  }
  const tpAmb = (Number(env.BPE_TP_AMB ?? "2") === 1 ? 1 : 2) as TpAmb;
  const uf = (vazio(env.BPE_UF) ?? "RS").toUpperCase();
  const cUF = codigoDaUf(uf);
  if (!cUF) throw new Error(`BPE_UF inválida: ${uf}`);
  const modoEnv = (vazio(env.BPE_MODO) ?? "auto").toLowerCase();
  const modo: ModoOperacao = modoEnv === "mock" || modoEnv === "real" ? modoEnv : "auto";
  const tz = vazio(env.BPE_TZ_OFFSET) ?? "-03:00";
  if (!/^[+-]\d{2}:\d{2}$/.test(tz)) throw new Error(`BPE_TZ_OFFSET inválido: ${tz} (use ex.: -03:00)`);

  return {
    tpAmb,
    uf,
    cUF,
    cnpjEmitente: vazio(env.BPE_CNPJ_EMITENTE),
    modo,
    certPfxPath: vazio(env.BPE_CERT_PFX_PATH),
    certPfxSenha: env.BPE_CERT_PFX_SENHA ?? "",
    caPath: vazio(env.BPE_CA_PATH),
    timeoutMs: Number(env.BPE_TIMEOUT_MS ?? 30000) || 30000,
    tzOffset: tz,
    urls: {
      bpeRecepcao: vazio(env.BPE_URL_RECEPCAO),
      bpeConsultaBP: vazio(env.BPE_URL_CONSULTA),
      bpeStatusServicoBP: vazio(env.BPE_URL_STATUS),
      bpeRecepcaoEvento: vazio(env.BPE_URL_EVENTO),
      consultaCadastro: vazio(env.BPE_URL_CONSULTA_CADASTRO),
      qrCode: vazio(env.BPE_URL_QRCODE),
    },
  };
}

/** Indica se há certificado utilizável (arquivo existente). */
export function certificadoDisponivel(cfg: Config): boolean {
  return !!cfg.certPfxPath && existsSync(resolve(cfg.certPfxPath));
}

/** Decide se as chamadas aos Web Services serão reais ou mock/dry-run. */
export function modoEfetivo(cfg: Config): "mock" | "real" {
  if (cfg.modo === "mock") return "mock";
  if (cfg.modo === "real") return "real";
  return certificadoDisponivel(cfg) ? "real" : "mock";
}

/** Data/hora no formato do MOC: AAAA-MM-DDTHH:MM:SS±HH:MM (UTC com TimeZone). */
export function formatarDataHora(data: Date = new Date(), tzOffset = "-03:00"): string {
  const sinal = tzOffset.startsWith("-") ? -1 : 1;
  const [h, m] = tzOffset.slice(1).split(":").map(Number);
  const offsetMin = sinal * ((h ?? 0) * 60 + (m ?? 0));
  const local = new Date(data.getTime() + offsetMin * 60_000);
  return local.toISOString().slice(0, 19) + tzOffset;
}
