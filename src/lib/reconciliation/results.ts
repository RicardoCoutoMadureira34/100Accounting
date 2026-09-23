// Deriva as listas do ecrã de resultados (Reconciliado, Prováveis, Só no
// Banco, Só na Contabilidade) a partir das linhas de "matches". Lógica pura
// para poder ser testada sem base de dados nem React.

export interface Tx {
  id: string;
  transaction_date: string;
  description: string;
  amount: number;
}

export interface MatchRow {
  id: string;
  match_type: "exact" | "probable" | "unmatched_bank" | "unmatched_accounting";
  confidence: number | null;
  category: string | null;
  group_id: string | null;
  note: string | null;
  status: "pending" | "confirmed" | "rejected";
  bank_transaction: Tx | null;
  accounting_transaction: Tx | null;
}

export interface ReconciledRow {
  tx: Tx;
  // Lançamento do outro lado quando o par é 1 para 1.
  other: Tx | null;
}

export interface ProbableCard {
  // Id de um dos matches do grupo (a ação de confirmar/rejeitar aplica-se ao grupo todo).
  matchId: string;
  groupId: string | null;
  confidence: number | null;
  note: string | null;
  bank: Tx[];
  accounting: Tx[];
}

export interface UnmatchedRow extends Tx {
  note: string | null;
  category: string | null;
}

export interface DerivedLists {
  reconciled: ReconciledRow[];
  probable: ProbableCard[];
  bankOnly: UnmatchedRow[];
  acctOnly: UnmatchedRow[];
}

function uniqueTxs(rows: MatchRow[], side: "bank_transaction" | "accounting_transaction"): Tx[] {
  const seen = new Set<string>();
  const out: Tx[] = [];
  for (const r of rows) {
    const t = r[side];
    if (t && !seen.has(t.id)) {
      seen.add(t.id);
      out.push(t);
    }
  }
  return out;
}

// Matches do mesmo grupo um-para-vários partilham group_id; os restantes
// contam como grupos de uma só linha.
function groupMatches(rows: MatchRow[]): MatchRow[][] {
  const groups = new Map<string, MatchRow[]>();
  for (const r of rows) {
    const key = r.group_id ?? r.id;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  return [...groups.values()];
}

export function deriveLists(matches: MatchRow[]): DerivedLists {
  const reconciled: ReconciledRow[] = [];
  const probable: ProbableCard[] = [];
  const bankOnly: UnmatchedRow[] = [];
  const acctOnly: UnmatchedRow[] = [];
  const seenBankOnly = new Set<string>();
  const seenAcctOnly = new Set<string>();

  const addBankOnly = (t: Tx, note: string | null, category: string | null) => {
    if (seenBankOnly.has(t.id)) return;
    seenBankOnly.add(t.id);
    bankOnly.push({ ...t, note, category });
  };
  const addAcctOnly = (t: Tx, note: string | null, category: string | null) => {
    if (seenAcctOnly.has(t.id)) return;
    seenAcctOnly.add(t.id);
    acctOnly.push({ ...t, note, category });
  };

  for (const m of matches) {
    if (m.match_type === "exact") {
      const tx = m.bank_transaction ?? m.accounting_transaction;
      if (tx) reconciled.push({ tx, other: m.bank_transaction ? m.accounting_transaction : null });
    } else if (m.match_type === "unmatched_bank") {
      if (m.bank_transaction) addBankOnly(m.bank_transaction, m.note, m.category);
    } else if (m.match_type === "unmatched_accounting") {
      if (m.accounting_transaction) addAcctOnly(m.accounting_transaction, m.note, m.category);
    }
  }

  const probableRows = matches.filter((m) => m.match_type === "probable");
  for (const group of groupMatches(probableRows)) {
    const first = group[0];
    const bank = uniqueTxs(group, "bank_transaction");
    const accounting = uniqueTxs(group, "accounting_transaction");

    if (first.status === "pending") {
      probable.push({
        matchId: first.id,
        groupId: first.group_id,
        confidence: first.confidence,
        note: first.note,
        bank,
        accounting,
      });
    } else if (first.status === "confirmed") {
      // Passa a "Reconciliado": uma linha por movimento do lado com mais linhas.
      if (bank.length >= accounting.length) {
        for (const b of bank) reconciled.push({ tx: b, other: accounting.length === 1 ? accounting[0] : null });
      } else {
        for (const a of accounting) reconciled.push({ tx: a, other: bank.length === 1 ? bank[0] : null });
      }
    } else {
      // Rejeitado: volta a aparecer em "Só no Banco" / "Só na Contabilidade".
      for (const b of bank) addBankOnly(b, first.note, null);
      for (const a of accounting) addAcctOnly(a, first.note, null);
    }
  }

  return { reconciled, probable, bankOnly, acctOnly };
}
