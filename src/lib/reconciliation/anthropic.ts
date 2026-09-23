import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { MODEL } from "./config";

// Só o que precisamos do cliente: permite injetar um falso nos testes.
export type ModelClient = Pick<Anthropic, "messages">;

let _client: Anthropic | null = null;
export function getClient(): ModelClient {
  if (!_client) _client = new Anthropic();
  return _client;
}

export type Content = Anthropic.Messages.ContentBlockParam[];

// Chamada única ao modelo com saída estruturada validada pelo schema zod.
// Streaming: com max_tokens altos o SDK recusa pedidos não-streaming.
export async function callStructured<S extends z.ZodType>(opts: {
  client?: ModelClient;
  label: string;
  system: string;
  content: Content;
  schema: S;
  maxTokens: number;
}): Promise<z.infer<S>> {
  const client = opts.client ?? getClient();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: opts.maxTokens,
    temperature: 0,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.content }],
    output_config: { format: zodOutputFormat(opts.schema) },
  });
  const response = await stream.finalMessage();

  const usage = response.usage;
  console.log(
    `[reconciliation] step=${opts.label} model=${MODEL} ` +
      `input_tokens=${usage.input_tokens} output_tokens=${usage.output_tokens} ` +
      `cache_creation_input_tokens=${usage.cache_creation_input_tokens ?? 0} cache_read_input_tokens=${usage.cache_read_input_tokens ?? 0}`
  );

  if (response.stop_reason === "max_tokens") {
    throw new Error(`A resposta do passo "${opts.label}" foi cortada (max_tokens).`);
  }
  const parsed = response.parsed_output as z.infer<S> | null;
  if (!parsed) throw new Error(`Sem resposta estruturada no passo "${opts.label}".`);
  return parsed;
}
