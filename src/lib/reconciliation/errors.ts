// Erro cuja mensagem é para mostrar tal e qual ao utilizador (em vez do
// aviso genérico "não foi possível analisar").
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

export type StatementKind = "bank" | "accounting";

export const KIND_LABEL: Record<StatementKind, string> = {
  bank: "extrato bancário",
  accounting: "extrato da contabilidade",
};

export function scannedMessage(kind: StatementKind): string {
  return `O ${KIND_LABEL[kind]} parece ser uma digitalização. Exporta-o em PDF diretamente do homebanking ou do programa de contabilidade.`;
}
