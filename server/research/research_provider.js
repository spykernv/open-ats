import { config } from "../config.js";
import { getLlmProvider } from "../llm/provider.js";
import { loadPrompt } from "../pipeline/prompts.js";

/**
 * Research provider abstraction.
 * Web research runs through the active LLM provider's web-search capability:
 * - "anthropic": the API's server-side web_search tool;
 * - "claude-cli": Claude Code's built-in WebSearch/WebFetch tools (subscription session);
 * - "none": no research available; the pipeline degrades honestly.
 * Plug a different engine (MCP, SerpAPI...) by adding a provider implementing
 * `research({ job, log }) -> memo string | null`.
 */

const llmResearch = {
  get name() {
    return `${config.llmProvider}_web_search`;
  },
  async research({ job, log, appId = null, version = null }) {
    const llm = getLlmProvider();
    const { text } = await llm.complete({
      stage: "company_research_search",
      system: loadPrompt("company_research_search"),
      messages: [
        {
          role: "user",
          content: `Voici l'offre VIE normalisée (JSON) :\n\n${JSON.stringify(job, null, 2)}\n\nEffectue la recherche entreprise et rédige le mémo structuré.`,
        },
      ],
      webSearch: true,
      maxTokens: 16000,
      appId,
      version,
      log,
    });
    return text;
  },
};

const noneResearch = {
  name: "none",
  async research({ log }) {
    log("research provider: none (no web access configured) — skipping company research");
    return null;
  },
};

export function getResearchProvider() {
  return config.researchProvider === "none" ? noneResearch : llmResearch;
}
