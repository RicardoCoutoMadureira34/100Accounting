import { z } from "zod";
import { callStructured, type Content, type ModelClient } from "./anthropic";
import { ALLOW_SCANNED_PDFS, PDF_PAGES_PER_CHUNK } from "./config";
import { KIND_LABEL, UserFacingError, scannedMessage, type StatementKind } from "./errors";
import { extractPdfText } from "./pdf-text";
import { unverifiedWarning, verificationGap, verifyStatement, type StatementData, type Verification } from "./verify";

// A IA só LÊ o documento: transcreve as linhas tal como aparecem, na coluna
// onde aparecem. Sinais, somas e emparelhamento são feitos em código.
const LineSchema = z.object({
  date: z.string().describe("Data do movimento em YYYY-MM-DD"),
  description: z.string(),
  reference: z.string().nullable().describe("Referência/número de documento, se existir"),
  debit: z.number().nullable().describe("Valor positivo, se aparece na coluna Débito"),
  credit: z.number().nullable().describe("Valor positivo, se aparece na coluna Crédito"),
  balanceAfter: z.number().nullable().describe("Saldo depois deste movimento, se o documento tiver coluna de saldo"),
  page: z.number().describe("Número da página onde o movimento aparece"),
});

export const StatementReadSchema = z.object({
  readable: z.boolean().describe("false se o documento não for um extrato legível"),
  issues: z.array(z.string()).describe("Problemas de leitura (vazio se não houver)"),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  openingBalance: z.number().nullable().describe("Saldo inicial / saldo anterior do período"),
  closingBalance: z.number().nullable().describe("Saldo final do período"),
  documentTotalDebits: z.number().nullable().describe("Total de débitos que o próprio documento mostra, se existir"),
  documentTotalCredits: z.number().nullable().describe("Total de créditos que o próprio documento mostra, se existir"),
  sourceName: z
    .string()
    .nullable()
    .describe("Banco ou programa de contabilidade que emitiu o documento (ex.: Millennium BCP, PHC), se se perceber; senão null"),
  openingRowDebits: z
    .number()
    .nullable()
    .describe("Débitos acumulados que o documento mostra na própria linha de saldo inicial (null se não existirem)"),
  openingRowCredits: z
    .number()
    .nullable()
    .describe("Créditos acumulados que o documento mostra na própria linha de saldo inicial (null se não existirem)"),
  lines: z.array(LineSchema),
});
export type StatementRead = z.infer<typeof StatementReadSchema>;

const READ_SYSTEM_PROMPT = `Lês extratos em PDF e transcreves os movimentos para o schema estruturado. A tua ÚNICA tarefa é LER. Não emparelhes movimentos, não analises, não faças contas e não decidas sinais.

O texto foi extraído do PDF página a página (marcadores "=== Página N ==="). Cada valor monetário vem etiquetado com o nome da coluna a que pertence, entre parênteses retos, por exemplo "17 000,00 [Crédito]" ou "5 445,73 [Sald.Déb.]". Usa SEMPRE essa etiqueta para decidir se um valor é débito, crédito, montante ou saldo (ignora a posição no texto). Valores sem etiqueta: usa o cabeçalho da tabela.

REGRAS
- Cada movimento aparece exatamente uma vez, pela ordem do documento. Não repitas nem saltes linhas.
- Ignora como movimentos: "A transportar", "Transporte", "Total", linhas de saldo (saldo inicial, saldo anterior, saldo final), cabeçalhos e rodapés repetidos em cada página.
- Descrições que ocupam várias linhas são UM só movimento (junta o texto).
- Datas sem ano usam o ano do cabeçalho ou do período do extrato. Devolve sempre YYYY-MM-DD.
- Valores: suporta "1 234,56", "1.234,56", "1234.56" e sinal no fim ("7.90-"). Devolve números positivos, na coluna em que o valor aparece (debit ou credit). Se o documento só tiver UMA coluna de montante com sinal, os valores negativos (ou com "-") vão para debit e os positivos para credit.
- Lê todas as secções do extrato (não pares na primeira tabela nem na primeira página).
- balanceAfter, openingBalance e closingBalance são SEMPRE números com sinal. Se o saldo estiver dividido em duas colunas (saldo devedor "Sald.Déb." / "Saldo Devedor" e saldo credor "Sald.Cré." / "Saldo Credor"), o valor na coluna devedora é positivo e o valor na coluna credora é NEGATIVO. Se houver uma só coluna de saldo, usa o sinal que o documento mostra (negativo para descoberto ou "-").
- balanceAfter: só se existir coluna de saldo; senão null.
- openingBalance e closingBalance: o saldo na linha de "Saldo inicial" (ou saldo anterior) e o saldo final do período. Numa linha de saldo inicial podem aparecer também débitos e créditos ACUMULADOS: não são movimentos; devolve-os em openingRowDebits e openingRowCredits (null se não existirem).
- documentTotalDebits e documentTotalCredits: os valores das colunas Débito e Crédito na linha "Total" do documento (tal como aparecem, mesmo que incluam os acumulados), só se essa linha existir.
- page é o número do marcador de página onde o movimento aparece.
- sourceName: o nome do banco ou do programa de contabilidade que emitiu o documento, se se perceber pelo cabeçalho ou rodapé; senão null.
- Se te disserem que recebes apenas um BLOCO de páginas de um documento maior, devolve só os movimentos dessas páginas; os saldos, totais e período só se aparecerem nesse bloco (senão null).
- NUNCA inventes valores, datas ou descrições. Se algo estiver ilegível, regista em issues.`;

const KIND_NOTES: Record<StatementKind, string> = {
  bank: "Extrato bancário: Débito é dinheiro que sai da conta, Crédito é dinheiro que entra.",
  accounting:
    "Extrato da contabilidade (conta de depósitos à ordem, conta 12): Débito é dinheiro que entra no banco, Crédito é dinheiro que sai. Muitas vezes todos os lançamentos têm a mesma data (fim do mês): usa a data de cada linha tal como aparece. Se o saldo tiver sufixo D/C, saldo devedor (D) é positivo e credor (C) é negativo.",
};

export interface PreparedDocument {
  kind: StatementKind;
  text: string;
  // Texto de cada página (já com as colunas etiquetadas), para ler por blocos.
  pages: string[];
  scanned: boolean;
  pdf: Uint8Array;
}

// Passo local (sem API): extrai o texto com colunas e deteta digitalizações.
export async function prepareDocument(kind: StatementKind, pdf: Uint8Array): Promise<PreparedDocument> {
  const extracted = await extractPdfText(pdf);
  return { kind, text: extracted.text, pages: extracted.pages, scanned: extracted.scanned, pdf };
}

export interface Chunk {
  text: string;
  from: number; // 1-based
  to: number;
  total: number;
}

// PDFs longos leem-se por blocos de páginas (uma chamada por bloco) para não
// perder linhas; até PDF_PAGES_PER_CHUNK páginas continua a ser uma só chamada.
export function splitIntoChunks(pages: string[], perChunk: number = PDF_PAGES_PER_CHUNK): Chunk[] {
  const marker = (n: number, text: string) => "=== Página " + n + " ===\n" + text;
  if (pages.length <= perChunk) {
    return [{ text: pages.map((p, i) => marker(i + 1, p)).join("\n\n"), from: 1, to: pages.length, total: pages.length }];
  }
  const chunks: Chunk[] = [];
  for (let start = 0; start < pages.length; start += perChunk) {
    const slice = pages.slice(start, start + perChunk);
    chunks.push({
      text: slice.map((p, i) => marker(start + i + 1, p)).join("\n\n"),
      from: start + 1,
      to: start + slice.length,
      total: pages.length,
    });
  }
  return chunks;
}

function buildContent(doc: PreparedDocument, retryNote?: string, chunk?: Chunk): Content {
  const intro = "Tipo de documento: " + KIND_LABEL[doc.kind] + ". " + KIND_NOTES[doc.kind];
  const content: Content = [{ type: "text", text: intro }];
  if (doc.scanned) {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: Buffer.from(doc.pdf).toString("base64") },
    });
  } else {
    if (chunk && chunk.total > chunk.to - chunk.from + 1) {
      content.push({
        type: "text",
        text:
          "Recebes apenas um BLOCO do documento: as páginas " +
          chunk.from +
          " a " +
          chunk.to +
          " de " +
          chunk.total +
          ". Devolve só os movimentos destas páginas.",
      });
    }
    content.push({ type: "text", text: chunk ? chunk.text : doc.text });
  }
  if (retryNote) content.push({ type: "text", text: retryNote });
  else content.push({ type: "text", text: "Transcreve todos os movimentos deste documento." });
  return content;
}

// Junta as leituras de vários blocos do mesmo documento.
export function mergeReads(reads: StatementRead[]): StatementRead {
  function firstNonNull<T>(pick: (r: StatementRead) => T | null): T | null {
    for (const r of reads) {
      const v = pick(r);
      if (v != null) return v;
    }
    return null;
  }
  function lastNonNull<T>(pick: (r: StatementRead) => T | null): T | null {
    for (let i = reads.length - 1; i >= 0; i--) {
      const v = pick(reads[i]);
      if (v != null) return v;
    }
    return null;
  }
  const usable = reads.filter((r) => r.readable);
  return {
    readable: usable.length > 0,
    issues: [...new Set(reads.flatMap((r) => r.issues))],
    periodStart: firstNonNull((r) => r.periodStart),
    periodEnd: lastNonNull((r) => r.periodEnd),
    // Saldo inicial e acumulados: no primeiro bloco; saldo final e totais: no último.
    openingBalance: firstNonNull((r) => r.openingBalance),
    closingBalance: lastNonNull((r) => r.closingBalance),
    documentTotalDebits: lastNonNull((r) => r.documentTotalDebits),
    documentTotalCredits: lastNonNull((r) => r.documentTotalCredits),
    sourceName: firstNonNull((r) => r.sourceName),
    openingRowDebits: firstNonNull((r) => r.openingRowDebits),
    openingRowCredits: firstNonNull((r) => r.openingRowCredits),
    lines: reads.flatMap((r) => r.lines),
  };
}

export interface StatementOutcome {
  kind: StatementKind;
  read: StatementRead;
  verification: Verification;
  verified: boolean;
  retried: boolean;
  // Avisos da leitura (problemas reportados pelo modelo e sinais corrigidos).
  readIssues: string[];
  // readIssues + aviso de leitura não verificada.
  issues: string[];
}

function toData(read: StatementRead): StatementData {
  return {
    openingBalance: read.openingBalance,
    closingBalance: read.closingBalance,
    documentTotalDebits: read.documentTotalDebits,
    documentTotalCredits: read.documentTotalCredits,
    openingRowDebits: read.openingRowDebits,
    openingRowCredits: read.openingRowCredits,
    lines: read.lines,
  };
}

// Lê o documento, verifica a aritmética e, se falhar, repete UMA vez indicando
// a diferença encontrada. Se voltar a falhar segue em frente mas marcado como
// não verificado.
export async function readStatement(
  doc: PreparedDocument,
  opts: { client?: ModelClient } = {}
): Promise<StatementOutcome> {
  if (doc.scanned && !ALLOW_SCANNED_PDFS) {
    throw new UserFacingError(scannedMessage(doc.kind));
  }

  const label = KIND_LABEL[doc.kind];
  const chunks: (Chunk | undefined)[] = doc.scanned ? [undefined] : splitIntoChunks(doc.pages);
  const callChunk = (chunk: Chunk | undefined, index: number, retryNote?: string) =>
    callStructured({
      client: opts.client,
      label:
        "read-" + doc.kind + (chunks.length > 1 ? "-" + (index + 1) + "of" + chunks.length : "") + (retryNote ? "-retry" : ""),
      system: READ_SYSTEM_PROMPT,
      content: buildContent(doc, retryNote, chunk),
      schema: StatementReadSchema,
      maxTokens: 64000,
    });
  const call = async (retryNote?: string): Promise<StatementRead> => {
    const reads = await Promise.all(chunks.map((c, i) => callChunk(c, i, retryNote)));
    return reads.length === 1 ? reads[0] : mergeReads(reads);
  };

  let read = await call();
  if (!read.readable || read.lines.length === 0) {
    const why = read.issues[0] ?? "não foram encontrados movimentos";
    throw new UserFacingError("Não foi possível ler o " + label + ": " + why + ".");
  }

  let verification = verifyStatement(doc.kind, toData(read));
  let retried = false;

  if (!verification.ok && verification.performedChecks > 0) {
    retried = true;
    const note =
      "ATENÇÃO: a tua leitura anterior não bate certo: " +
      verification.failures.join("; ") +
      ". Há movimentos em falta, repetidos ou com Débito/Crédito trocados. Volta a ler o documento com muito cuidado, " +
      "linha a linha, e devolve a leitura completa e corrigida.";
    try {
      const second = await call(note);
      if (second.readable && second.lines.length > 0) {
        const v2 = verifyStatement(doc.kind, toData(second));
        if (v2.ok || verificationGap(v2) < verificationGap(verification)) {
          read = second;
          verification = v2;
        }
      }
    } catch (e) {
      console.error("[reconciliation] retry de leitura falhou (" + doc.kind + "):", e);
    }
  }

  const readIssues = [
    ...read.issues.map((i) => label[0].toUpperCase() + label.slice(1) + ": " + i),
    ...verification.corrections,
  ];
  const issues = verification.ok ? readIssues : [...readIssues, unverifiedWarning(doc.kind, verification)];

  return { kind: doc.kind, read, verification, verified: verification.ok, retried, readIssues, issues };
}
