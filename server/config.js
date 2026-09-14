import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, "..");
export const APPLICATIONS_DIR = path.join(ROOT_DIR, "applications");
export const PROMPTS_DIR = path.join(here, "prompts");
export const WEB_DIR = path.join(ROOT_DIR, "web");

dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/** Detect the local `claude` CLI (Claude Code) once at startup. */
function detectClaudeCli() {
  if ((process.env.CLAUDE_CLI_DISABLED || "").toLowerCase() === "true") return false;
  try {
    const result = spawnSync("claude", ["--version"], { shell: true, timeout: 20000, encoding: "utf8" });
    return result.status === 0 && /claude code/i.test(result.stdout || "");
  } catch {
    return false;
  }
}

const claudeCliAvailable = detectClaudeCli();

export const PROVIDERS = ["claude-session", "claude-cli", "anthropic", "mock"];

/**
 * Provider resolution.
 * Default (no LLM_PROVIDER or "auto"): claude-session — the Claude Code session
 * the user is chatting with runs every stage through the agent bridge (no API
 * key, no sub-process). Then claude-cli (headless `claude -p`), then the
 * Anthropic API (if a key is set), then mock.
 * An explicit choice is honored, with graceful fallback when its prerequisite is missing.
 */
function resolveLlmProvider(requestedRaw) {
  const requested = (requestedRaw || "auto").toLowerCase();
  let provider;
  let note = "";
  if (requested === "mock") {
    provider = "mock";
  } else if (requested === "claude-session") {
    // Always available: it only needs a Claude Code session running `npm run bridge`.
    provider = "claude-session";
  } else if (requested === "anthropic") {
    if (hasKey) provider = "anthropic";
    else if (claudeCliAvailable) {
      provider = "claude-cli";
      note = "LLM_PROVIDER=anthropic mais aucune clé API : bascule sur la CLI claude locale.";
    } else {
      provider = "claude-session";
      note = "LLM_PROVIDER=anthropic mais aucune clé API : bascule sur le pont session Claude.";
    }
  } else if (requested === "claude-cli") {
    if (claudeCliAvailable) provider = "claude-cli";
    else {
      provider = hasKey ? "anthropic" : "claude-session";
      note = `LLM_PROVIDER=claude-cli mais la CLI claude est introuvable : bascule sur ${provider}.`;
    }
  } else {
    // auto
    provider = "claude-session";
  }
  return { provider, note, requested };
}

function resolveResearchProvider(llmProvider) {
  const requested = (process.env.RESEARCH_PROVIDER || "auto").toLowerCase();
  if (requested === "none") return "none";
  // Web research runs through the active LLM provider (API web-search tool, or
  // the WebSearch tool of the Claude session). Mock mode has no real research.
  return llmProvider === "mock" ? "none" : llmProvider;
}

const llm = resolveLlmProvider(process.env.LLM_PROVIDER);

export const config = {
  port: Number(process.env.PORT || 3777),
  hasApiKey: hasKey,
  claudeCliAvailable,
  llmProvider: llm.provider,
  llmProviderRequested: llm.requested,
  providerNote: llm.note,
  researchProvider: resolveResearchProvider(llm.provider),
  // Anthropic API settings
  model: process.env.LLM_MODEL || "claude-opus-5",
  effort: process.env.LLM_EFFORT || "high",
  enableFallbacks: (process.env.LLM_FALLBACKS || "true").toLowerCase() !== "false",
  // Claude CLI settings
  claudeCliModel: process.env.CLAUDE_CLI_MODEL || "", // empty = CLI's own default model
  claudeCliTimeoutMs: Number(process.env.CLAUDE_CLI_TIMEOUT_MS || 900000),
  claudeCliConcurrency: Math.max(1, Number(process.env.CLAUDE_CLI_CONCURRENCY || 2)),
  // Agent bridge (claude-session) settings
  claudeSessionTimeoutMs: Number(process.env.CLAUDE_SESSION_TIMEOUT_MS || 45 * 60 * 1000),
};

/**
 * Switch engine at runtime (from the UI) — every stage reads the provider at
 * call time, so no restart is needed.
 */
export function setLlmProvider(requested) {
  if (!PROVIDERS.includes(requested) && requested !== "auto") {
    throw new Error(`Moteur inconnu : ${requested} (valeurs : auto, ${PROVIDERS.join(", ")}).`);
  }
  const next = resolveLlmProvider(requested);
  config.llmProvider = next.provider;
  config.llmProviderRequested = next.requested;
  config.providerNote = next.note;
  config.researchProvider = resolveResearchProvider(next.provider);
  return config;
}
