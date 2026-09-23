import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelClient } from "./anthropic";
import { analyzeReconciliation } from "./analyze";
import { prepareDocument, readStatement, type StatementRead } from "./read-statement";
import { buildPdf } from "./test-utils";

// Cliente falso: devolve respostas pré-definidas em vez de chamar a API.
function fakeClient(respond: (system: string, userText: string) => unknown) {
  const calls: { system: string; userText: string }[] = [];
  const client = {
    messages: {
      stream: (params: { system: { text: string }[]; messages: { content: { type: string; text?: string }[] }[] }) => {
        const system = params.system[0].text;
        const userText = params.messages[0].content.map((c) => c.text ?? "").join("\n");
        calls.push({ system, userText });
        return {
          finalMessage: async () => {
            const parsed = respond(system, userText);
            if (parsed instanceof Error) throw parsed;
            return { usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "end_turn", parsed_output: parsed };
          },
        };
      },
    },
  } as unknown as ModelClient;
  return { client, calls };
}

const line = (date: string, description: string, debit: number | null, credit: number | null) => ({
  date,
  description,
  reference: null,
  debit,
  credit,
  balanceAfter: null,
  page: 1,
});

const read = (over: Partial<StatementRead>): StatementRead => ({
  readable: true,
  issues: [],
  periodStart: "2026-06-01",
  periodEnd: "2026-06-30",
  openingBalance: 0,
  closingBalance: 0,
  documentTotalDebits: null,
  documentTotalCredits: null,
  openingRowDebits: null,
  openingRowCredits: null,
  lines: [],
  ...over,
});

const textPdf = (text: string) => buildPdf([[{ x: 40, y: 700, text }]]);
const BANK_PDF = textPdf("Extrato bancario de teste com texto suficiente para nao ser digitalizado");
const ACCT_PDF = textPdf("Extrato da contabilidade de teste com texto suficiente para nao ser digitalizado");

describe("leitura com verificação e repetição", () => {
  const incomplete = read({ openingBalance: 100, closingBalance: 140, lines: [line("2026-06-02", "COMPRA", 10, null)] });
  const complete = read({
    openingBalance: 100,
    closingBalance: 140,
    lines: [line("2026-06-02", "COMPRA", 10, null), line("2026-06-05", "TRF", null, 50)],
  });

  it("se a soma não bate repete UMA vez indicando a diferença, e aceita a leitura corrigida", async () => {
    const { client, calls } = fakeClient(() => (calls.length === 1 ? incomplete : complete));
    const doc = await prepareDocument("bank", BANK_PDF);
    const out = await readStatement(doc, { client });

    assert.equal(calls.length, 2);
    assert.match(calls[1].userText, /ATENÇÃO/);
    assert.match(calls[1].userText, /a soma dá 90,00 €, o saldo final é 140,00 € \(faltam 50,00 €\)/);
    assert.equal(out.verified, true);
    assert.equal(out.verification.lines.length, 2);
    assert.equal(out.issues.length, 0);
  });

  it("se voltar a falhar continua, marcado como não verificado e com a diferença em euros", async () => {
    const { client, calls } = fakeClient(() => incomplete);
    const doc = await prepareDocument("bank", BANK_PDF);
    const out = await readStatement(doc, { client });

    assert.equal(calls.length, 2, "só uma repetição");
    assert.equal(out.verified, false);
    assert.match(out.issues.join("\n"), /não foi verificada: a soma dá 90,00 €, o saldo final é 140,00 € \(faltam 50,00 €\)/);
  });

  it("uma leitura que já bate certo não é repetida", async () => {
    const { client, calls } = fakeClient(() => complete);
    const doc = await prepareDocument("bank", BANK_PDF);
    const out = await readStatement(doc, { client });
    assert.equal(calls.length, 1);
    assert.equal(out.verified, true);
  });
});

describe("pipeline completo com cliente falso", () => {
  const bankRead = read({
    openingBalance: 0,
    closingBalance: 80,
    lines: [line("2026-06-05", "TRF CLIENTE", null, 100), line("2026-06-10", "COMPRA", 20, null)],
  });
  const acctRead = read({
    openingBalance: 0,
    closingBalance: 100,
    lines: [line("2026-06-08", "Recebimento de cliente", 100, null)],
  });

  it("emparelha em código, calcula 'fecha' com os saldos e usa categoria 'outro' se o texto falhar", async () => {
    const { client } = fakeClient((system, userText) => {
      if (system.includes("contabilista sénior")) return new Error("falha simulada do texto do relatório");
      return userText.includes("extrato bancário") ? bankRead : acctRead;
    });
    const r = await analyzeReconciliation(BANK_PDF, ACCT_PDF, { client });

    assert.equal(r.exact.length, 1);
    assert.equal(r.exact[0].bank.description, "TRF CLIENTE");
    assert.equal(r.exact[0].accounting.description, "Recebimento de cliente", "grava o lançamento real de cada lado");
    assert.equal(r.unmatchedBank.length, 1);
    assert.equal(r.unmatchedBank[0].amount, -20);
    assert.equal(r.unmatchedBank[0].category, "outro");
    assert.equal(r.extractionVerified, true);
    // (80 - 0) - (100 - 0) = -20; explicado por 1 movimento só no banco de -20
    assert.equal(r.difference, 0);
    assert.equal(r.closes, true);
    assert.ok(r.summary.length > 0);
    assert.ok(r.nextSteps.length > 0);
  });

  it("avisa quando os saldos iniciais diferem", async () => {
    const { client } = fakeClient((system, userText) => {
      if (system.includes("contabilista sénior")) return new Error("x");
      return userText.includes("extrato bancário")
        ? { ...bankRead, openingBalance: 388.19, closingBalance: 468.19 }
        : { ...acctRead, openingBalance: 5445.73, closingBalance: 5545.73 };
    });
    const r = await analyzeReconciliation(BANK_PDF, ACCT_PDF, { client });
    assert.match(r.issues.join("\n"), /Os saldos iniciais diferem 5057,54 €/);
    assert.equal(r.closes, true, "a diferença de abertura não impede o período de fechar");
  });

  it("o texto do relatório recebe contexto sem ids nos pares e com a diferença de saldos iniciais", async () => {
    const acctTwo = { ...acctRead, openingBalance: 5445.73, closingBalance: 5545.73, lines: [line("2026-06-08", "Recebimento de cliente", 100, null)] };
    const bankTwo = {
      ...bankRead,
      openingBalance: 388.19,
      closingBalance: 468.19,
      // 250,50 no banco vs 250 na contabilidade: par provável (valor quase igual)
      lines: [line("2026-06-05", "TRF CLIENTE", null, 100), line("2026-06-10", "COMPRA", 20, null)],
    };
    const { client, calls } = fakeClient((system, userText) => {
      if (system.includes("contabilista sénior")) {
        return {
          unmatchedBank: [{ id: 1, category: "categoria_inventada", observation: "Compra ainda não lançada" }],
          unmatchedAccounting: [],
          summary: "ok",
          nextSteps: ["passo"],
        };
      }
      return userText.includes("extrato bancário") ? bankTwo : acctTwo;
    });
    const r = await analyzeReconciliation(BANK_PDF, ACCT_PDF, { client });

    const narrativeCall = calls.find((c) => c.system.includes("contabilista sénior"))!;
    const payload = JSON.parse(narrativeCall.userText);
    assert.equal(payload.openingBalancesDiffer, true);
    assert.equal(payload.openingDifference, "5057,54 €");
    assert.equal(payload.higherOpeningBalanceIn, "contabilidade");
    assert.deepEqual(payload.pending, { unmatchedBank: 1, unmatchedAccounting: 0, probablePairs: 0 });
    assert.equal(payload.unmatchedBank[0].id, 1, "o id só existe nos sem correspondência, para associar a categoria");
    assert.equal(payload.unmatchedBank[0].description, "COMPRA");
    for (const pair of payload.probablePairs) {
      for (const t of [...pair.bank, ...pair.accounting]) assert.equal("id" in t, false);
    }
    // regras obrigatórias no prompt
    assert.match(narrativeCall.system, /Nunca menciones identificadores internos/);
    assert.match(narrativeCall.system, /Não digas que o saldo ou a diferença é zero/);
    assert.match(narrativeCall.system, /nunca digas que o banco e a contabilidade vão ficar com o mesmo saldo final/);
    // categoria desconhecida devolvida pelo modelo passa a "outro"
    assert.equal(r.unmatchedBank[0].category, "outro");
    assert.equal(r.unmatchedBank[0].observation, "Compra ainda não lançada");
  });

  it("o texto de reserva também não promete saldos finais iguais quando os iniciais diferem", async () => {
    const { client } = fakeClient((system, userText) => {
      if (system.includes("contabilista sénior")) return new Error("x");
      return userText.includes("extrato bancário")
        ? { ...bankRead, openingBalance: 388.19, closingBalance: 468.19 }
        : { ...acctRead, openingBalance: 5445.73, closingBalance: 5545.73 };
    });
    const r = await analyzeReconciliation(BANK_PDF, ACCT_PDF, { client });
    assert.match(r.summary, /saldos iniciais diferem 5057,54 €/);
    assert.match(r.summary, /continuam a diferir/);
    assert.doesNotMatch(r.summary, /A reconciliação fecha./);
  });

  it("sem saldos não calcula a diferença e avisa", async () => {
    const { client } = fakeClient((system, userText) => {
      if (system.includes("contabilista sénior")) return new Error("x");
      return userText.includes("extrato bancário")
        ? { ...bankRead, openingBalance: null, closingBalance: null }
        : acctRead;
    });
    const r = await analyzeReconciliation(BANK_PDF, ACCT_PDF, { client });
    assert.equal(r.difference, null);
    assert.equal(r.closes, false);
    assert.match(r.issues.join("\n"), /Não foi possível calcular a diferença do período/);
  });
});

describe("indicações obrigatórias no resultado final", () => {
  const narrativeReply = (bank: { id: number; category: string; observation: string }[], acct: { id: number; category: string; observation: string }[]) => ({
    unmatchedBank: bank,
    unmatchedAccounting: acct,
    summary: "resumo",
    nextSteps: ["passo"],
  });

  it("movimento de mês anterior: mantém a categoria do modelo mas o texto é o calculado em código", async () => {
    const bankReading = read({
      openingBalance: 388.19,
      closingBalance: 5455.73,
      lines: [line("2026-06-10", "DEPOSITO CHEQUE 123", null, 5057.54), line("2026-06-11", "TRF", null, 10)],
    });
    const acctReading = read({
      openingBalance: 5445.73,
      closingBalance: 5455.73,
      lines: [line("2026-06-11", "Transferência", 10, null)],
    });
    const { client, calls } = fakeClient((system, userText) => {
      if (system.includes("contabilista sénior")) {
        return narrativeReply([{ id: 0, category: "cheque_em_transito", observation: "Cheque ainda não compensado" }], []);
      }
      return userText.includes("extrato bancário") ? bankReading : acctReading;
    });
    const r = await analyzeReconciliation(BANK_PDF, ACCT_PDF, { client });

    assert.equal(r.unmatchedBank.length, 1);
    assert.equal(r.unmatchedBank[0].category, "cheque_em_transito", "categoria adequada mantida");
    assert.match(r.unmatchedBank[0].observation, /já lançado na contabilidade num mês anterior/);
    assert.match(r.unmatchedBank[0].observation, /diferença de saldos iniciais de 5057,54 €/);
    assert.doesNotMatch(r.unmatchedBank[0].observation, /não compensado/);
    assert.equal(r.closes, true);

    // o modelo recebe a indicação como obrigatória e as regras no prompt
    const narrativeCall = calls.find((c) => c.system.includes("contabilista sénior"))!;
    const item = JSON.parse(narrativeCall.userText).unmatchedBank[0];
    assert.equal(item.mandatory.kind, "prior_period");
    assert.match(item.mandatory.observation, /Não é preciso lançar de novo/);
    assert.match(narrativeCall.system, /"mandatory"/);
    assert.match(narrativeCall.system, /nunca digas que não foi compensado/);
  });

  it("duplicado: categoria e texto são impostos mesmo que o modelo diga outra coisa", async () => {
    const bankReading = read({ openingBalance: 0, closingBalance: -50, lines: [line("2026-06-10", "PAG X", 50, null)] });
    const acctReading = read({
      openingBalance: 0,
      closingBalance: -100,
      lines: [line("2026-06-10", "PAG X", null, 50), line("2026-06-11", "PAG X", null, 50)],
    });
    const { client } = fakeClient((system, userText) => {
      if (system.includes("contabilista sénior")) {
        return narrativeReply([], [{ id: 1, category: "outro", observation: "Pagamento por lançar" }]);
      }
      return userText.includes("extrato bancário") ? bankReading : acctReading;
    });
    const r = await analyzeReconciliation(BANK_PDF, ACCT_PDF, { client });

    assert.equal(r.exact.length, 1);
    assert.equal(r.unmatchedAccounting.length, 1);
    assert.equal(r.unmatchedAccounting[0].category, "duplicado");
    assert.equal(
      r.unmatchedAccounting[0].observation,
      "Possível lançamento em duplicado de PAG X de 50,00 €. O banco só tem um movimento; verificar e anular o lançamento repetido."
    );
  });

  it("as indicações também se aplicam quando o texto do relatório falha", async () => {
    const bankReading = read({ openingBalance: 0, closingBalance: -50, lines: [line("2026-06-10", "PAG X", 50, null)] });
    const acctReading = read({
      openingBalance: 0,
      closingBalance: -100,
      lines: [line("2026-06-10", "PAG X", null, 50), line("2026-06-11", "PAG X", null, 50)],
    });
    const { client } = fakeClient((system, userText) => {
      if (system.includes("contabilista sénior")) return new Error("falha simulada");
      return userText.includes("extrato bancário") ? bankReading : acctReading;
    });
    const r = await analyzeReconciliation(BANK_PDF, ACCT_PDF, { client });
    assert.equal(r.unmatchedAccounting[0].category, "duplicado");
    assert.match(r.summary, /1 movimento\(s\) parecem lançados em duplicado/);
  });
});
