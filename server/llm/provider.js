import { config } from "../config.js";
import { anthropicProvider } from "./anthropic.js";
import { claudeCliProvider } from "./claude_cli.js";
import { claudeSessionProvider } from "./claude_session.js";
import { mockProvider } from "./mock.js";

/**
 * LLM provider abstraction. Swap providers via LLM_PROVIDER in .env or live
 * from the UI (POST /api/settings):
 * - "claude-session": the Claude Code session you are chatting with, through the
 *   agent bridge (default — no API key, no sub-process);
 * - "claude-cli": headless `claude -p` sub-processes (same subscription session);
 * - "anthropic": the Anthropic API (needs ANTHROPIC_API_KEY);
 * - "mock": canned data to test the pipeline.
 * Every pipeline stage calls `llm.complete({stage, system, messages, schema, webSearch, ...})`
 * with provider-agnostic messages: content items are {type:"text"|"file", ...};
 * each provider materializes files its own way (API blocks vs Read tool).
 */
export function getLlmProvider() {
  if (config.llmProvider === "mock") return mockProvider;
  if (config.llmProvider === "claude-session") return claudeSessionProvider;
  if (config.llmProvider === "claude-cli") return claudeCliProvider;
  return anthropicProvider;
}
