import { describe, expect, it } from "vitest";
import { BloqueioUsoIndevidoError, RateLimiter } from "../src/client/rateLimiter.js";

function relogio(inicio = 1_000_000) {
  let t = inicio;
  return { agora: () => t, avancar: (ms: number) => (t += ms) };
}

describe("rateLimiter — proteção contra Rejeição 678", () => {
  it("status: exige 3 minutos entre consultas", () => {
    const r = relogio();
    const rl = new RateLimiter({}, r.agora);
    expect(rl.verificar("bpeStatusServicoBP").permitido).toBe(true);
    rl.registrarEnvio("bpeStatusServicoBP");
    const d = rl.verificar("bpeStatusServicoBP");
    expect(d).toMatchObject({ permitido: false, regra: "STATUS_3MIN" });
    expect(d.aguardarMs).toBe(180_000);
    r.avancar(179_999);
    expect(rl.verificar("bpeStatusServicoBP").permitido).toBe(false);
    r.avancar(1);
    expect(rl.verificar("bpeStatusServicoBP").permitido).toBe(true);
  });

  it("CI03: no máximo 10 consultas por chave por hora", () => {
    const r = relogio();
    const rl = new RateLimiter({}, r.agora);
    const ch = "4".repeat(44);
    for (let i = 0; i < 10; i++) {
      expect(rl.verificar("bpeConsultaBP", { documento: ch }).permitido).toBe(true);
      rl.registrarEnvio("bpeConsultaBP", { documento: ch });
      r.avancar(1000);
    }
    expect(rl.verificar("bpeConsultaBP", { documento: ch })).toMatchObject({ permitido: false, regra: "CI03" });
    expect(rl.verificar("bpeConsultaBP", { documento: "5".repeat(44) }).permitido).toBe(true);
    r.avancar(60 * 60_000);
    expect(rl.verificar("bpeConsultaBP", { documento: ch }).permitido).toBe(true);
  });

  it("CI01: bloqueia após 30 rejeições iguais na autorização e libera após sucesso", () => {
    const rl = new RateLimiter({}, relogio().agora);
    for (let i = 0; i < 29; i++) rl.registrarResultado("bpeRecepcao", "CHAVE", 215, false);
    expect(rl.verificar("bpeRecepcao", { documento: "CHAVE" }).permitido).toBe(true);
    rl.registrarResultado("bpeRecepcao", "CHAVE", 215, false);
    expect(rl.verificar("bpeRecepcao", { documento: "CHAVE" })).toMatchObject({ permitido: false, regra: "CI01" });
    expect(() => rl.exigir("bpeRecepcao", { documento: "CHAVE" })).toThrow(BloqueioUsoIndevidoError);
    rl.registrarResultado("bpeRecepcao", "CHAVE", 100, true);
    expect(rl.verificar("bpeRecepcao", { documento: "CHAVE" }).permitido).toBe(true);
  });

  it("CI01: rejeições diferentes não somam", () => {
    const rl = new RateLimiter({}, relogio().agora);
    for (let i = 0; i < 20; i++) rl.registrarResultado("bpeRecepcao", "X", 215, false);
    for (let i = 0; i < 20; i++) rl.registrarResultado("bpeRecepcao", "X", 539, false);
    expect(rl.verificar("bpeRecepcao", { documento: "X" }).permitido).toBe(true);
  });

  it("CI04: bloqueia após 20 rejeições iguais em eventos", () => {
    const rl = new RateLimiter({}, relogio().agora);
    for (let i = 0; i < 20; i++) rl.registrarResultado("bpeRecepcaoEvento", "EV", 220, false);
    expect(rl.verificar("bpeRecepcaoEvento", { documento: "EV" })).toMatchObject({ permitido: false, regra: "CI04" });
  });

  it("CI05: bloqueia mais de 60 envios repetidos em 5 minutos", () => {
    const r = relogio();
    const rl = new RateLimiter({}, r.agora);
    for (let i = 0; i < 60; i++) {
      rl.registrarEnvio("consultaCadastro", { assinatura: "abc" });
      r.avancar(1000);
    }
    expect(rl.verificar("consultaCadastro", { assinatura: "abc" })).toMatchObject({ permitido: false, regra: "CI05" });
    r.avancar(5 * 60_000);
    expect(rl.verificar("consultaCadastro", { assinatura: "abc" }).permitido).toBe(true);
  });

  it("após 678 do autorizador, suspende o serviço por 1 hora", () => {
    const r = relogio();
    const rl = new RateLimiter({}, r.agora);
    rl.registrarRejeicao678("bpeRecepcao");
    expect(rl.verificar("bpeRecepcao", { documento: "QUALQUER" })).toMatchObject({ permitido: false, regra: "REJ678" });
    expect(rl.verificar("bpeConsultaBP", { documento: "Q" }).permitido).toBe(true);
    r.avancar(60 * 60_000);
    expect(rl.verificar("bpeRecepcao", { documento: "QUALQUER" }).permitido).toBe(true);
  });
});
