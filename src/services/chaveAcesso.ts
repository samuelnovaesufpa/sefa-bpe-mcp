/**
 * Chave de acesso do BP-e (44 dígitos) — MOC BP-e v1.00b, seções 2.1 e 8.4.
 *
 *   cUF(2) + AAMM(4) + CNPJ(14) + mod(2) + serie(3) + nBP(9) + tpEmis(1) + cBP(8) + cDV(1)
 */
import { validarCNPJ, somenteDigitos } from "./documentos.js";
import { isCodigoUfValido } from "./ufs.js";

export const MODELO_BPE = "63";

export interface ComponentesChave {
  cUF: string | number;
  /** Ano e mês de emissão no formato AAMM (ex.: "2511"). */
  aamm: string;
  cnpj: string;
  serie: string | number;
  nBP: string | number;
  /** 1 = Normal, 2 = Contingência Off-line */
  tpEmis: string | number;
  /** Código numérico de 8 dígitos. Se omitido na geração, é sorteado. */
  cBP?: string | number;
  mod?: string | number;
}

export interface ChaveDecomposta {
  cUF: string;
  aamm: string;
  ano: number;
  mes: number;
  cnpj: string;
  mod: string;
  serie: string;
  nBP: string;
  tpEmis: string;
  cBP: string;
  cDV: string;
}

/**
 * Calcula o DV pelo Módulo 11: pesos 2..9 aplicados da direita para a esquerda;
 * DV = 11 - (soma % 11); se o resto for 0 ou 1, DV = 0.
 */
export function calcularDV(chave43: string): number {
  if (!/^\d{43}$/.test(chave43)) {
    throw new Error("A base da chave de acesso deve conter exatamente 43 dígitos numéricos.");
  }
  let soma = 0;
  let peso = 2;
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto === 0 || resto === 1 ? 0 : 11 - resto;
}

/** Retorna o resto da divisão por 11 da soma ponderada (útil para diagnóstico/testes). */
export function restoModulo11(chave43: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  return soma % 11;
}

/** Gera um cBP aleatório de 8 dígitos, evitando igualdade com nBP (boa prática). */
export function gerarCodigoNumerico(nBP?: string | number): string {
  let cBP: string;
  const n = nBP !== undefined ? String(nBP).padStart(9, "0").slice(-8) : undefined;
  do {
    cBP = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  } while (cBP === n || cBP === "00000000");
  return cBP;
}

/** Converte uma data (Date ou ISO) para AAMM. */
export function aammDeData(data: Date | string): string {
  const s = typeof data === "string" ? data : data.toISOString();
  const m = /^(\d{4})-(\d{2})/.exec(s);
  if (!m) throw new Error(`Data inválida para AAMM: ${s}`);
  return m[1]!.slice(2) + m[2]!;
}

function pad(v: string | number, len: number, campo: string): string {
  const s = somenteDigitos(String(v));
  if (s.length === 0 || s.length > len) {
    throw new Error(`Campo ${campo} inválido: deve ter de 1 a ${len} dígitos numéricos (recebido "${v}").`);
  }
  return s.padStart(len, "0");
}

export function montarChave(c: ComponentesChave): { chave: string; cBP: string; dv: number; id: string } {
  const cBP = c.cBP !== undefined ? pad(c.cBP, 8, "cBP") : gerarCodigoNumerico(c.nBP);
  const base =
    pad(c.cUF, 2, "cUF") +
    pad(c.aamm, 4, "AAMM") +
    pad(c.cnpj, 14, "CNPJ") +
    pad(c.mod ?? MODELO_BPE, 2, "mod") +
    pad(c.serie, 3, "serie") +
    pad(c.nBP, 9, "nBP") +
    pad(c.tpEmis, 1, "tpEmis") +
    cBP;
  const dv = calcularDV(base);
  const chave = base + dv;
  return { chave, cBP, dv, id: `BPe${chave}` };
}

export function decomporChave(chave: string): ChaveDecomposta {
  const c = somenteDigitos(chave);
  if (c.length !== 44) throw new Error("A chave de acesso deve ter 44 dígitos.");
  return {
    cUF: c.slice(0, 2),
    aamm: c.slice(2, 6),
    ano: 2000 + Number(c.slice(2, 4)),
    mes: Number(c.slice(4, 6)),
    cnpj: c.slice(6, 20),
    mod: c.slice(20, 22),
    serie: c.slice(22, 25),
    nBP: c.slice(25, 34),
    tpEmis: c.slice(34, 35),
    cBP: c.slice(35, 43),
    cDV: c.slice(43, 44),
  };
}

export interface ResultadoValidacaoChave {
  valida: boolean;
  chave: string;
  /** Motivos no padrão da rejeição 236 ("[Motivo: ...]"). */
  motivos: string[];
  componentes?: ChaveDecomposta;
  dvCalculado?: number;
}

/**
 * Valida a chave conforme a regra G04/I08 (cStat 236): CNPJ zerado ou inválido, ano < 2017 ou maior que o atual,
 * mês inválido, modelo diferente de 63, número zerado, tipo de emissão inválido, UF inválida ou DV inválido.
 */
export function validarChave(chave: string, agora: Date = new Date()): ResultadoValidacaoChave {
  const c = somenteDigitos(chave);
  const motivos: string[] = [];
  if (c.length !== 44 || c !== String(chave).trim()) {
    return { valida: false, chave: String(chave), motivos: ["Chave deve conter exatamente 44 dígitos numéricos"] };
  }
  const p = decomporChave(c);
  if (!isCodigoUfValido(p.cUF)) motivos.push("UF inválida");
  const anoAtual = agora.getUTCFullYear();
  if (p.ano < 2017 || p.ano > anoAtual) motivos.push("Ano < 2017 ou maior que atual");
  if (p.mes < 1 || p.mes > 12) motivos.push("Mês inválido (0 ou > 12)");
  if (p.ano === anoAtual && p.mes > agora.getUTCMonth() + 1) motivos.push("Ano-mês posterior ao atual");
  if (/^0+$/.test(p.cnpj)) motivos.push("CNPJ zerado");
  else if (!validarCNPJ(p.cnpj)) motivos.push("CNPJ inválido");
  if (p.mod !== MODELO_BPE) motivos.push("Modelo diferente de 63");
  if (/^0+$/.test(p.nBP)) motivos.push("Número zerado");
  if (p.tpEmis !== "1" && p.tpEmis !== "2") motivos.push("Tipo de emissão inválido");
  const dv = calcularDV(c.slice(0, 43));
  if (String(dv) !== p.cDV) motivos.push("DV inválido");
  return { valida: motivos.length === 0, chave: c, motivos, componentes: p, dvCalculado: dv };
}
