/**
 * Pré-validação local das regras de negócio do BP-e (Grupo F do MOC BP-e v1.00b, seção 5.3)
 * antes do envio ao autorizador. Regras que dependem de bases da SEFAZ (cadastros, IBGE, BD de BP-e)
 * não são verificadas aqui; o retorno lista quais ficaram de fora.
 */
import { decomporChave, montarChave, validarChave, aammDeData } from "./chaveAcesso.js";
import { validarCNPJ, validarCPF, somenteDigitos } from "./documentos.js";
import { codigoDaUf, municipioPertenceUf } from "./ufs.js";

export interface PayloadBPe {
  tpAmb?: 1 | 2;
  cUF?: string;
  /** 1 = Normal, 2 = Contingência Off-line */
  tpEmis: 1 | 2;
  /** 0 = Normal, 3 = Substituição */
  tpBPe?: 0 | 3;
  /** 1 = Rodoviário, 3 = Aquaviário, 4 = Ferroviário */
  modal?: 1 | 3 | 4;
  serie?: string | number;
  nBP?: string | number;
  cBP?: string;
  cDV?: string | number;
  chBPe?: string;
  dhEmi: string;
  dhCont?: string;
  xJust?: string;
  UFIni?: string;
  cMunIni?: string;
  UFFim?: string;
  cMunFim?: string;
  emitente?: { CNPJ?: string; IE?: string; UF?: string; cMun?: string; TAR?: string };
  comprador?: { CNPJ?: string; CPF?: string; IE?: string; UF?: string; cMun?: string };
  agencia?: { CNPJ?: string; UF?: string; cMun?: string };
  passageiro?: { xNome?: string; CPF?: string; nDoc?: string };
  viagens?: { tpTrecho: 1 | 2 | 3; dhViagem?: string; dhConexao?: string; tpServ?: number }[];
  infTravessia?: boolean;
  /** Data/hora do embarque (infValorBPe/dhEmb no leiaute) */
  dhEmb?: string;
  dhValidade?: string;
  valores?: {
    vBP: number;
    vDesconto?: number;
    tpDesconto?: string;
    xDesconto?: string;
    cDesconto?: string;
    vPgto?: number;
    vTroco?: number;
    componentes?: { tpComp?: string; vComp: number }[];
  };
  icms?: { vBC?: number; pICMS?: number; vICMS?: number };
  pagamentos?: { tPag: string; vPag: number; card?: { tpIntegra?: 1 | 2; CNPJ?: string; cAut?: string } }[];
  substituicao?: { chBPe: string; tpSub: 1 | 2 | 3 };
  autXML?: { CNPJ?: string; CPF?: string }[];
  qrCode?: string;
  respTec?: { CNPJ?: string };
}

export interface Achado {
  regra: string;
  cStat: number;
  mensagem: string;
  campo?: string;
}

export interface ResultadoValidacao {
  valido: boolean;
  erros: Achado[];
  avisos: Achado[];
  regrasVerificadas: string[];
  regrasNaoVerificaveisLocalmente: string[];
}

const NAO_LOCAIS = [
  "F01–F03 (ambiente/UF do Web Service)", "F08 (UF aceita off-line)", "F14/F16/F36/F41/F49 (existência do município na tabela IBGE)",
  "F30/F43 (DV da IE — algoritmo por UF)", "F31–F34 (credenciamento/cadastro do emitente)", "F44–F46 (cadastro do comprador)",
  "F64 (desconto no órgão regulador)", "F70/F72 (regras opcionais da UF)", "F76–F85, F97 (dados do BP-e substituído no BD)",
  "F98–F101 (duplicidade/situação no BD)", "F105 (URL oficial do QR Code por UF)", "F109 (valor do sign)", "F110/F112 (exigências da UF)",
];

/** Converte "AAAA-MM-DDTHH:MM:SS±HH:MM" em Date. */
function dt(s?: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

const TZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

function somaUmAno(dataIso: string): string {
  // trabalha só com a data local informada (AAAA-MM-DD)
  const [a, m, d] = dataIso.slice(0, 10).split("-").map(Number) as [number, number, number];
  const r = new Date(Date.UTC(a + 1, m - 1, d));
  if (r.getUTCMonth() !== m - 1) r.setUTCDate(0); // 29/02 -> 28/02
  return r.toISOString().slice(0, 10);
}

export function validarRegrasNegocio(p: PayloadBPe, agora: Date = new Date()): ResultadoValidacao {
  const erros: Achado[] = [];
  const avisos: Achado[] = [];
  const verificadas = new Set<string>();
  const err = (regra: string, cStat: number, mensagem: string, campo?: string) => erros.push({ regra, cStat, mensagem, campo });
  const chk = (...r: string[]) => r.forEach((x) => verificadas.add(x));

  // ---------------- Formato de data/hora (3.7)
  for (const [campo, valor] of Object.entries({ dhEmi: p.dhEmi, dhCont: p.dhCont, dhEmb: p.dhEmb })) {
    if (valor && !TZ_RE.test(valor)) avisos.push({ regra: "3.7", cStat: 215, mensagem: `${campo} deve estar no formato AAAA-MM-DDTHH:MM:SS±HH:MM (ex.: 2025-11-23T10:00:00-03:00).`, campo });
  }
  const dhEmi = dt(p.dhEmi);
  if (!dhEmi) err("3.7", 215, "dhEmi inválida.", "dhEmi");

  // ---------------- Gerais
  chk("F04");
  if (p.cUF && p.emitente?.UF && codigoDaUf(p.emitente.UF) !== String(p.cUF).padStart(2, "0")) err("F04", 233, "Código da UF do emitente difere da sigla da UF do emitente.", "cUF");

  chk("F05", "F06", "F07");
  if (p.tpEmis === 1 && (p.dhCont || p.xJust)) err("F05", 415, "Emissão normal (tpEmis=1): dhCont e xJust não devem ser informados.", "dhCont");
  if (p.tpEmis === 2) {
    if (!p.dhCont || !p.xJust) err("F06", 416, "Contingência off-line (tpEmis=2): dhCont e xJust devem ser informados.", "dhCont");
    if (p.xJust && (p.xJust.length < 15 || p.xJust.length > 256)) avisos.push({ regra: "Anexo I", cStat: 215, mensagem: "xJust normalmente deve ter entre 15 e 256 caracteres (confirmar no XSD do PL_BPe).", campo: "xJust" });
  }
  const dhCont = dt(p.dhCont);
  if (dhCont && dhEmi && dhCont.getTime() > dhEmi.getTime()) err("F07", 417, "dhCont deve ser menor ou igual à data de emissão.", "dhCont");

  // Chave de acesso (F09–F11)
  if (p.chBPe) {
    chk("F09", "F10", "F11");
    const v = validarChave(p.chBPe, agora);
    const comp = /^\d{44}$/.test(p.chBPe) ? decomporChave(p.chBPe) : undefined;
    if (comp && comp.ano < 2017) err("F10", 421, "Ano da chave de acesso inferior a 2017.", "chBPe");
    if (v.motivos.includes("DV inválido")) err("F11", 253, `Dígito verificador da chave inválido (calculado: ${v.dvCalculado}).`, "chBPe");
    if (comp && p.cUF && p.emitente?.CNPJ && p.serie !== undefined && p.nBP !== undefined && p.cBP && dhEmi) {
      try {
        const esperada = montarChave({ cUF: p.cUF, aamm: aammDeData(p.dhEmi), cnpj: p.emitente.CNPJ, serie: p.serie, nBP: p.nBP, tpEmis: p.tpEmis, cBP: p.cBP }).chave;
        if (esperada !== p.chBPe) err("F09", 227, `Chave do Id difere da concatenação dos campos (esperada ${esperada}).`, "chBPe");
      } catch (e) {
        err("F09", 227, `Não foi possível montar a chave a partir dos campos: ${(e as Error).message}`, "chBPe");
      }
    } else if (comp && String(comp.tpEmis) !== String(p.tpEmis)) {
      err("F09", 227, "tpEmis da chave difere do tpEmis informado.", "chBPe");
    }
  }

  // ---------------- Viagem
  if (p.cMunIni && p.UFIni) { chk("F12"); if (!municipioPertenceUf(p.cMunIni, p.UFIni)) err("F12", 409, "Município de início da viagem diverge da UF de início.", "cMunIni"); }
  if (p.UFIni && p.emitente?.UF) { chk("F13"); if (p.UFIni.toUpperCase() !== p.emitente.UF.toUpperCase()) err("F13", 505, "UF de início da viagem deve ser igual à UF do emitente.", "UFIni"); }
  if (p.cMunFim && p.UFFim) {
    chk("F15", "F17");
    if (p.UFFim.toUpperCase() === "EX") { if (p.cMunFim !== "9999999") err("F17", 411, "Viagem ao exterior: cMunFim deve ser 9999999.", "cMunFim"); }
    else if (!municipioPertenceUf(p.cMunFim, p.UFFim)) err("F15", 410, "Município de fim da viagem diverge da UF de fim.", "cMunFim");
  }
  const travessia = p.modal === 3 && (p.viagens ?? []).some((v) => v.tpServ === 9);
  if (p.UFIni && p.UFFim) {
    chk("F18");
    if (p.UFIni.toUpperCase() !== p.UFFim.toUpperCase() && !travessia && !p.passageiro?.xNome) err("F18", 211, "Viagem interestadual: dados do passageiro (infPassageiro) devem ser informados.", "passageiro");
  }
  if (p.passageiro?.CPF) { chk("F19"); if (!validarCPF(p.passageiro.CPF)) err("F19", 497, "CPF do passageiro inválido.", "passageiro.CPF"); }

  const viagens = p.viagens ?? [];
  if (viagens.length > 0) {
    chk("F20", "F21", "F22", "F23", "F24", "F25", "F26", "F27");
    if (viagens.length === 1) {
      if (viagens[0]!.tpTrecho !== 1) err("F20", 419, "Viagem sem conexão deve ter um único trecho com tpTrecho=1 (Normal).", "viagens");
    } else {
      if (p.modal !== undefined && p.modal !== 4) err("F21", 638, "Conexão (múltiplos trechos) só é permitida no modal ferroviário.", "viagens");
      const iniciais = viagens.filter((v) => v.tpTrecho === 2).length;
      const conexoes = viagens.filter((v) => v.tpTrecho === 3).length;
      if (iniciais !== 1 || conexoes !== viagens.length - 1) err("F22", 420, "Viagem com conexão: deve haver exatamente um trecho inicial (tpTrecho=2) e os demais de conexão (tpTrecho=3).", "viagens");
    }
    viagens.forEach((v, i) => {
      if (v.tpTrecho === 3 && !v.dhConexao) err("F23", 484, `Trecho ${i + 1}: data-hora da conexão deve ser informada para tpTrecho=3.`, `viagens[${i}].dhConexao`);
      if (v.tpTrecho !== 3 && v.dhConexao) err("F24", 485, `Trecho ${i + 1}: data-hora da conexão não deve ser informada para tpTrecho=${v.tpTrecho}.`, `viagens[${i}].dhConexao`);
      const emb = dt(v.dhViagem) ?? dt(p.dhEmb);
      const con = dt(v.dhConexao);
      if (emb && con && con.getTime() <= emb.getTime()) err("F25", 486, `Trecho ${i + 1}: data-hora da conexão deve ser maior que a do embarque.`, `viagens[${i}].dhConexao`);
      if (p.modal !== undefined && p.modal !== 3 && v.tpServ === 9) err("F27", 498, `Trecho ${i + 1}: tipo de serviço Travessia (9) só é válido no modal aquaviário.`, `viagens[${i}].tpServ`);
    });
    if (travessia && !p.infTravessia) err("F26", 639, "Modal aquaviário com tpServ=9 exige o grupo infTravessia.", "infTravessia");
  }

  // ---------------- Emitente
  if (p.emitente) {
    chk("F28", "F29", "F35", "F37");
    if (!validarCNPJ(p.emitente.CNPJ)) err("F28", 207, "CNPJ do emitente inválido.", "emitente.CNPJ");
    if (!p.emitente.IE || /^0+$/.test(somenteDigitos(p.emitente.IE))) err("F29", 229, "IE do emitente deve ser informada.", "emitente.IE");
    if (p.emitente.cMun && p.emitente.UF && !municipioPertenceUf(p.emitente.cMun, p.emitente.UF)) err("F35", 407, "Município do emitente diverge da UF.", "emitente.cMun");
    if (p.modal === 1 && !p.emitente.TAR) err("F37", 414, "Modal rodoviário: TAR (Termo de Autorização de Serviço Regular) deve ser informado.", "emitente.TAR");
  }

  // ---------------- Comprador / Agência
  if (p.comprador) {
    chk("F38", "F39", "F40", "F42");
    if (p.comprador.CNPJ && !validarCNPJ(p.comprador.CNPJ)) err("F38", 422, "CNPJ do comprador inválido.", "comprador.CNPJ");
    if (p.comprador.CPF && !validarCPF(p.comprador.CPF)) err("F39", 423, "CPF do comprador inválido.", "comprador.CPF");
    if (p.comprador.cMun && p.comprador.UF) {
      if (p.comprador.UF.toUpperCase() === "EX") { if (p.comprador.cMun !== "9999999") err("F42", 426, "Comprador no exterior: cMun deve ser 9999999.", "comprador.cMun"); }
      else if (!municipioPertenceUf(p.comprador.cMun, p.comprador.UF)) err("F40", 424, "Município do comprador diverge da UF.", "comprador.cMun");
    }
  }
  if (p.agencia) {
    chk("F47", "F48", "F50");
    const ext = p.agencia.UF?.toUpperCase() === "EX";
    if (p.agencia.CNPJ && !(ext && /^0+$/.test(p.agencia.CNPJ)) && !validarCNPJ(p.agencia.CNPJ)) err("F47", 431, "CNPJ da agência inválido.", "agencia.CNPJ");
    if (p.agencia.cMun && p.agencia.UF) {
      if (ext) { if (p.agencia.cMun !== "9999999") err("F50", 503, "Agência no exterior: cMun deve ser 9999999.", "agencia.cMun"); }
      else if (!municipioPertenceUf(p.agencia.cMun, p.agencia.UF)) err("F48", 432, "Município da agência diverge da UF.", "agencia.cMun");
    }
  }

  // ---------------- Datas de emissão / embarque / validade
  if (dhEmi) {
    chk("F51", "F52");
    const difMin = (dhEmi.getTime() - agora.getTime()) / 60000;
    if (difMin > 5) err("F51", 212, "Data/hora de emissão posterior ao horário atual (tolerância de 5 minutos). Verifique relógio e fuso.", "dhEmi");
    if (p.tpEmis === 1 && difMin < -5) avisos.push({ regra: "F52", cStat: 228, mensagem: "Emissão normal com dhEmi mais de 5 minutos no passado: será rejeitada (228) se transmitida agora.", campo: "dhEmi" });
    if (p.tpEmis === 2 && difMin < -24 * 60) avisos.push({ regra: "F52", cStat: 150, mensagem: "Contingência transmitida após 24h: a UF pode autorizar com cStat 150 (fora de prazo) ou rejeitar.", campo: "dhEmi" });
  }
  const dhEmb = dt(p.dhEmb) ?? dt(viagens[0]?.dhViagem);
  if (dhEmi && dhEmb) {
    chk("F53", "F54");
    if (dhEmb.getTime() < dhEmi.getTime()) err("F54", 254, "Data-hora do embarque deve ser igual ou superior à data de emissão.", "dhEmb");
    const umAno = new Date(somaUmAno(p.dhEmi) + p.dhEmi.slice(10));
    if (!isNaN(umAno.getTime()) && dhEmb.getTime() > umAno.getTime()) err("F53", 219, "Data-hora do embarque não pode ser superior a 1 ano da data de emissão.", "dhEmb");
  }
  if (p.dhValidade && p.dhEmi && (p.tpBPe ?? 0) === 0) {
    chk("F55");
    const esperada = somaUmAno(p.dhEmi);
    if (p.dhValidade.slice(0, 10) !== esperada) err("F55", 506, `BP-e Normal: data de validade deve ser 1 ano após a emissão (${esperada}).`, "dhValidade");
  }

  // ---------------- Valores
  const val = p.valores;
  if (val) {
    chk("F57", "F59", "F60", "F61", "F62", "F63", "F65", "F68");
    const r2 = (n: number) => Math.round(n * 100) / 100;
    if (val.vBP > 999999.99) err("F57", 434, "Valor total do bilhete superior a R$ 999.999,99.", "valores.vBP");
    if (val.componentes?.length) {
      const soma = r2(val.componentes.reduce((a, c) => a + c.vComp, 0));
      if (Math.abs(soma - val.vBP) > 1.0) err("F59", 436, `Soma dos componentes (${soma.toFixed(2)}) difere de vBP (${val.vBP.toFixed(2)}) além da tolerância de R$ 1,00.`, "valores.componentes");
    }
    if (val.tpDesconto) {
      if (!val.xDesconto) err("F60", 437, "Informado tpDesconto sem xDesconto.", "valores.xDesconto");
      if (!val.vDesconto || val.vDesconto <= 0) err("F61", 401, "Informado tpDesconto: vDesconto deve ser maior que zero.", "valores.vDesconto");
      if (val.tpDesconto === "99" && !val.cDesconto) err("F63", 511, "tpDesconto=99 (Outros) exige cDesconto.", "valores.cDesconto");
    } else {
      if ((val.vDesconto ?? 0) > 0 || val.xDesconto) err("F62", 500, "Informado vDesconto/xDesconto sem tpDesconto.", "valores.tpDesconto");
      if (val.vBP === 0) err("F65", 501, "Sem tpDesconto, o valor do BP-e deve ser maior que zero.", "valores.vBP");
    }
    if (val.vPgto !== undefined) {
      const esperado = r2(val.vBP - (val.vDesconto ?? 0));
      if (Math.abs(r2(val.vPgto) - esperado) > 0.009) err("F68", 403, `vPgto (${val.vPgto.toFixed(2)}) deve ser vBP - vDesconto (${esperado.toFixed(2)}).`, "valores.vPgto");
    }
    if (p.pagamentos?.length && val.vPgto !== undefined) {
      chk("F67");
      const soma = r2(p.pagamentos.reduce((a, x) => a + x.vPag, 0));
      const alvo = r2(val.vPgto + (val.vTroco ?? 0));
      if (Math.abs(soma - alvo) > 1.0) err("F67", 438, `Somatório dos pagamentos (${soma.toFixed(2)}) difere de vPgto + vTroco (${alvo.toFixed(2)}).`, "pagamentos");
    }
  }
  if (p.icms) {
    chk("F58", "F66");
    const { vBC = 0, pICMS = 0, vICMS = 0 } = p.icms;
    if (Math.abs(Math.round(vBC * pICMS) / 100 - vICMS) > 0.01) err("F58", 435, `vICMS (${vICMS}) não corresponde a vBC x pICMS (${(Math.round(vBC * pICMS) / 100).toFixed(2)}).`, "icms.vICMS");
    if (val && vICMS > val.vBP) err("F66", 499, "Valor do ICMS superior ao valor do bilhete.", "icms.vICMS");
  }
  (p.pagamentos ?? []).forEach((pg, i) => {
    chk("F69", "F71");
    if ((pg.tPag === "03" || pg.tPag === "04") && !pg.card) err("F69", 475, `Pagamento ${i + 1}: cartão (tPag ${pg.tPag}) exige o grupo card.`, `pagamentos[${i}].card`);
    if (pg.card?.CNPJ && !validarCNPJ(pg.card.CNPJ)) err("F71", 502, `Pagamento ${i + 1}: CNPJ da credenciadora inválido.`, `pagamentos[${i}].card.CNPJ`);
    if (pg.card?.tpIntegra === 1 && (!pg.card.CNPJ || !pg.card.cAut)) avisos.push({ regra: "F72", cStat: 478, mensagem: `Pagamento ${i + 1}: pagamento integrado (tpIntegra=1) deve informar card/CNPJ e card/cAut (facultativa por UF).`, campo: `pagamentos[${i}].card` });
  });

  // ---------------- Substituição
  const tpBPe = p.tpBPe ?? 0;
  chk("F73", "F74");
  if (tpBPe === 3 && !p.substituicao) err("F73", 439, "BP-e de substituição (tpBPe=3) exige o grupo infBPeSub.", "substituicao");
  if (tpBPe === 0 && p.substituicao) err("F74", 440, "BP-e normal (tpBPe=0) não deve informar infBPeSub.", "substituicao");
  if (tpBPe === 3 && p.substituicao) {
    chk("F75", "F90");
    const v = validarChave(p.substituicao.chBPe, agora);
    if (!v.valida) err("F75", 508, `Chave do BP-e substituído inválida [Motivo: ${v.motivos.join("; ")}].`, "substituicao.chBPe");
    if (p.substituicao.tpSub === 2 && !p.passageiro?.xNome) err("F90", 491, "Substituição por transferência exige identificação do passageiro.", "passageiro");
  }

  // ---------------- autXML
  if (p.autXML?.length) {
    chk("F102", "F103", "F104");
    const vistos = new Set<string>();
    p.autXML.forEach((a, i) => {
      if (a.CNPJ && !validarCNPJ(a.CNPJ)) err("F102", 466, `autXML[${i}]: CNPJ inválido.`, `autXML[${i}].CNPJ`);
      if (a.CPF && !validarCPF(a.CPF)) err("F103", 467, `autXML[${i}]: CPF inválido.`, `autXML[${i}].CPF`);
      const doc = somenteDigitos(a.CNPJ ?? a.CPF);
      if (vistos.has(doc)) err("F104", 412, `autXML: documento ${doc} duplicado.`, `autXML[${i}]`);
      vistos.add(doc);
    });
  }

  // ---------------- QR Code
  if (p.qrCode) {
    chk("F106", "F107", "F108");
    const url = new URL(p.qrCode.replace(/\+/g, "%2B"));
    const ch = url.searchParams.get("chBPe");
    if (p.chBPe && ch !== p.chBPe) err("F106", 481, "Parâmetro chBPe do QR Code diverge da chave do BP-e.", "qrCode");
    const temSign = url.searchParams.has("sign");
    if (p.tpEmis === 2 && !temSign) err("F107", 482, "Contingência off-line: QR Code deve conter o parâmetro sign.", "qrCode");
    if (p.tpEmis === 1 && temSign) err("F108", 488, "Emissão normal: QR Code não deve conter o parâmetro sign.", "qrCode");
  }

  if (p.respTec?.CNPJ) { chk("F111"); if (!validarCNPJ(p.respTec.CNPJ)) avisos.push({ regra: "F111", cStat: 510, mensagem: "CNPJ do responsável técnico inválido (facultativa por UF).", campo: "respTec.CNPJ" }); }

  return {
    valido: erros.length === 0,
    erros,
    avisos,
    regrasVerificadas: [...verificadas].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))),
    regrasNaoVerificaveisLocalmente: NAO_LOCAIS,
  };
}
