// Gerador determinístico de movimentos/correspondências "fictícios" para uma
// conciliação recém-criada.
//
// TEMPORÁRIO: substitui a leitura real dos PDFs (OCR/IA) que ainda não está
// ligada — ver o pedido do utilizador para adiar essa parte. Isto existe só
// para que o resto do backend (armazenamento, base de dados, ecrã de
// resultados, confirmar/rejeitar, exportação) seja real e testável já agora.
// Quando a leitura de PDFs estiver pronta, substituir generateStubDataset()
// pela extração real e apagar este ficheiro.

import type { Database } from "@/lib/supabase/database.types";

type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];
type MatchInsert = Database["public"]["Tables"]["matches"]["Insert"];

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

const ENTITIES = [
  "Construções Vieira, S.A.",
  "TecnoSoft Informática, Lda",
  "Mercearia do Bairro",
  "Auto Peças Norte, Lda",
  "Farmácia Nova Central",
  "Restaurante O Marisqueiro",
  "Transportes Rápidos, Lda",
  "Silva & Associados – Advogados",
  "Papelaria Central",
  "Consultoria Ferreira, Unipessoal Lda",
  "Elétrica Costa, Lda",
  "Clínica Dentária Sorriso",
  "Gráfica Moderna",
  "Imobiliária Atlântico",
  "Seguros Confiança",
];

function randomDateInRange(rng: () => number, start: Date, end: Date): Date {
  const t = start.getTime() + rng() * (end.getTime() - start.getTime());
  return new Date(t);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface StubDatasetInput {
  reconciliationId: string;
  periodStart: string;
  periodEnd: string;
}

export interface StubDataset {
  transactions: TransactionInsert[];
  matches: MatchInsert[];
  bankBalance: number;
  accountingBalance: number;
  difference: number;
}

export function generateStubDataset({ reconciliationId, periodStart, periodEnd }: StubDatasetInput): StubDataset {
  const rng = mulberry32(hashSeed(reconciliationId));
  const start = new Date(periodStart);
  const end = new Date(periodEnd);

  const transactions: TransactionInsert[] = [];
  const matches: MatchInsert[] = [];

  const newTx = (source: "bank" | "accounting", date: Date, description: string, amount: number): TransactionInsert => ({
    id: crypto.randomUUID(),
    reconciliation_id: reconciliationId,
    source,
    transaction_date: isoDate(date),
    description,
    amount: round2(amount),
    raw_data: { stub: true },
  });

  function pickEntity() {
    return ENTITIES[Math.floor(rng() * ENTITIES.length)];
  }

  function randomAmount(min: number, max: number, sign: 1 | -1) {
    return sign * (min + rng() * (max - min));
  }

  // --- Reconciliados (correspondência exata) ---
  const reconciledCount = 24 + Math.floor(rng() * 8);
  for (let i = 0; i < reconciledCount; i++) {
    const date = randomDateInRange(rng, start, end);
    const entity = pickEntity();
    const sign = rng() < 0.65 ? -1 : 1;
    const amount = randomAmount(20, 2600, sign);
    const desc = sign < 0 ? `PAGAMENTO - ${entity}` : `RECEBIMENTO TRF CLIENTE - ${entity}`;

    const bankTx = newTx("bank", date, desc.toUpperCase(), amount);
    const acctTx = newTx("accounting", date, `${entity} — ${sign < 0 ? "fatura" : "nota de crédito"}`, amount);
    transactions.push(bankTx, acctTx);
    matches.push({
      id: crypto.randomUUID(),
      reconciliation_id: reconciliationId,
      bank_transaction_id: bankTx.id!,
      accounting_transaction_id: acctTx.id!,
      match_type: "exact",
      confidence: 100,
      status: "confirmed",
    });
  }

  // --- Prováveis (confirmar) ---
  const probableCount = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < probableCount; i++) {
    const bankDate = randomDateInRange(rng, start, end);
    const acctDate = new Date(bankDate.getTime() + Math.floor(rng() * 3) * 86400000);
    const entity = pickEntity();
    const sign = rng() < 0.65 ? -1 : 1;
    const amount = randomAmount(50, 2200, sign);
    const drift = rng() < 0.4 ? round2((rng() - 0.5) * 6) : 0;

    const bankTx = newTx("bank", bankDate, `${sign < 0 ? "PAGAMENTO MB" : "RECEBIMENTO TRF CLIENTE"} - ${entity.toUpperCase()}`, amount);
    const acctTx = newTx("accounting", acctDate, `${entity} — documento associado`, amount + drift);
    transactions.push(bankTx, acctTx);
    matches.push({
      id: crypto.randomUUID(),
      reconciliation_id: reconciliationId,
      bank_transaction_id: bankTx.id!,
      accounting_transaction_id: acctTx.id!,
      match_type: "probable",
      confidence: round2(70 + rng() * 27),
      status: "pending",
    });
  }

  // --- Só no banco ---
  const bankOnlyCount = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < bankOnlyCount; i++) {
    const date = randomDateInRange(rng, start, end);
    const amount = randomAmount(1, 300, rng() < 0.8 ? -1 : 1);
    const bankTx = newTx("bank", date, "COMISSÃO / MOVIMENTO BANCÁRIO SEM DOCUMENTO ASSOCIADO", amount);
    transactions.push(bankTx);
    matches.push({
      id: crypto.randomUUID(),
      reconciliation_id: reconciliationId,
      bank_transaction_id: bankTx.id!,
      accounting_transaction_id: null,
      match_type: "unmatched_bank",
      confidence: null,
      status: "pending",
    });
  }

  // --- Só na contabilidade ---
  const acctOnlyCount = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < acctOnlyCount; i++) {
    const date = randomDateInRange(rng, start, end);
    const amount = randomAmount(50, 1200, -1);
    const acctTx = newTx("accounting", date, "Lançamento sem correspondência bancária (ex.: cheque não compensado)", amount);
    transactions.push(acctTx);
    matches.push({
      id: crypto.randomUUID(),
      reconciliation_id: reconciliationId,
      bank_transaction_id: null,
      accounting_transaction_id: acctTx.id!,
      match_type: "unmatched_accounting",
      confidence: null,
      status: "pending",
    });
  }

  const bankBalance = round2(
    transactions.filter((t) => t.source === "bank").reduce((sum, t) => sum + t.amount, 0)
  );
  const accountingBalance = round2(
    transactions.filter((t) => t.source === "accounting").reduce((sum, t) => sum + t.amount, 0)
  );

  return {
    transactions,
    matches,
    bankBalance,
    accountingBalance,
    difference: round2(bankBalance - accountingBalance),
  };
}
