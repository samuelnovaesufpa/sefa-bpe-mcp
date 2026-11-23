/** Registro das MCP Tools do BP-e. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BpeService } from "../client/bpeService.js";
import { BloqueioUsoIndevidoError } from "../client/rateLimiter.js";
import { aammDeData, montarChave, validarChave } from "../services/chaveAcesso.js";
import { diagnosticarRejeicao } from "../services/diagnostico.js";
import { gerarSvgQrCode, montarUrlQrCode } from "../services/qrCode.js";
import { codigoDaUf } from "../services/ufs.js";
import { validarRegrasNegocio, type PayloadBPe } from "../services/validadorLocal.js";

type Conteudo = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(obj: unknown): Conteudo {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

function falha(e: unknown): Conteudo {
  if (e instanceof BloqueioUsoIndevidoError) {
    return { isError: true, content: [{ type: "text", text: JSON.stringify({ erro: e.message, bloqueio: e.decisao }, null, 2) }] };
  }
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ erro: (e as Error).message }, null, 2) }] };
}

async function seguro(fn: () => unknown | Promise<unknown>): Promise<Conteudo> {
  try {
    return ok(await fn());
  } catch (e) {
    return falha(e);
  }
}

const chave44 = z.string().regex(/^\d{44}$/, "A chave de acesso deve ter 44 dígitos numéricos");
const dataHoraTz = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/, "Formato AAAA-MM-DDTHH:MM:SS±HH:MM");
const uf = z.string().length(2).transform((s) => s.toUpperCase());

export const schemaPayloadBPe = {
  tpAmb: z.union([z.literal(1), z.literal(2)]).optional(),
  cUF: z.string().regex(/^\d{2}$/).optional(),
  tpEmis: z.union([z.literal(1), z.literal(2)]).describe("1=Normal, 2=Contingência Off-line"),
  tpBPe: z.union([z.literal(0), z.literal(3)]).optional().describe("0=Normal, 3=Substituição"),
  modal: z.union([z.literal(1), z.literal(3), z.literal(4)]).optional().describe("1=Rodoviário, 3=Aquaviário, 4=Ferroviário"),
  serie: z.union([z.string(), z.number()]).optional(),
  nBP: z.union([z.string(), z.number()]).optional(),
  cBP: z.string().regex(/^\d{8}$/).optional(),
  chBPe: chave44.optional(),
  dhEmi: z.string().describe("Data/hora de emissão AAAA-MM-DDTHH:MM:SS±HH:MM"),
  dhCont: z.string().optional(),
  xJust: z.string().optional(),
  UFIni: z.string().optional(),
  cMunIni: z.string().optional(),
  UFFim: z.string().optional(),
  cMunFim: z.string().optional(),
  emitente: z.object({ CNPJ: z.string().optional(), IE: z.string().optional(), UF: z.string().optional(), cMun: z.string().optional(), TAR: z.string().optional() }).optional(),
  comprador: z.object({ CNPJ: z.string().optional(), CPF: z.string().optional(), IE: z.string().optional(), UF: z.string().optional(), cMun: z.string().optional() }).optional(),
  agencia: z.object({ CNPJ: z.string().optional(), UF: z.string().optional(), cMun: z.string().optional() }).optional(),
  passageiro: z.object({ xNome: z.string().optional(), CPF: z.string().optional(), nDoc: z.string().optional() }).optional(),
  viagens: z
    .array(z.object({ tpTrecho: z.union([z.literal(1), z.literal(2), z.literal(3)]), dhViagem: z.string().optional(), dhConexao: z.string().optional(), tpServ: z.number().int().optional() }))
    .optional(),
  infTravessia: z.boolean().optional().describe("true se o grupo infTravessia foi preenchido"),
  dhEmb: z.string().optional().describe("Data/hora do embarque"),
  dhValidade: z.string().optional(),
  valores: z
    .object({
      vBP: z.number(),
      vDesconto: z.number().optional(),
      tpDesconto: z.string().optional(),
      xDesconto: z.string().optional(),
      cDesconto: z.string().optional(),
      vPgto: z.number().optional(),
      vTroco: z.number().optional(),
      componentes: z.array(z.object({ tpComp: z.string().optional(), vComp: z.number() })).optional(),
    })
    .optional(),
  icms: z.object({ vBC: z.number().optional(), pICMS: z.number().optional(), vICMS: z.number().optional() }).optional(),
  pagamentos: z
    .array(z.object({ tPag: z.string(), vPag: z.number(), card: z.object({ tpIntegra: z.union([z.literal(1), z.literal(2)]).optional(), CNPJ: z.string().optional(), cAut: z.string().optional() }).optional() }))
    .optional(),
  substituicao: z.object({ chBPe: z.string(), tpSub: z.union([z.literal(1), z.literal(2), z.literal(3)]) }).optional(),
  autXML: z.array(z.object({ CNPJ: z.string().optional(), CPF: z.string().optional() })).optional(),
  qrCode: z.string().optional(),
  respTec: z.object({ CNPJ: z.string().optional() }).optional(),
};

export function registrarTools(server: McpServer, svc: BpeService): void {
  server.registerTool(
    "bpe_gerar_chave_acesso",
    {
      title: "Gerar/validar chave de acesso do BP-e",
      description:
        "Monta a chave de acesso de 44 dígitos (cUF + AAMM + CNPJ + 63 + série + nBP + tpEmis + cBP + DV) com DV em Módulo 11, ou valida uma chave existente (motivos da rejeição 236).",
      inputSchema: {
        validar: chave44.optional().describe("Se informado, apenas valida esta chave e ignora os demais campos"),
        uf: uf.optional().describe("Sigla da UF do emitente (alternativa a cUF)"),
        cUF: z.string().regex(/^\d{2}$/).optional(),
        dhEmi: z.string().optional().describe("Data de emissão (ISO) para extrair AAMM"),
        aamm: z.string().regex(/^\d{4}$/).optional().describe("Ano/mês AAMM (alternativa a dhEmi)"),
        cnpj: z.string().optional(),
        serie: z.union([z.string(), z.number()]).optional(),
        nBP: z.union([z.string(), z.number()]).optional(),
        tpEmis: z.union([z.literal(1), z.literal(2)]).optional().default(1),
        cBP: z.string().regex(/^\d{1,8}$/).optional().describe("Código numérico (8 dígitos). Se omitido, é gerado aleatoriamente. Em contingência mantenha o mesmo cBP."),
      },
    },
    async (a) =>
      seguro(() => {
        if (a.validar) return validarChave(a.validar);
        const cUF = a.cUF ?? (a.uf ? codigoDaUf(a.uf) : svc.cfg.cUF);
        const aamm = a.aamm ?? aammDeData(a.dhEmi ?? new Date().toISOString());
        const cnpj = a.cnpj ?? svc.cfg.cnpjEmitente;
        if (!cnpj || a.serie === undefined || a.nBP === undefined) throw new Error("Informe cnpj (ou BPE_CNPJ_EMITENTE), serie e nBP.");
        const r = montarChave({ cUF: cUF!, aamm, cnpj, serie: a.serie, nBP: a.nBP, tpEmis: a.tpEmis, cBP: a.cBP });
        return { ...r, validacao: validarChave(r.chave) };
      }),
  );

  server.registerTool(
    "bpe_gerar_qrcode",
    {
      title: "Gerar URL do QR Code do DABPE",
      description:
        "Monta a URL oficial do QR Code (ISO/IEC 18004, nível M, UTF-8). Normal: chBPe + tpAmb. Contingência off-line (tpEmis=2 na chave): inclui sign = RSA-SHA1 Base64 da chave, usando o certificado configurado ou o 'sign' informado.",
      inputSchema: {
        chBPe: chave44,
        tpAmb: z.union([z.literal(1), z.literal(2)]).optional(),
        urlBase: z.string().url().optional().describe("URL de consulta QR Code da UF. Padrão: data/endpoints_uf.json ou BPE_URL_QRCODE"),
        uf: uf.optional(),
        sign: z.string().optional().describe("Assinatura já calculada (Base64), para contingência"),
        chavePrivadaPem: z.string().optional().describe("Chave privada PEM (se não houver certificado no .env)"),
        gerarSvg: z.boolean().optional().default(false).describe("Também devolver a imagem SVG"),
      },
    },
    async (a) =>
      seguro(async () => {
        const tpAmb = a.tpAmb ?? svc.cfg.tpAmb;
        const urlBase = a.urlBase ?? svc.urlQrCode(a.uf, tpAmb);
        if (!urlBase) throw new Error("URL do QR Code não configurada para a UF.");
        let chavePrivadaPem = a.chavePrivadaPem;
        if (!chavePrivadaPem && !a.sign && a.chBPe[34] === "2") {
          try {
            chavePrivadaPem = svc.certificado()?.chavePrivadaPem;
          } catch {
            /* sem certificado */
          }
        }
        const r = montarUrlQrCode({ urlBase, chBPe: a.chBPe, tpAmb, sign: a.sign, chavePrivadaPem });
        return { ...r, tagXml: "infBPeSupl/qrCodBPe", svg: a.gerarSvg ? await gerarSvgQrCode(r.url) : undefined };
      }),
  );

  server.registerTool(
    "bpe_diagnosticar_rejeicao",
    {
      title: "Diagnosticar rejeição (cStat)",
      description: "Recebe um cStat (ex.: 215, 539, 678) e retorna mensagem oficial, causa, regras violadas (grupos A–J/CI do MOC) e ação corretiva.",
      inputSchema: {
        cStat: z.union([z.number().int(), z.string().regex(/^\d{3}$/)]),
        xMotivo: z.string().optional().describe("xMotivo retornado (extrai complementos como [chBPe], [nProt], [Motivo])"),
        tpEvento: z.enum(["110111", "110115", "110116"]).optional().describe("Filtra as regras do Grupo J pelo evento"),
      },
    },
    async (a) =>
      seguro(() => {
        const d = diagnosticarRejeicao(a.cStat, a.xMotivo, { tpEvento: a.tpEvento });
        return Number(a.cStat) === 678 ? { ...d, estadoLimitadorLocal: svc.limiter.snapshot() } : d;
      }),
  );

  server.registerTool(
    "bpe_validar_regras_negocio",
    {
      title: "Pré-validar regras de negócio do BP-e",
      description:
        "Executa localmente as regras do Grupo F do MOC (datas de emissão/embarque/validade, contingência, chave, viagem/conexões, emitente, comprador, componentes de valor, descontos, pagamentos, substituição, autXML e QR Code) antes do envio.",
      inputSchema: schemaPayloadBPe,
    },
    async (a) => seguro(() => validarRegrasNegocio(a as PayloadBPe)),
  );

  server.registerTool(
    "bpe_consultar_status",
    {
      title: "Consultar status do serviço (bpeStatusServicoBP)",
      description: "Consulta o status do autorizador (107 em operação, 108/109 paralisado). Respeita intervalo mínimo de 3 minutos. Em modo mock retorna resposta simulada e o XML que seria enviado.",
      inputSchema: { uf: uf.optional() },
    },
    async (a) => seguro(() => svc.consultarStatus(a.uf)),
  );

  server.registerTool(
    "bpe_consultar_situacao",
    {
      title: "Consultar situação do BP-e (bpeConsultaBP)",
      description: "Consulta a situação de um BP-e pela chave de 44 dígitos. Bloqueia localmente acima de 10 consultas/hora da mesma chave (CI03).",
      inputSchema: { chBPe: chave44 },
    },
    async (a) => seguro(() => svc.consultarSituacao(a.chBPe)),
  );

  server.registerTool(
    "bpe_autorizar",
    {
      title: "Autorizar BP-e (bpeRecepcao)",
      description:
        "Envia um BP-e para autorização: minifica, verifica forma do XML (namespace, prefixos, espaços, UTF-8, 1024 KB), assina (se houver certificado), compacta em GZip+Base64 e envia. Um BP-e por requisição. Bloqueia após 30 rejeições iguais (CI01).",
      inputSchema: {
        xml: z.string().min(1).describe("XML do BP-e (<BPe xmlns=\"http://www.portalfiscal.inf.br/bpe\"><infBPe Id=\"BPe...\">...)"),
        assinar: z.boolean().optional().default(true),
      },
    },
    async (a) => seguro(() => svc.autorizar(a.xml, { assinar: a.assinar })),
  );

  server.registerTool(
    "bpe_registrar_evento",
    {
      title: "Registrar evento (bpeRecepcaoEvento)",
      description: "Registra Cancelamento (110111), Não Embarque (110115) ou Alteração de Poltrona (110116). Monta Id = ID+tpEvento+chBPe+nSeqEvento, assina infEvento e envia XML puro.",
      inputSchema: {
        tpEvento: z.enum(["110111", "110115", "110116"]),
        chBPe: chave44,
        nProt: z.string().regex(/^\d{15}$/).describe("Protocolo de autorização do BP-e"),
        nSeqEvento: z.number().int().min(1).max(99).optional().default(1),
        xJust: z.string().min(1).max(255).optional().describe("Obrigatório para 110111 e 110115"),
        poltrona: z.union([z.number().int(), z.string().regex(/^\d{1,3}$/)]).optional().describe("Obrigatório para 110116"),
        cnpj: z.string().regex(/^\d{14}$/).optional().describe("CNPJ do autor (padrão: BPE_CNPJ_EMITENTE ou CNPJ da chave)"),
        dhEvento: dataHoraTz.optional(),
      },
    },
    async (a) => seguro(() => svc.registrarEvento(a)),
  );

  server.registerTool(
    "bpe_consultar_cadastro",
    {
      title: "Consultar cadastro de contribuinte (consultaCadastro)",
      description: "Consulta o cadastro de contribuintes do ICMS da UF (Web Service da NF-e). Não use no fluxo normal de emissão.",
      inputSchema: {
        uf,
        CNPJ: z.string().regex(/^\d{14}$/).optional(),
        CPF: z.string().regex(/^\d{11}$/).optional(),
        IE: z.string().optional(),
        url: z.string().url().optional().describe("URL do CadConsultaCadastro4 da UF"),
      },
    },
    async (a) => seguro(() => svc.consultarCadastro(a.uf, { CNPJ: a.CNPJ, CPF: a.CPF, IE: a.IE }, a.url)),
  );

  server.registerTool(
    "bpe_info_ambiente",
    {
      title: "Informações do ambiente MCP",
      description: "Mostra modo (mock/real), ambiente, UF, URLs resolvidas, situação do certificado e estado do limitador anti-678.",
      inputSchema: {},
    },
    async () =>
      seguro(() => {
        let cert: unknown = null;
        try {
          const c = svc.certificado();
          cert = c ? { titular: c.titular, cnpj: c.cnpj, validoDe: c.validoDe, validoAte: c.validoAte } : null;
        } catch (e) {
          cert = { erro: (e as Error).message };
        }
        return {
          modo: svc.modo,
          tpAmb: svc.cfg.tpAmb,
          uf: svc.cfg.uf,
          cUF: svc.cfg.cUF,
          urls: {
            bpeRecepcao: svc.url("bpeRecepcao"),
            bpeConsultaBP: svc.url("bpeConsultaBP"),
            bpeStatusServicoBP: svc.url("bpeStatusServicoBP"),
            bpeRecepcaoEvento: svc.url("bpeRecepcaoEvento"),
            consultaCadastro: svc.url("consultaCadastro") ?? null,
            qrCode: svc.urlQrCode(),
          },
          certificado: cert,
          limitador: svc.limiter.snapshot(),
        };
      }),
  );
}
