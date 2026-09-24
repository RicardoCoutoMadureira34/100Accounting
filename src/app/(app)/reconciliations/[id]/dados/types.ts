// Dados que a página do passo 2 (servidor) entrega ao ecrã interativo (cliente).
// Só valores simples, porque atravessam a fronteira servidor/cliente.

export type Source = "bank" | "accounting";

export interface LineView {
  id: string;
  position: number;
  date: string; // YYYY-MM-DD
  description: string;
  reference: string | null;
  entrada: number | null;
  saida: number | null;
  // saldo indicado pelo documento
  saldo: number | null;
  // saldo inicial + movimentos acumulados
  calculado: number | null;
  edited: boolean;
  origin: string | null;
}

export interface DocView {
  source: Source;
  label: string; // "extrato bancário" | "extrato da contabilidade"
  fileName: string;
  format: "pdf" | "xlsx" | "csv";
  readStatus: "pending" | "reading" | "ready" | "failed";
  readError: string | null;
  sourceName: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  lines: LineView[];
  ok: boolean;
  verifiable: boolean;
  problem: string | null;
  firstBadIndex: number | null;
  totalIn: number;
  totalOut: number;
  hasBalanceColumn: boolean;
  differenceCents: number | null;
  issues: string[];
}
