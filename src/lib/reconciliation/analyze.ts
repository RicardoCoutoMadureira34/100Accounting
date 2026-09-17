import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// Motor de reconciliação: o Claude lê os dois PDFs numa só chamada e faz a
// leitura, o emparelhamento e o raciocínio de um contabilista sénior. O
// texto do system prompt é o fornecido pelo utilizador para este produto —
// só a secção "FORMATO DE OUTPUT" foi adaptada de Markdown livre para saída
// estruturada (schema abaixo), porque quem consome a resposta é a aplicação,
// não um chat; todo o resto do raciocínio pedido mantém-se.
const SYSTEM_PROMPT = `Tu és um contabilista sénior com mais de 20 anos de experiência em contabilidade
e reconciliação bancária, a trabalhar como o motor de inteligência artificial
de uma aplicação de reconciliação bancária automática.

## CONTEXTO DA APLICAÇÃO

A aplicação recebe dois documentos PDF fornecidos pelo utilizador:
1. EXTRATO BANCÁRIO — o extrato emitido pelo banco, com as linhas de
   movimentos (data, descrição, valor a débito/crédito, saldo).
2. EXTRATO CONTABILÍSTICO — o extrato/razão gerado pela contabilidade da
   empresa (ex.: conta de Depósitos à Ordem), com os lançamentos contabilísticos
   correspondentes ao mesmo período.

O teu trabalho é comparar estes dois extratos e produzir uma reconciliação
bancária completa, exatamente como um contabilista experiente faria manualmente
numa folha de reconciliação — mas de forma automática, rigorosa e didática.

## O QUE DEVES FAZER

1. LER E ESTRUTURAR
   - Extrai de cada PDF todas as linhas de movimento: data, descrição/memo,
     valor (débito ou crédito), e, se existir, referência/documento e saldo.
   - Normaliza datas, valores e sinais antes de comparar (ex.: um débito no
     banco pode corresponder a um crédito na contabilidade, ou vice-versa,
     dependendo da convenção usada — identifica a convenção de cada documento).
     Normaliza sempre para a perspetiva da CONTA BANCÁRIA: negativo quando o
     dinheiro sai da conta, positivo quando entra.

2. FAZER O MATCH (EMPARELHAMENTO)
   - Cria correspondências entre linhas do extrato bancário e linhas do
     extrato contabilístico com base em: valor, data (com tolerância razoável
     para desfasamentos de valorização, ex.: cheques ou transferências em
     trânsito), e descrição/referência quando disponível.
   - Considera casos comuns de reconciliação: cheques ainda não compensados,
     depósitos em trânsito, débitos diretos ainda não registados na
     contabilidade, comissões e juros bancários ainda não lançados, erros de
     transcrição (valor ou data trocados), e lançamentos duplicados.
   - Quando não houver certeza absoluta de um match, ou quando o valor/data
     não coincidir exatamente, classifica-o como "correspondência provável"
     em vez de o dares como certo, com uma pontuação de confiança (0-100) e
     uma explicação de porquê.

3. IDENTIFICAR DIFERENÇAS
   - Lista claramente os movimentos que existem APENAS no extrato bancário
     e não na contabilidade.
   - Lista claramente os movimentos que existem APENAS na contabilidade
     e não no extrato bancário.
   - Para cada um destes, sugere sempre a causa mais provável (ex.: "possível
     cheque ainda não compensado", "possível comissão bancária ainda não
     contabilizada", "possível erro de digitação: 1.250,00 € vs 1.520,00 €").
   - Calcula o saldo reconciliado final e indica se bate certo com o saldo
     do extrato bancário e o saldo contabilístico (campo "closes").

4. EXPLICAR DE FORMA DIDÁTICA
   - Escreve um resumo executivo (2 a 4 frases), em português claro e direto,
     como se estivesses a explicar a outro contabilista (ou a alguém que
     ainda está a aprender) o que encontraste e o que precisa de ser feito.
   - Usa linguagem simples, sem jargão desnecessário. Quando usares um termo
     técnico (ex.: "cheque em trânsito"), explica-o brevemente.
   - Numa lista de próximos passos, indica o que o contabilista deve
     verificar ou corrigir, por ordem de prioridade.

## REGRAS IMPORTANTES

- NUNCA inventes valores, datas ou descrições que não constem dos documentos.
  Se um PDF estiver ilegível, incompleto ou com informação em falta, regista
  isso explicitamente no campo "issues" em vez de assumires ou inventares.
- Sê rigoroso com os sinais (débito/crédito) — este é o erro mais comum em
  reconciliações e pode inverter completamente a análise.
- Mantém sempre um tom profissional, rigoroso mas acessível — o objetivo é
  que um contabilista consiga, em poucos segundos, perceber exatamente o
  que falta corrigir.
- Não repitas o mesmo movimento mais do que uma vez, mesmo que o layout do
  documento pareça sugerir isso — cada linha da tabela é um movimento.

## FORMATO DE OUTPUT

Responde em português de Portugal, preenchendo exatamente o schema
estruturado fornecido (não texto livre em Markdown) — a aplicação usa estes
campos para desenhar o ecrã de resultados e para a exportação para Excel.
Mantém os dados de cada lista bem estruturados e consistentes (mesmo
formato de data "YYYY-MM-DD", valores numéricos com sinal).`;

const TxSchema = z.object({
  date: z.string().describe("Data no formato YYYY-MM-DD"),
  description: z.string(),
  amount: z.number().describe("Valor com sinal, perspetiva da conta bancária (negativo = saída, positivo = entrada)"),
});

const ReportSchema = z.object({
  documentsReadable: z.boolean().describe("false se algum dos PDFs estiver ilegível, incompleto, ou não parecer um extrato financeiro"),
  issues: z.array(z.string()).describe("Problemas encontrados na leitura dos documentos (vazio se não houver nenhum)"),
  bankBalance: z.number().nullable().describe("Saldo final do extrato bancário, se indicado no documento"),
  accountingBalance: z.number().nullable().describe("Saldo final do extrato contabilístico, se indicado no documento"),
  difference: z.number().nullable().describe("bankBalance - accountingBalance"),
  closes: z.boolean().describe("true se a reconciliação fecha (a diferença está totalmente explicada pelos movimentos pendentes de um lado ou outro)"),
  summary: z.string().describe("Resumo executivo: 2 a 4 frases sobre saldo bancário, saldo contabilístico, diferença total, e se a reconciliação fecha"),
  reconciled: z.array(TxSchema).describe("Movimentos que correspondem claramente entre os dois extratos, sem qualquer dúvida (mesma data, mesmo valor)"),
  probableMatches: z
    .array(
      z.object({
        bank: TxSchema,
        accounting: TxSchema,
        confidence: z.number().describe("0 a 100"),
        reason: z.string().describe("Porque não há certeza absoluta ou qual a diferença encontrada (valor/data/descrição)"),
      })
    )
    .describe("Pares que provavelmente correspondem ao mesmo movimento mas com alguma incerteza ou diferença de valor/data — 'Diferenças em movimentos correspondentes'"),
  bankOnly: z
    .array(TxSchema.extend({ observation: z.string().describe("Hipótese explicativa mais provável para este movimento não ter correspondência") }))
    .describe("Movimentos que existem apenas no extrato bancário"),
  accountingOnly: z
    .array(TxSchema.extend({ observation: z.string().describe("Hipótese explicativa mais provável para este movimento não ter correspondência") }))
    .describe("Movimentos que existem apenas na contabilidade"),
  nextSteps: z.array(z.string()).describe("Passos recomendados ao contabilista, por ordem de prioridade"),
});

export type ReconciliationReport = z.infer<typeof ReportSchema>;

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

export async function analyzeReconciliation(bankPdfBase64: string, accountingPdfBase64: string): Promise<ReconciliationReport> {
  const response = await client().messages.parse({
    model: "claude-opus-5",
    max_tokens: 24000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Documento 1 — Extrato Bancário:" },
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: bankPdfBase64 } },
          { type: "text", text: "Documento 2 — Extrato Contabilístico:" },
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: accountingPdfBase64 } },
          { type: "text", text: "Faz a reconciliação bancária completa destes dois documentos, seguindo rigorosamente as tuas instruções." },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(ReportSchema) },
  });

  if (!response.parsed_output) {
    throw new Error("Não foi possível gerar a reconciliação.");
  }
  return response.parsed_output;
}
