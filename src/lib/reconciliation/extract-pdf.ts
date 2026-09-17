import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const StatementSchema = z.object({
  transactions: z
    .array(
      z.object({
        date: z.string().describe("Data do movimento, formato YYYY-MM-DD"),
        description: z.string().describe("Descrição do movimento tal como aparece no documento"),
        amount: z
          .number()
          .describe(
            "Valor do movimento em euros, com sinal: negativo para saídas/débitos (dinheiro que sai da conta), positivo para entradas/créditos (dinheiro que entra na conta)"
          ),
      })
    )
    .describe("Todos os movimentos listados no documento, por ordem de aparição"),
  closingBalance: z
    .number()
    .nullable()
    .describe("Saldo final indicado no documento, se estiver presente; caso contrário null"),
});

export type ExtractedStatement = z.infer<typeof StatementSchema>;

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

const DOCUMENT_LABEL: Record<"bank" | "accounting", string> = {
  bank: "um extrato bancário emitido pelo banco",
  accounting: "um extrato de conta corrente / razão da contabilidade (o registo interno da empresa dos movimentos dessa conta bancária)",
};

export async function extractStatementTransactions(
  pdfBase64: string,
  kind: "bank" | "accounting"
): Promise<ExtractedStatement> {
  const prompt = `Este PDF é ${DOCUMENT_LABEL[kind]}, em português de Portugal. Extrai TODOS os movimentos financeiros listados (não resumas nem omitas nenhum), com data, descrição e valor.

Regras importantes:
- Normaliza cada valor para a perspetiva da CONTA BANCÁRIA: negativo quando o dinheiro sai da conta (pagamentos, débitos, levantamentos, comissões), positivo quando o dinheiro entra (recebimentos, créditos). Isto aplica-se mesmo que o documento use colunas de "débito"/"crédito" em convenção contabilística onde os sinais possam estar invertidos face ao extrato bancário — interpreta o sentido real do movimento, não apenas o nome da coluna.
- A data deve ficar no formato YYYY-MM-DD.
- Inclui o saldo final do documento em "closingBalance" se estiver indicado (ex.: "saldo final", "saldo em") — caso contrário usa null.
- Não inventes movimentos que não estejam no documento, e não repitas o mesmo movimento mais do que uma vez, mesmo que o layout do documento pareça sugerir isso (cada linha da tabela corresponde a exatamente um movimento). Se o documento não for legível ou não parecer um extrato financeiro, devolve uma lista vazia.`;

  const response = await client().messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(StatementSchema) },
  });

  if (!response.parsed_output) {
    throw new Error(`Não foi possível extrair os movimentos do documento (${kind}).`);
  }
  return response.parsed_output;
}
