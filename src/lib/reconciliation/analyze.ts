import type { ModelClient } from "./anthropic";
import { UserFacingError } from "./errors";
import { prepareInput, readPrepared, scannedMessages, type ExtractedStatement, type InputFile } from "./extract";
import { reconcileStatements, type ReconcileInput, type ReconciliationResult } from "./reconcile";

// Pipeline completo sem base de dados (usado pelos scripts e testes):
// 1) preparar e ler cada ficheiro (PDF, Excel ou CSV), 2) verificar a
// aritmética em código, 3) emparelhar e escrever o relatório. No fluxo da
// aplicação estes passos correm separados, com as linhas guardadas entre eles.

export type { ReconciliationResult, ResultTx } from "./reconcile";
export { normalizeDate } from "./extract";

export function toReconcileInput(ex: ExtractedStatement): ReconcileInput {
  return {
    openingBalance: ex.openingBalance,
    closingBalance: ex.closingBalance,
    verified: ex.verified,
    issues: ex.issues,
    lines: ex.lines.map((l) => ({
      position: l.position,
      date: l.date,
      description: l.description,
      reference: l.reference,
      cents: l.amountCents,
      origin: l.origin,
    })),
  };
}

const asFile = (input: InputFile | Uint8Array, fallbackName: string): InputFile =>
  input instanceof Uint8Array ? { name: fallbackName, bytes: input } : input;

export async function analyzeReconciliation(
  bank: InputFile | Uint8Array,
  accounting: InputFile | Uint8Array,
  opts: { client?: ModelClient } = {}
): Promise<ReconciliationResult> {
  // 1) Preparação local (sem API). Digitalizações são recusadas já aqui.
  const [bankIn, acctIn] = await Promise.all([
    prepareInput("bank", asFile(bank, "extrato-bancario.pdf")),
    prepareInput("accounting", asFile(accounting, "extrato-contabilidade.pdf")),
  ]);
  const scanned = scannedMessages([bankIn, acctIn]);
  if (scanned.length > 0) throw new UserFacingError(scanned.join(" "));

  // 2) Uma leitura por documento, em paralelo.
  const [bankEx, acctEx] = await Promise.all([readPrepared(bankIn, opts), readPrepared(acctIn, opts)]);

  // 3) Emparelhamento e texto do relatório.
  return reconcileStatements(toReconcileInput(bankEx), toReconcileInput(acctEx), opts);
}
