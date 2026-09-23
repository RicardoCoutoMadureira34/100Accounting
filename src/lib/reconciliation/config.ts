// Modelo único usado em todas as chamadas (leitura dos extratos e texto do
// relatório). Os clientes enviam apenas PDFs de texto, por isso o Haiku chega.
// Nota: `temperature: 0` só é aceite por modelos que ainda suportam
// parâmetros de amostragem (Haiku 4.5 sim; Sonnet 5 / Opus 5 devolvem 400).
export const MODEL = "claude-haiku-4-5-20251001";

// PDFs digitalizados (sem camada de texto) são rejeitados com uma mensagem
// clara. Pôr a true envia-os ao modelo como documento/imagem (leitura pior).
export const ALLOW_SCANNED_PDFS = false;

// Abaixo deste número de carateres úteis (sem marcadores de página) o PDF é
// considerado digitalizado.
export const MIN_EXTRACTED_CHARS = 40;

// ---------- Emparelhamento ----------

// Mesmo valor mas datas mais afastadas do que isto passa a "provável".
export const DATE_TOLERANCE_DAYS = 7;

// Valor "quase igual": diferença até 1 € (em cêntimos).
export const NEAR_VALUE_CENTS = 100;

// Janela máxima de datas para propor pares por valor quase igual / dígitos
// trocados (valores diferentes exigem movimentos próximos no tempo).
export const NEAR_DATE_WINDOW_DAYS = 31;

// Um-para-vários: nº de movimentos por grupo e candidatos avaliados.
export const MIN_GROUP_SIZE = 2;
export const MAX_GROUP_SIZE = 5;
export const MAX_GROUP_CANDIDATES = 40;

// A contabilidade "usa data de fim de mês" quando pelo menos esta fração
// dos lançamentos (mínimo de linhas) está datada no último dia do mês.
export const MONTH_END_MIN_SHARE = 0.6;
export const MONTH_END_MIN_LINES = 3;

// ---------- Indicações para os movimentos sem correspondência ----------

// Duplicado: mesmo valor, datas até este nº de dias e descrição semelhante a
// outro movimento do mesmo lado que já foi reconciliado.
export const DUPLICATE_DATE_WINDOW_DAYS = 3;
export const DUPLICATE_MIN_SIMILARITY = 0.7;

// Período anterior: nº máximo de movimentos que, somados, explicam a diferença
// de saldos iniciais.
export const PRIOR_PERIOD_MAX_GROUP = 3;
