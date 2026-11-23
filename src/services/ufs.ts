/** Tabela de UFs (código IBGE) usada na chave de acesso, cOrgao e validação de municípios. */
export const UF_CODIGOS: Record<string, string> = {
  RO: "11", AC: "12", AM: "13", RR: "14", PA: "15", AP: "16", TO: "17",
  MA: "21", PI: "22", CE: "23", RN: "24", PB: "25", PE: "26", AL: "27", SE: "28", BA: "29",
  MG: "31", ES: "32", RJ: "33", SP: "35",
  PR: "41", SC: "42", RS: "43",
  MS: "50", MT: "51", GO: "52", DF: "53",
};

export const CODIGO_UF: Record<string, string> = Object.fromEntries(
  Object.entries(UF_CODIGOS).map(([uf, cod]) => [cod, uf]),
);

export function codigoDaUf(uf: string): string | undefined {
  return UF_CODIGOS[uf.toUpperCase()];
}

export function ufDoCodigo(cUF: string | number): string | undefined {
  return CODIGO_UF[String(cUF).padStart(2, "0")];
}

export function isCodigoUfValido(cUF: string | number): boolean {
  return ufDoCodigo(cUF) !== undefined;
}

/** Verifica se os 2 primeiros dígitos do código IBGE do município correspondem à UF. */
export function municipioPertenceUf(cMun: string | number, uf: string): boolean {
  if (uf.toUpperCase() === "EX") return String(cMun) === "9999999";
  const cod = codigoDaUf(uf);
  return !!cod && String(cMun).padStart(7, "0").slice(0, 2) === cod;
}
