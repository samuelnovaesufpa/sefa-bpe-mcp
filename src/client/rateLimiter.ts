/**
 * Proteção local contra a Rejeição 678 (Uso Indevido) — MOC BP-e v1.00b, seção 9.
 *
 * Bloqueia preventivamente ANTES de atingir os limites do autorizador:
 *  - Consulta Status: intervalo mínimo de 3 minutos entre consultas (4.2.3 / 4.3.3)
 *  - CI01: > 30 rejeições iguais do mesmo BP-e na autorização (janela de 1h)
 *  - CI03: > 10 consultas da mesma chave em 1 hora
 *  - CI04: > 20 rejeições iguais do mesmo evento (janela de 1h)
 *  - CI05: > 60 envios repetidos em 5 minutos em qualquer serviço
 */

export type ServicoBPe = "bpeRecepcao" | "bpeConsultaBP" | "bpeStatusServicoBP" | "bpeRecepcaoEvento" | "consultaCadastro";

export interface LimitesUsoIndevido {
  statusIntervaloMinimoMs: number;
  autorizacaoMaxRejeicoesIguais: number;
  consultaMaxPorChavePorHora: number;
  eventosMaxRejeicoesIguais: number;
  enviosRepetidosMax5min: number;
  janelaRejeicoesMs: number;
  janelaConsultaMs: number;
  janelaRepeticaoMs: number;
}

export const LIMITES_PADRAO: LimitesUsoIndevido = {
  statusIntervaloMinimoMs: 3 * 60_000,
  autorizacaoMaxRejeicoesIguais: 30,
  consultaMaxPorChavePorHora: 10,
  eventosMaxRejeicoesIguais: 20,
  enviosRepetidosMax5min: 60,
  janelaRejeicoesMs: 60 * 60_000,
  janelaConsultaMs: 60 * 60_000,
  janelaRepeticaoMs: 5 * 60_000,
};

export interface DecisaoLimite {
  permitido: boolean;
  regra?: "STATUS_3MIN" | "CI01" | "CI03" | "CI04" | "CI05" | "REJ678";
  motivo?: string;
  /** Milissegundos até a liberação. */
  aguardarMs?: number;
}

export class BloqueioUsoIndevidoError extends Error {
  constructor(public readonly decisao: DecisaoLimite) {
    super(`Bloqueio preventivo local (evita Rejeição 678 – ${decisao.regra}): ${decisao.motivo}`);
    this.name = "BloqueioUsoIndevidoError";
  }
}

export class RateLimiter {
  private readonly limites: LimitesUsoIndevido;
  private ultimaConsultaStatus = new Map<string, number>();
  private consultasPorChave = new Map<string, number[]>();
  private rejeicoes = new Map<string, number[]>(); // chave: servico|documento|cStat
  private envios = new Map<string, number[]>(); // chave: servico|hashRequisicao
  private bloqueios678 = new Map<ServicoBPe, number>(); // servico -> timestamp de liberação

  constructor(limites: Partial<LimitesUsoIndevido> = {}, private readonly agora: () => number = Date.now) {
    this.limites = { ...LIMITES_PADRAO, ...limites };
  }

  private recentes(lista: number[] | undefined, janela: number): number[] {
    const t = this.agora();
    return (lista ?? []).filter((x) => t - x < janela);
  }

  /** Verifica (sem registrar) se uma requisição pode ser enviada. */
  verificar(servico: ServicoBPe, opts: { documento?: string; assinatura?: string; escopo?: string } = {}): DecisaoLimite {
    const t = this.agora();
    const L = this.limites;

    const ate = this.bloqueios678.get(servico);
    if (ate !== undefined && t < ate) {
      return { permitido: false, regra: "REJ678", aguardarMs: ate - t, motivo: "O autorizador retornou 678 (Uso Indevido) para este serviço. Envios suspensos localmente por 1 hora." };
    }

    if (servico === "bpeStatusServicoBP") {
      const ult = this.ultimaConsultaStatus.get(opts.escopo ?? "default");
      if (ult !== undefined && t - ult < L.statusIntervaloMinimoMs) {
        const aguardarMs = L.statusIntervaloMinimoMs - (t - ult);
        return { permitido: false, regra: "STATUS_3MIN", aguardarMs, motivo: `Intervalo mínimo de 3 minutos entre consultas de status. Aguarde ${Math.ceil(aguardarMs / 1000)}s.` };
      }
    }

    if (servico === "bpeConsultaBP" && opts.documento) {
      const lista = this.recentes(this.consultasPorChave.get(opts.documento), L.janelaConsultaMs);
      if (lista.length >= L.consultaMaxPorChavePorHora) {
        const aguardarMs = L.janelaConsultaMs - (t - lista[0]!);
        return { permitido: false, regra: "CI03", aguardarMs, motivo: `Chave consultada ${lista.length} vezes na última hora (limite do autorizador: mais de ${L.consultaMaxPorChavePorHora}).` };
      }
    }

    if ((servico === "bpeRecepcao" || servico === "bpeRecepcaoEvento") && opts.documento) {
      const max = servico === "bpeRecepcao" ? L.autorizacaoMaxRejeicoesIguais : L.eventosMaxRejeicoesIguais;
      const prefixo = `${servico}|${opts.documento}|`;
      for (const [k, v] of this.rejeicoes) {
        if (!k.startsWith(prefixo)) continue;
        const lista = this.recentes(v, L.janelaRejeicoesMs);
        if (lista.length >= max) {
          const cStat = k.slice(prefixo.length);
          return {
            permitido: false,
            regra: servico === "bpeRecepcao" ? "CI01" : "CI04",
            aguardarMs: L.janelaRejeicoesMs - (t - lista[0]!),
            motivo: `${lista.length} rejeições iguais (cStat ${cStat}) para o mesmo documento na última hora. Corrija a causa antes de reenviar.`,
          };
        }
      }
    }

    if (opts.assinatura) {
      const lista = this.recentes(this.envios.get(`${servico}|${opts.assinatura}`), L.janelaRepeticaoMs);
      if (lista.length >= L.enviosRepetidosMax5min) {
        return { permitido: false, regra: "CI05", aguardarMs: L.janelaRepeticaoMs - (t - lista[0]!), motivo: `${lista.length} envios repetidos em 5 minutos (limite do autorizador: mais de ${L.enviosRepetidosMax5min}).` };
      }
    }
    return { permitido: true };
  }

  /** Verifica e lança BloqueioUsoIndevidoError se bloqueado. */
  exigir(servico: ServicoBPe, opts: { documento?: string; assinatura?: string; escopo?: string } = {}): void {
    const d = this.verificar(servico, opts);
    if (!d.permitido) throw new BloqueioUsoIndevidoError(d);
  }

  /** Registra que uma requisição foi enviada. */
  registrarEnvio(servico: ServicoBPe, opts: { documento?: string; assinatura?: string; escopo?: string } = {}): void {
    const t = this.agora();
    if (servico === "bpeStatusServicoBP") this.ultimaConsultaStatus.set(opts.escopo ?? "default", t);
    if (servico === "bpeConsultaBP" && opts.documento) {
      const l = this.recentes(this.consultasPorChave.get(opts.documento), this.limites.janelaConsultaMs);
      l.push(t);
      this.consultasPorChave.set(opts.documento, l);
    }
    if (opts.assinatura) {
      const k = `${servico}|${opts.assinatura}`;
      const l = this.recentes(this.envios.get(k), this.limites.janelaRepeticaoMs);
      l.push(t);
      this.envios.set(k, l);
    }
  }

  /** Registra o resultado de um envio (rejeições alimentam CI01/CI04; sucesso limpa o histórico do documento). */
  registrarResultado(servico: ServicoBPe, documento: string, cStat: number, sucesso: boolean): void {
    const prefixo = `${servico}|${documento}|`;
    if (sucesso) {
      for (const k of [...this.rejeicoes.keys()]) if (k.startsWith(prefixo)) this.rejeicoes.delete(k);
      return;
    }
    const k = prefixo + cStat;
    const l = this.recentes(this.rejeicoes.get(k), this.limites.janelaRejeicoesMs);
    l.push(this.agora());
    this.rejeicoes.set(k, l);
  }

  /** Recebeu 678 do autorizador: suspende todos os envios do serviço por 1h (seção 9.2). */
  registrarRejeicao678(servico: ServicoBPe): void {
    this.bloqueios678.set(servico, this.agora() + 60 * 60_000);
  }

  snapshot() {
    const t = this.agora();
    return {
      limites: this.limites,
      ultimaConsultaStatus: Object.fromEntries([...this.ultimaConsultaStatus].map(([k, v]) => [k, new Date(v).toISOString()])),
      consultasPorChave: Object.fromEntries([...this.consultasPorChave].map(([k, v]) => [k, this.recentes(v, this.limites.janelaConsultaMs).length])),
      bloqueios678: Object.fromEntries([...this.bloqueios678].filter(([, v]) => v > t).map(([k, v]) => [k, new Date(v).toISOString()])),
      rejeicoes: Object.fromEntries([...this.rejeicoes].map(([k, v]) => [k, this.recentes(v, this.limites.janelaRejeicoesMs).length])),
      geradoEm: new Date(t).toISOString(),
    };
  }
}
