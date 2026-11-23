/** Diagnóstico de cStat a partir de data/codigos_status.json + data/regras_validacao/. */
import { buscarCodigo, resolverRegra, type RegraValidacao } from "../resources/dataStore.js";

export interface Diagnostico {
  cStat: number;
  encontrado: boolean;
  tipo?: "sucesso" | "rejeicao";
  mensagem?: string;
  categoria?: string;
  causa?: string;
  regrasVioladas: (RegraValidacao & { arquivo: string; grupo: string; evento?: string })[];
  acaoCorretiva?: string;
  complementoEsperado?: string;
  detalhesXMotivo?: Record<string, string>;
  alertaUsoIndevido?: string;
}

/** Extrai complementos do xMotivo, ex.: "[chBPe: ...][nProt: ...][Motivo: ...]". */
export function extrairComplementos(xMotivo?: string): Record<string, string> | undefined {
  if (!xMotivo) return undefined;
  const out: Record<string, string> = {};
  for (const m of xMotivo.matchAll(/\[\s*([A-Za-z]+)\s*:\s*([^\]]+)\]/g)) out[m[1]!] = m[2]!.trim();
  return Object.keys(out).length ? out : undefined;
}

const REJEICOES_REPETIVEIS = new Set([215, 225, 243, 539, 204, 218, 224, 631]);

export function diagnosticarRejeicao(cStatEntrada: number | string, xMotivo?: string, contexto?: { tpEvento?: string }): Diagnostico {
  const cStat = Number(String(cStatEntrada).trim());
  const cod = Number.isFinite(cStat) ? buscarCodigo(cStat) : undefined;
  if (!cod) {
    return {
      cStat,
      encontrado: false,
      regrasVioladas: [],
      acaoCorretiva: "Código não catalogado no MOC BP-e v1.00b. Verifique se é um código de outra NT/UF, leia o xMotivo e consulte o Portal Nacional do BP-e (dfe-portal.svrs.rs.gov.br/bpe).",
      detalhesXMotivo: extrairComplementos(xMotivo),
    };
  }
  let refs = cod.regras ?? [];
  if (contexto?.tpEvento) {
    const filtradas = refs.filter((r) => !r.evento || r.evento === contexto.tpEvento);
    if (filtradas.length) refs = filtradas;
  }
  const regras = refs
    .map((r) => {
      const regra = resolverRegra(r);
      return regra ? { ...regra, arquivo: r.arquivo, grupo: r.grupo, ...(r.evento ? { evento: r.evento } : {}) } : undefined;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  const causa = regras.length ? regras.map((r) => `${r.id}${r.evento ? ` (evento ${r.evento})` : ""}: ${r.regra ?? (r as any).condicao}`).join(" | ") : cod.mensagem;

  const d: Diagnostico = {
    cStat,
    encontrado: true,
    tipo: cod.tipo,
    mensagem: cod.mensagem,
    categoria: cod.categoria,
    causa,
    regrasVioladas: regras,
    acaoCorretiva: cod.acao_corretiva,
    complementoEsperado: cod.complemento_xMotivo,
    detalhesXMotivo: extrairComplementos(xMotivo),
  };
  if (cStat === 678) {
    d.alertaUsoIndevido = "Suspenda os envios ao serviço por no mínimo 1 hora. Limites (seção 9.2): >30 rejeições iguais na autorização, >10 consultas/hora da mesma chave, >20 rejeições iguais em eventos, >60 envios repetidos em 5 minutos. Status: no mínimo 3 minutos entre consultas.";
  } else if (cod.tipo === "rejeicao" && (REJEICOES_REPETIVEIS.has(cStat) || cStat >= 200)) {
    d.alertaUsoIndevido = "Não reenvie o mesmo documento sem corrigir a causa: repetições da mesma rejeição levam à Rejeição 678 (Uso Indevido).";
  }
  return d;
}
