import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { extractText, getDocumentProxy } from "unpdf";

// Modelo usado nas chamadas de reconciliação. Trocar aqui para testar outro
// modelo (ex.: "claude-opus-5", "claude-sonnet-5"). Decisão consciente de
// usar só o Haiku: exige PDFs de texto dos clientes (não escaneados) para
// ter uma leitura fiável — em teste com um PDF escaneado o Haiku deu
// resultados de reconciliação inconsistentes entre execuções idênticas.
const MODEL = "claude-haiku-4-5-20251001";

// Abaixo deste número de carateres, o texto extraído do PDF é considerado
// "vazio" (ex.: PDF escaneado sem camada de texto) e cai-se para o envio do
// PDF original como documento.
const MIN_EXTRACTED_CHARS = 40;

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
     contabilizada", "possível erro de digitação: 1.250,00 € vs 1.520,00 €")
     E classifica-o também numa das categorias fixas do schema — a que
     melhor descrever a causa mais provável; usa "outro" só quando nenhuma
     das restantes categorias se aplicar.
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

// Categorias fechadas para movimentos sem correspondência — permitem
// agrupar e subtotalizar "Só no Banco" / "Só na Contabilidade" no ecrã e no
// Excel, além da explicação em texto livre ("observation") já existente.
const UNMATCHED_CATEGORIES = [
  "cheque_em_transito",
  "deposito_em_transito",
  "debito_nao_registado",
  "comissao_juro_bancario",
  "erro_transcricao",
  "duplicado",
  "outro",
] as const;
export type UnmatchedCategory = (typeof UNMATCHED_CATEGORIES)[number];

const UnmatchedCategorySchema = z
  .enum(UNMATCHED_CATEGORIES)
  .describe(
    "cheque_em_transito: cheque emitido mas ainda não compensado; " +
      "deposito_em_transito: depósito/transferência a caminho mas ainda não visível no outro extrato; " +
      "debito_nao_registado: débito direto ou pagamento que o banco já processou mas a contabilidade ainda não lançou; " +
      "comissao_juro_bancario: comissão, imposto de selo ou juro bancário ainda não lançado na contabilidade; " +
      "erro_transcricao: valor ou data foram registados de forma diferente nos dois documentos (provável erro de digitação); " +
      "duplicado: o mesmo movimento parece estar lançado mais do que uma vez; " +
      "outro: nenhuma das categorias anteriores se aplica"
  );

const TxSchema = z.object({
  // Formato reforçado (em vez de apenas z.string()): o zodOutputFormat
  // valida a resposta do modelo contra este schema e rejeita-a (lança erro)
  // se uma data não bater certo — falha aqui, de forma explícita, em vez de
  // a gravação na base de dados (que insere tudo em bloco) rejeitar
  // silenciosamente TODAS as transações por causa de uma única data má.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Data no formato YYYY-MM-DD"),
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
        confidence: z.number().describe("Pontuação de confiança em percentagem, um número inteiro de 0 a 100 (ex.: 92 — nunca uma fração como 0.92)"),
        reason: z.string().describe("Porque não há certeza absoluta ou qual a diferença encontrada (valor/data/descrição)"),
      })
    )
    .describe("Pares que provavelmente correspondem ao mesmo movimento mas com alguma incerteza ou diferença de valor/data — 'Diferenças em movimentos correspondentes'"),
  bankOnly: z
    .array(
      TxSchema.extend({
        category: UnmatchedCategorySchema,
        observation: z.string().describe("Hipótese explicativa mais provável para este movimento não ter correspondência"),
      })
    )
    .describe("Movimentos que existem apenas no extrato bancário"),
  accountingOnly: z
    .array(
      TxSchema.extend({
        category: UnmatchedCategorySchema,
        observation: z.string().describe("Hipótese explicativa mais provável para este movimento não ter correspondência"),
      })
    )
    .describe("Movimentos que existem apenas na contabilidade"),
  nextSteps: z.array(z.string()).describe("Passos recomendados ao contabilista, por ordem de prioridade"),
});

export type ReconciliationReport = z.infer<typeof ReportSchema>;

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

type DocumentInput = { block: Anthropic.Messages.ContentBlockParam; mode: "text" | "pdf" };

// Tenta extrair o texto do PDF localmente (mais barato em tokens do que
// enviar o PDF como documento, que a Claude processa também como imagem por
// página). Se a extração falhar ou não vier texto (indício de PDF
// escaneado), cai-se para o envio do PDF original como fallback.
async function toDocumentInput(pdfBase64: string): Promise<DocumentInput> {
  try {
    const buffer = Buffer.from(pdfBase64, "base64");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    if (text.trim().length >= MIN_EXTRACTED_CHARS) {
      return { block: { type: "text", text }, mode: "text" };
    }
  } catch {
    // extração falhou — segue para o fallback de documento/imagem abaixo
  }
  return {
    block: { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
    mode: "pdf",
  };
}

export async function analyzeReconciliation(bankPdfBase64: string, accountingPdfBase64: string): Promise<ReconciliationReport> {
  const [bank, accounting] = await Promise.all([toDocumentInput(bankPdfBase64), toDocumentInput(accountingPdfBase64)]);

  // Streaming (em vez de .parse() não-streaming): com um max_tokens alto,
  // o SDK recusa o pedido não-streaming por poder ultrapassar o tempo
  // limite do HTTP — ver "128K output tokens" nas notas da API do Claude.
  const stream = client().messages.stream({
    model: MODEL,
    max_tokens: 64000,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Documento 1 — Extrato Bancário:" },
          bank.block,
          { type: "text", text: "Documento 2 — Extrato Contabilístico:" },
          accounting.block,
          { type: "text", text: "Faz a reconciliação bancária completa destes dois documentos, seguindo rigorosamente as tuas instruções." },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(ReportSchema) },
  });

  const response = await stream.finalMessage();

  const usage = response.usage;
  console.log(
    `[reconciliation] model=${MODEL} bank_input=${bank.mode} accounting_input=${accounting.mode} ` +
      `input_tokens=${usage.input_tokens} output_tokens=${usage.output_tokens} ` +
      `cache_creation_input_tokens=${usage.cache_creation_input_tokens ?? 0} cache_read_input_tokens=${usage.cache_read_input_tokens ?? 0}`
  );

  if (!response.parsed_output) {
    throw new Error("Não foi possível gerar a reconciliação.");
  }
  return response.parsed_output;
}
