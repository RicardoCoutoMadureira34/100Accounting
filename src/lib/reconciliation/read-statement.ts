import { z } from "zod";
import { callStructured, type Content, type ModelClient } from "./anthropic";
import { ALLOW_SCANNED_PDFS } from "./config";
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
- NUNCA inventes valores, datas ou descrições. Se algo estiver ilegível, regista em issues.`;

const KIND_NOTES: Record<StatementKind, string> = {
  bank: "Extrato bancário: Débito é dinheiro que sai da conta, Crédito é dinheiro que entra.",
  accounting:
    "Extrato da contabilidade (conta de depósitos à ordem, conta 12): Débito é dinheiro que entra no banco, Crédito é dinheiro que sai. Muitas vezes todos os lançamentos têm a mesma data (fim do mês): usa a data de cada linha tal como aparece. Se o saldo tiver sufixo D/C, saldo devedor (D) é positivo e credor (C) é negativo.",
};

export interface PreparedDocument {
  kind: StatementKind;
  text: string;
  scanned: boolean;
  pdf: Uint8Array;
}

// Passo local (sem API): extrai o texto com colunas e deteta digitalizações.
export async function prepareDocument(kind: StatementKind, pdf: Uint8Array): Promise<PreparedDocument> {
  const extracted = await extractPdfText(pdf);
  return { kind, text: extracted.text, scanned: extracted.scanned, pdf };
}

function buildContent(doc: PreparedDocument, retryNote?: string): Content {
  const intro = `Tipo de documento: ${KIND_LABEL[doc.kind]}. ${KIND_NOTES[doc.kind]}`;
  const content: Content = [{ type: "text", text: intro }];
  if (doc.scanned) {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: Buffer.from(doc.pdf).toString("base64") },
    });
  } else {
    content.push({ type: "text", text: doc.text });
  }
  if (retryNote) content.push({ type: "text", text: retryNote });
  else content.push({ type: "text", text: "Transcreve todos os movimentos deste documento." });
  return content;
}

export interface StatementOutcome {
  kind: StatementKind;
  read: StatementRead;
  verification: Verification;
  verified: boolean;
  // Avisos para mostrar ao utilizador (problemas de leitura, sinais corrigidos, leitura não verificada).
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
  const call = (retryNote?: string) =>
    callStructured({
      client: opts.client,
      label: `read-${doc.kind}${retryNote ? "-retry" : ""}`,
      system: READ_SYSTEM_PROMPT,
      content: buildContent(doc, retryNote),
      schema: StatementReadSchema,
      maxTokens: 64000,
    });

  let read = await call();
  if (!read.readable || read.lines.length === 0) {
    const why = read.issues[0] ?? "não foram encontrados movimentos";
    throw new UserFacingError(`Não foi possível ler o ${label}: ${why}.`);
  }

  let verification = verifyStatement(doc.kind, toData(read));

  if (!verification.ok && verification.performedChecks > 0) {
    const note =
      `ATENÇÃO: a tua leitura anterior não bate certo: ${verification.failures.join("; ")}. ` +
      `Há movimentos em falta, repetidos ou com Débito/Crédito trocados. Volta a ler o documento com muito cuidado, ` +
      `linha a linha, e devolve a leitura completa e corrigida.`;
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
      console.error(`[reconciliation] retry de leitura falhou (${doc.kind}):`, e);
    }
  }

  const issues = [
    ...read.issues.map((i) => `${label[0].toUpperCase()}${label.slice(1)}: ${i}`),
    ...verification.corrections,
  ];
  if (!verification.ok) issues.push(unverifiedWarning(doc.kind, verification));

  return { kind: doc.kind, read, verification, verified: verification.ok, issues };
}
