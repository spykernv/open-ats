import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { config } from "../config.js";
import { buildImageContentBlock, buildDocumentContentBlock, isImageFile } from "../extract/files.js";

const client = new Anthropic();

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Convert provider-agnostic {type:"file"} items into API content blocks. */
async function materializeMessages(messages) {
  return Promise.all(
    messages.map(async (message) => {
      if (typeof message.content === "string") return { ...message };
      const content = await Promise.all(
        message.content.map(async (item) => {
          if (item.type !== "file") return item;
          return isImageFile(item.path)
            ? buildImageContentBlock(item.path)
            : buildDocumentContentBlock(item.path, item.label);
        }),
      );
      return { ...message, content };
    }),
  );
}

function extractText(message) {
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function parseJsonLoose(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Strip markdown fences if present, or grab the outermost JSON object.
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return JSON.parse(fenced[1].trim());
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("No JSON object found in model response");
  }
}

/**
 * Single entry point for all LLM calls.
 * - schema (zod): structured output enforced via output_config.format, returns the parsed object.
 * - tools: raw server-tool definitions (e.g. web_search). Never combined with schema by callers.
 * - Streaming is always used (long outputs), pause_turn is resumed, refusal fallbacks are on by default.
 */
async function completeAnthropic({
  system,
  messages,
  schema,
  schemaName,
  webSearch = false,
  maxTokens = 32000,
  effort,
  log = () => {},
}) {
  if (schema && webSearch) {
    throw new Error("Do not combine structured output format with server tools; split into two calls.");
  }
  const tools = webSearch ? [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }] : undefined;

  const baseParams = {
    model: config.model,
    max_tokens: maxTokens,
    system,
    messages: await materializeMessages(messages),
    output_config: {
      effort: effort || config.effort,
      ...(schema ? { format: zodOutputFormat(schema, schemaName || "result") } : {}),
    },
    ...(tools ? { tools } : {}),
  };

  let useFallbacks = config.enableFallbacks;
  let pauseResumes = 0;

  for (;;) {
    let stream;
    try {
      stream = useFallbacks
        ? client.beta.messages.stream({ ...baseParams, betas: [FALLBACK_BETA], fallbacks: "default" })
        : client.messages.stream(baseParams);
      const message = await stream.finalMessage();

      if (message.stop_reason === "pause_turn") {
        if (++pauseResumes > 8) throw new Error("Too many pause_turn resumes; aborting stage.");
        log(`pause_turn received, resuming (${pauseResumes})`);
        baseParams.messages.push({ role: "assistant", content: message.content });
        continue;
      }
      if (message.stop_reason === "refusal") {
        const details = message.stop_details
          ? ` (category: ${message.stop_details.category ?? "unknown"})`
          : "";
        throw new Error(`Model refused the request${details}. This should not happen for CV analysis; check the inputs.`);
      }
      if (message.stop_reason === "max_tokens") {
        throw new Error("Model response hit max_tokens; the output was truncated. Increase maxTokens for this stage.");
      }

      const usage = message.usage;
      log(
        `LLM call done (in: ${usage.input_tokens}, out: ${usage.output_tokens}, model: ${message.model})`,
      );

      const text = extractText(message);
      if (!schema) return { text, message };

      const parsed = schema.parse(parseJsonLoose(text));
      return { data: parsed, text, message };
    } catch (error) {
      // If the beta fallback parameters are rejected (e.g. unavailable on this account),
      // retry once without them rather than failing the whole pipeline.
      if (useFallbacks && error instanceof Anthropic.BadRequestError) {
        log(`Fallback params rejected (${error.message}); retrying without server-side fallbacks.`);
        useFallbacks = false;
        continue;
      }
      throw error;
    }
  }
}

export const anthropicProvider = {
  name: "anthropic",
  complete: completeAnthropic,
};
