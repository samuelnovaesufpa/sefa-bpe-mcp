import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { carregarConfig } from "../src/config/index.js";
import { criarServidor } from "../src/server.js";

async function conectar() {
  const cfg = carregarConfig({ BPE_TP_AMB: "2", BPE_UF: "RS", BPE_MODO: "mock" } as NodeJS.ProcessEnv);
  const { server } = criarServidor(cfg);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "teste", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const texto = (r: any) => JSON.parse(r.content[0].text);

describe("servidor MCP (integração em memória, modo mock)", () => {
  it("expõe as tools esperadas", async () => {
    const c = await conectar();
    const nomes = (await c.listTools()).tools.map((t) => t.name);
    expect(nomes).toEqual(expect.arrayContaining([
      "bpe_gerar_chave_acesso", "bpe_gerar_qrcode", "bpe_diagnosticar_rejeicao", "bpe_validar_regras_negocio",
      "bpe_consultar_status", "bpe_consultar_situacao", "bpe_autorizar", "bpe_registrar_evento", "bpe_consultar_cadastro",
    ]));
  });

  it("expõe todos os JSON de data/ como resources bpe://data/...", async () => {
    const c = await conectar();
    const uris = (await c.listResources()).resources.map((r) => r.uri);
    expect(uris).toEqual(expect.arrayContaining([
      "bpe://data/codigos_status.json", "bpe://data/codigos_consulta_publica.json", "bpe://data/tipos_evento.json",
      "bpe://data/contingencia_offline.json", "bpe://data/endpoints_uf.json",
      "bpe://data/regras_validacao/certificado_xml.json", "bpe://data/regras_validacao/negocio_bpe.json",
      "bpe://data/regras_validacao/eventos.json", "bpe://data/regras_validacao/uso_indevido.json",
    ]));
    const r = await c.readResource({ uri: "bpe://data/tipos_evento.json" });
    expect(JSON.parse((r.contents[0] as any).text).eventos.map((e: any) => e.tpEvento)).toEqual(["110111", "110115", "110116", "240140"]);
  });

  it("bpe_diagnosticar_rejeicao via MCP", async () => {
    const c = await conectar();
    const d = texto(await c.callTool({ name: "bpe_diagnosticar_rejeicao", arguments: { cStat: 539 } }));
    expect(d.regrasVioladas[0].id).toBe("F98");
  });

  it("bpe_gerar_chave_acesso + bpe_consultar_situacao (mock) + limite de status", async () => {
    const c = await conectar();
    const k = texto(await c.callTool({ name: "bpe_gerar_chave_acesso", arguments: { uf: "RS", aamm: "2511", cnpj: "11222333000181", serie: 1, nBP: 7, cBP: "11112222" } }));
    expect(k.chave).toHaveLength(44);
    const s = texto(await c.callTool({ name: "bpe_consultar_situacao", arguments: { chBPe: k.chave } }));
    expect(s).toMatchObject({ modo: "mock", cStat: 100, sucesso: true });
    expect(s.envelopeSoap).toContain("BPeConsulta");

    const st1 = texto(await c.callTool({ name: "bpe_consultar_status", arguments: {} }));
    expect(st1.cStat).toBe(107);
    const st2 = await c.callTool({ name: "bpe_consultar_status", arguments: {} });
    expect(st2.isError).toBe(true);
    expect(texto(st2).bloqueio.regra).toBe("STATUS_3MIN");
  });

  it("bpe_registrar_evento (mock) monta Id e devolve 135", async () => {
    const c = await conectar();
    const k = texto(await c.callTool({ name: "bpe_gerar_chave_acesso", arguments: { uf: "RS", aamm: "2511", cnpj: "11222333000181", serie: 1, nBP: 8, cBP: "11112222" } }));
    const r = texto(await c.callTool({ name: "bpe_registrar_evento", arguments: { tpEvento: "110111", chBPe: k.chave, nProt: "343250000000001", xJust: "Desistencia do passageiro antes do embarque" } }));
    expect(r.cStat).toBe(135);
    expect(r.xmlEnviado).toContain(`Id="ID110111${k.chave}01"`);
  });

  it("bpe_autorizar (mock): XML fora do padrão é barrado localmente; XML correto é 'autorizado' em dry-run", async () => {
    const c = await conectar();
    const k = texto(await c.callTool({ name: "bpe_gerar_chave_acesso", arguments: { uf: "RS", aamm: "2511", cnpj: "11222333000181", serie: 1, nBP: 9, cBP: "11112222" } }));
    const ruim = texto(await c.callTool({ name: "bpe_autorizar", arguments: { xml: `<BPe xmlns="http://www.portalfiscal.inf.br/bpe" xmlns:x="http://outro"><infBPe Id="${k.id}" versao="1.00"><x:a>1</x:a></infBPe></BPe>` } }));
    expect(ruim.sucesso).toBe(false);
    expect(ruim.avisos.join(" ")).toMatch(/404|598/);
    const bom = texto(await c.callTool({ name: "bpe_autorizar", arguments: { xml: `<BPe xmlns="http://www.portalfiscal.inf.br/bpe">\n  <infBPe Id="${k.id}" versao="1.00"><ide><tpAmb>2</tpAmb></ide></infBPe>\n</BPe>` } }));
    expect(bom).toMatchObject({ modo: "mock", cStat: 100, sucesso: true });
    expect(bom.envelopeSoap).toMatch(/<bpeDadosMsg xmlns="http:\/\/www.portalfiscal.inf.br\/bpe\/wsdl\/BPeRecepcao">H4sI/); // GZip em Base64
  });
});
