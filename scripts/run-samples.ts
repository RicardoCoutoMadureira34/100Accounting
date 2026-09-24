// Corre o pipeline nos pares de teste ("PDFs de teste RB") e compara com o
// "RESULTADO ESPERADO.txt" de cada pasta. Gasta tokens (Haiku).
//
//   npx tsx scripts/run-samples.ts "C:\Users\...\PDFs de teste RB" [--only 2] [--json saida.json]
//
// Cada pasta ParN tem "Extrato bancario.<pdf|xlsx|csv>" e
// "Extrato contabilidade.<pdf|xlsx|csv>". Os ficheiros de clientes não entram
// no repositório.

import fs from "node:fs";
import path from "node:path";
import { analyzeReconciliation, type ReconciliationResult } from "../src/lib/reconciliation/analyze";

function loadEnv() {
  const file = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n")) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}

// "12.450,80" / "-4.860,00" / "0,00" -> número
const pt = (s: string): number => Number(s.replace(/\./g, "").replace(",", "."));
const NUM = String.raw`(-?[\d.]+,\d{2})`;

interface Expected {
  bankLines: number;
  bankOpening: number;
  bankClosing: number;
  acctLines: number;
  acctOpening: number;
  acctClosing: number;
  exact: number;
  probable: number;
  bankOnly: number;
  bankOnlyTotal: number;
  acctOnly: number;
  acctOnlyTotal: number;
  closes: boolean;
  openingDiffers: boolean;
}

function parseExpected(text: string): Expected {
  const grab = (re: RegExp): RegExpExecArray => {
    const m = re.exec(text);
    if (!m) throw new Error(`Não encontrei ${re} no RESULTADO ESPERADO`);
    return m;
  };
  const bank = grab(new RegExp(String.raw`Extrato bancário:\s+(\d+) movimentos \| saldo inicial ${NUM} € \| saldo final ${NUM} €`));
  const acct = grab(new RegExp(String.raw`Extrato contabilístico:\s+(\d+) lançamentos \| saldo inicial ${NUM} € \| saldo final ${NUM} €`));
  const only = (label: string) => grab(new RegExp(String.raw`${label}: (\d+) movimentos? \| total ${NUM} €`));
  const bo = only("SÓ NO BANCO");
  const ao = only("SÓ NA CONTABILIDADE");
  return {
    bankLines: Number(bank[1]),
    bankOpening: pt(bank[2]),
    bankClosing: pt(bank[3]),
    acctLines: Number(acct[1]),
    acctOpening: pt(acct[2]),
    acctClosing: pt(acct[3]),
    exact: Number(grab(/RECONCILIADOS[^:]*: (\d+)/)[1]),
    probable: Number(grab(/PROVÁVEIS A CONFIRMAR: (\d+)/)[1]),
    bankOnly: Number(bo[1]),
    bankOnlyTotal: pt(bo[2]),
    acctOnly: Number(ao[1]),
    acctOnlyTotal: pt(ao[2]),
    closes: /Reconciliação FECHA: SIM/.test(text),
    openingDiffers: !/Diferença de saldos iniciais: 0,00 €/.test(text),
  };
}

const sum = (xs: { amount: number }[]) => Math.round(xs.reduce((s, x) => s + x.amount, 0) * 100) / 100;

function compare(exp: Expected, r: ReconciliationResult) {
  const rows: [string, unknown, unknown][] = [
    ["saldo inicial banco", exp.bankOpening, r.bankOpeningBalance],
    ["saldo final banco", exp.bankClosing, r.bankClosingBalance],
    ["saldo inicial contab.", exp.acctOpening, r.accountingOpeningBalance],
    ["saldo final contab.", exp.acctClosing, r.accountingClosingBalance],
    ["reconciliados", exp.exact, r.exact.length],
    ["prováveis", exp.probable, r.probable.length],
    ["só no banco (nº)", exp.bankOnly, r.unmatchedBank.length],
    ["só no banco (total)", exp.bankOnlyTotal, sum(r.unmatchedBank)],
    ["só na contab. (nº)", exp.acctOnly, r.unmatchedAccounting.length],
    ["só na contab. (total)", exp.acctOnlyTotal, sum(r.unmatchedAccounting)],
    ["fecha", exp.closes, r.closes],
    ["aviso saldos iniciais", exp.openingDiffers, r.issues.some((i) => /saldos iniciais diferem/.test(i))],
    ["leitura verificada", true, r.extractionVerified],
  ];
  return rows.map(([label, expected, got]) => ({ label, expected, got, ok: JSON.stringify(expected) === JSON.stringify(got) }));
}

function findFile(dir: string, base: string): string | null {
  for (const ext of ["pdf", "xlsx", "xls", "csv"]) {
    const p = path.join(dir, `${base}.${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith("--"));
  if (!root) {
    console.error('Uso: npx tsx scripts/run-samples.ts "<pasta com Par 1..N>" [--only N] [--json saida.json]');
    process.exit(2);
  }
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;

  const pairs = fs
    .readdirSync(root)
    .filter((d) => /^Par \d+/.test(d) && fs.statSync(path.join(root, d)).isDirectory())
    .filter((d) => !only || d.startsWith(`Par ${only}`))
    .sort();

  const summary: Record<string, unknown> = {};
  let failures = 0;
  for (const dir of pairs) {
    const full = path.join(root, dir);
    console.log(`\n=== ${dir}`);
    const bankFile = findFile(full, "Extrato bancario");
    const acctFile = findFile(full, "Extrato contabilidade");
    if (!bankFile || !acctFile) {
      console.log("  ficheiros em falta");
      failures++;
      continue;
    }
    const expected = parseExpected(fs.readFileSync(path.join(full, "RESULTADO ESPERADO.txt"), "utf8"));
    try {
      const result = await analyzeReconciliation(
        { name: path.basename(bankFile), bytes: new Uint8Array(fs.readFileSync(bankFile)) },
        { name: path.basename(acctFile), bytes: new Uint8Array(fs.readFileSync(acctFile)) }
      );
      const cmp = compare(expected, result);
      for (const c of cmp) console.log(`  ${c.ok ? "OK  " : "FAIL"} ${c.label.padEnd(24)} esperado=${JSON.stringify(c.expected)} obtido=${JSON.stringify(c.got)}`);
      const bad = cmp.filter((c) => !c.ok).length;
      failures += bad > 0 ? 1 : 0;
      console.log(`  -> ${bad === 0 ? "IGUAL AO ESPERADO" : `${bad} diferença(s)`}`);
      if (result.issues.length) console.log("  avisos:", result.issues);
      summary[dir] = { comparison: cmp, issues: result.issues };
    } catch (e) {
      failures++;
      console.log("  ERRO:", e instanceof Error ? e.message : e);
      summary[dir] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(summary, null, 2));
  console.log(`\n${failures === 0 ? "TODOS OS PARES IGUAIS AO ESPERADO" : `${failures} par(es) com diferenças`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
