/** Validação de CNPJ/CPF (dígitos de controle, zeros e sequências repetidas). */

export function somenteDigitos(v: string | number | undefined | null): string {
  return String(v ?? "").replace(/\D/g, "");
}

export function validarCNPJ(valor: string | number | undefined | null): boolean {
  const c = somenteDigitos(valor);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (base: string, pesos: number[]) => {
    const soma = base.split("").reduce((acc, d, i) => acc + Number(d) * pesos[i]!, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const p2 = [6, ...p1];
  const d1 = calc(c.slice(0, 12), p1);
  const d2 = calc(c.slice(0, 12) + d1, p2);
  return c.endsWith(`${d1}${d2}`);
}

export function validarCPF(valor: string | number | undefined | null): boolean {
  const c = somenteDigitos(valor);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const calc = (base: string, pesoInicial: number) => {
    const soma = base.split("").reduce((acc, d, i) => acc + Number(d) * (pesoInicial - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = calc(c.slice(0, 9), 10);
  const d2 = calc(c.slice(0, 10), 11);
  return c.endsWith(`${d1}${d2}`);
}
