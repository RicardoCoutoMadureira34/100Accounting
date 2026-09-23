// Lê UM extrato em PDF com o pipeline real (texto com colunas + Haiku) e
// imprime as linhas lidas, os saldos, as somas e o resultado da verificação.
//
//   npx tsx scripts/test-extraction.ts bank scripts/samples/extrato-banco.pdf
//   npx tsx scripts/test-extraction.ts accounting caminho/contabilidade.pdf --text
//
// --text  mostra também o texto extraído do PDF (o que vai ao modelo).
// Gasta tokens (uma chamada por leitura, mais uma se for preciso repetir).
// Os PDFs de clientes NÃO entram no repositório (scripts/samples/ está no .gitignore).

import fs from "node:fs";
import path from "node:path";
import { ALLOW_SCANNED_PDFS } from "../src/lib/reconciliation/config";
import { KIND_LABEL, UserFacingError, scannedMessage, type StatementKind } from "../src/lib/reconciliation/errors";
import { prepareDocument, readStatement } from "../src/lib/reconciliation/read-statement";
import { formatEuros, toCents } from "../src/lib/reconciliation/verify";

function loadEnv() {
  const file = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n")) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}

async function main() {
  const [kindArg, file, ...flags] = process.argv.slice(2);
  if ((kindArg !== "bank" && kindArg !== "accounting") || !file) {
    console.error("Uso: npx tsx scripts/test-extraction.ts <bank|accounting> <ficheiro.pdf> [--text]");
    process.exit(2);
  }
  const kind: StatementKind = kindArg;
  loadEnv();

  const doc = await prepareDocument(kind, new Uint8Array(fs.readFileSync(file)));
  console.log(`\n${KIND_LABEL[kind]}: ${path.basename(file)}`);
  console.log(`Páginas com texto: ${doc.text.split("=== Página").length - 1} | carateres: ${doc.text.length}`);
  if (flags.includes("--text")) console.log(`\n----- texto extraído -----\n${doc.text}\n--------------------------`);

  if (doc.scanned && !ALLOW_SCANNED_PDFS) {
    console.log(`\nDIGITALIZADO: ${scannedMessage(kind)}\n(A API não foi chamada.)`);
    return;
  }

  const outcome = await readStatement(doc);
  const { read, verification: v } = outcome;

  console.log(`\nPeríodo: ${read.periodStart ?? "?"} a ${read.periodEnd ?? "?"}`);
  console.log(`Saldo inicial: ${read.openingBalance ?? "?"} | Saldo final: ${read.closingBalance ?? "?"}`);
  console.log(`Totais do documento: débitos ${read.documentTotalDebits ?? "-"} | créditos ${read.documentTotalCredits ?? "-"}\n`);

  console.log("pág  data        débito     crédito    montante   saldo      descrição");
  for (const l of v.lines) {
    console.log(
      [
        String(l.page).padEnd(4),
        l.date.padEnd(11),
        (l.debit?.toFixed(2) ?? "").padStart(9),
        (l.credit?.toFixed(2) ?? "").padStart(10),
        (l.amountCents / 100).toFixed(2).padStart(10),
        (l.balanceAfter?.toFixed(2) ?? "").padStart(10),
        " " + l.description,
      ].join(" ")
    );
  }

  const sum = v.lines.reduce((s, l) => s + l.amountCents, 0);
  const sumD = v.lines.reduce((s, l) => s + toCents(l.debit ?? 0), 0);
  const sumC = v.lines.reduce((s, l) => s + toCents(l.credit ?? 0), 0);
  console.log(`\nMovimentos lidos: ${v.lines.length}`);
  console.log(`Soma dos débitos: ${formatEuros(sumD)} | Soma dos créditos: ${formatEuros(sumC)} | Soma dos montantes: ${formatEuros(sum)}`);
  if (read.openingBalance != null) {
    console.log(`Saldo inicial + soma = ${formatEuros(toCents(read.openingBalance) + sum)} (saldo final indicado: ${read.closingBalance ?? "?"})`);
  }

  console.log(`\nVerificações feitas: ${v.performedChecks} | Verificada: ${outcome.verified ? "SIM" : "NÃO"}`);
  for (const c of v.corrections) console.log(`  correção: ${c}`);
  for (const f of v.failures) console.log(`  falha: ${f}`);
  for (const i of outcome.issues) console.log(`  aviso: ${i}`);
}

main().catch((e) => {
  if (e instanceof UserFacingError) console.error(`\n${e.message}`);
  else console.error(e);
  process.exit(1);
});
