import { config } from "../config.js";
import { submitJob } from "../bridge/queue.js";
import { buildFlatPrompt, parseJsonLoose } from "./prompt_builder.js";

/**
 * LLM provider backed by the Claude Code session the user is already chatting
 * with ("agent bridge"). Nothing is spawned and no API key is used: each stage
 * is published as a job in bridge/queue/, the session picks it up in the
 * background, does the work (Read on the screenshots/PDFs, WebSearch for the
 * company research, reasoning, JSON output) and writes the answer back.
 *
 * Same contract as every other provider: complete() resolves with {data, text}
 * where data is validated against the stage's Zod schema, with one repair round
 * trip when the answer does not conform.
 */

const STAGE_TITLES = {
  job_parser: "Lecture de l'offre (screenshots)",
  company_researcher: "Recherche entreprise",
  recruiting_modeler: "Thèse de recrutement",
  opportunity_scorer: "Score d'opportunité",
  cv_extractor: "Evidence Bank (CV)",
  requirement_mapper: "Mapping requirements → preuves",
  cv_evaluator: "Évaluation du CV",
  adversarial_reviewer: "Revue adversariale",
  competitive_benchmark: "Benchmark concurrentiel",
  letter_evaluator: "Analyse de la lettre",
  improvement_planner: "Plan d'amélioration",
  cv_optimizer: "CV optimisé",
  letter_optimizer: "Lettre optimisée",
  quality_controller: "Contrôle qualité",
  version_comparator: "Comparaison de versions",
  company_research_search: "Recherche web entreprise",
};

function answerToText(payload) {
  if (payload === null || payload === undefined) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload.text === "string" && Object.keys(payload).length === 1) return payload.text;
  return JSON.stringify(payload);
}

async function completeClaudeSession({ stage = "task", system, messages, schema, webSearch = false, appId = null, version = null, log = () => {} }) {
  let schemaError = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const { prompt, files, jsonSchema } = buildFlatPrompt({ system, messages, schema, schemaError });
    const { promise } = submitJob({
      kind: "stage",
      stage,
      title: STAGE_TITLES[stage] || stage,
      appId,
      version,
      prompt,
      schema: jsonSchema,
      files,
      webSearch,
      attempt,
      timeoutMs: config.claudeSessionTimeoutMs,
      log,
    });

    const payload = await promise;
    if (!schema) return { text: answerToText(payload) };

    try {
      const raw = typeof payload === "string" ? parseJsonLoose(payload) : payload;
      const data = schema.parse(raw);
      return { data, text: JSON.stringify(raw) };
    } catch (error) {
      schemaError = String(error.message || error).slice(0, 2000);
      log(`réponse non conforme au schéma (tentative ${attempt}/2) : ${schemaError.slice(0, 200)}`);
      if (attempt === 2) {
        throw new Error(`La session Claude n'a pas produit de JSON conforme après 2 tentatives : ${schemaError.slice(0, 300)}`);
      }
    }
  }
}

export const claudeSessionProvider = {
  name: "claude-session",
  complete: completeClaudeSession,
};
