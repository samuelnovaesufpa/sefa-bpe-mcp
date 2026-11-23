/** Acesso aos arquivos JSON da pasta data/ (bases extraídas do MOC BP-e v1.00b). */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

let dataDirCache: string | undefined;

/** Localiza a pasta data/ subindo a partir deste arquivo (funciona em src/ e em dist/). */
export function dataDir(): string {
  if (dataDirCache) return dataDirCache;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidato = join(dir, "data");
    if (existsSync(join(candidato, "codigos_status.json"))) {
      dataDirCache = candidato;
      return candidato;
    }
    dir = dirname(dir);
  }
  throw new Error("Pasta data/ não encontrada.");
}

const cache = new Map<string, unknown>();

export function lerJson<T = any>(rel: string): T {
  if (!cache.has(rel)) {
    cache.set(rel, JSON.parse(readFileSync(join(dataDir(), rel), "utf-8")));
  }
  return cache.get(rel) as T;
}

/** Lista todos os .json de data/ (caminhos relativos com "/"). */
export function listarArquivosData(): string[] {
  const base = dataDir();
  const out: string[] = [];
  const walk = (d: string) => {
    for (const nome of readdirSync(d).sort()) {
      const p = join(d, nome);
      if (statSync(p).isDirectory()) walk(p);
      else if (nome.endsWith(".json")) out.push(relative(base, p).split(sep).join("/"));
    }
  };
  walk(base);
  return out;
}

export interface RegraValidacao {
  id: string;
  cStat: number | null;
  critica: string;
  efeito: string;
  regra: string;
  acao_corretiva: string;
  subgrupo?: string;
  [k: string]: unknown;
}

export interface CodigoStatus {
  cStat: number;
  tipo: "sucesso" | "rejeicao";
  mensagem: string;
  categoria: string;
  complemento_xMotivo?: string;
  acao_corretiva: string;
  regras?: { arquivo: string; grupo: string; id: string; evento?: string }[];
}

export function codigosStatus(): CodigoStatus[] {
  return lerJson<{ codigos: CodigoStatus[] }>("codigos_status.json").codigos;
}

export function buscarCodigo(cStat: number): CodigoStatus | undefined {
  return codigosStatus().find((c) => c.cStat === cStat);
}

/** Resolve uma referência {arquivo, grupo, id, evento?} para o objeto completo da regra. */
export function resolverRegra(ref: { arquivo: string; grupo: string; id: string; evento?: string }): RegraValidacao | undefined {
  const doc = lerJson<any>(ref.arquivo);
  if (ref.grupo === "CI") return doc.regras?.find((r: any) => r.id === ref.id);
  const g = doc.grupos?.[ref.grupo];
  if (!g) return undefined;
  if (ref.evento) return g.eventos?.[ref.evento]?.regras?.find((r: any) => r.id === ref.id);
  return g.regras?.find((r: any) => r.id === ref.id);
}
