import path from "path";
import fs from "fs";
import { getLlmProvider } from "../llm/provider.js";
import { getResearchProvider } from "../research/research_provider.js";
import { loadPrompt } from "./prompts.js";
import {
  JobParseSchema,
  CompanyResearchSchema,
  RecruitingThesisSchema,
  OpportunityScoreSchema,
  EvidenceBankSchema,
  MappingSchema,
  CvEvaluationSchema,
  AdversarialSchema,
  BenchmarkSchema,
  LetterAnalysisSchema,
  ImprovementPlanSchema,
  OptimizedCvSchema,
  OptimizedLetterSchema,
  QualityControlSchema,
  VersionComparisonSchema,
} from "./schemas.js";
import * as store from "../storage/applications.js";
import { extractText, isImageFile, isDocumentFile } from "../extract/files.js";
import { computeVerdict } from "./verdict.js";
import { buildReport } from "./report.js";
import { EXPORTS } from "../exports/documents.js";
import { markdownToPdf } from "../exports/pdf.js";

const running = new Set(); // application ids currently being analyzed

export function isRunning(id) {
  return running.has(id);
}

const STAGE_NAMES = [
  "job",
  "research",
  "thesis",
  "opportunity",
  "evidence_bank",
  "mapping",
  "cv_evaluation",
  "adversarial",
  "benchmark",
  "letter_analysis",
  "improvement_plan",
  "optimized_cv",
  "optimized_letter",
  "quality_control",
  "comparison",
  "report",
];

function jsonBlock(label, data) {
  return `--- ${label} (JSON) ---\n${JSON.stringify(data, null, 2)}`;
}

class PipelineRun {
  constructor(id, version) {
    this.id = id;
    this.version = version;
    this.llm = getLlmProvider();
    this.progress = {
      version,
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      stages: STAGE_NAMES.map((name) => ({ name, status: "pending", error: null })),
    };
  }

  _progressChain = Promise.resolve();

  log = (line) => {
    // fire-and-forget append; log failures must never break the pipeline
    store.appendLog(this.id, this.version, line).catch(() => {});
  };

  async saveProgress() {
    // Serialize writes: parallel stages update progress concurrently and
    // interleaved writeFile calls on the same file could corrupt it.
    this._progressChain = this._progressChain
      .then(() => store.saveStage(this.id, this.version, "progress", this.progress))
      .catch(() => {});
    return this._progressChain;
  }

  async setStage(name, status, error = null) {
    const stage = this.progress.stages.find((s) => s.name === name);
    if (stage) {
      stage.status = status;
      stage.error = error;
    }
    await this.saveProgress();
  }

  /**
   * Run one stage: skip if a cached artifact exists (shared stages across
   * versions), otherwise execute, persist and return the artifact.
   */
  async stage(name, { scope = this.version, reuse = false, skip = false }, fn) {
    if (skip) {
      this.log(`stage ${name}: skipped`);
      await this.setStage(name, "skipped");
      return null;
    }
    if (reuse) {
      const cached = await store.loadStage(this.id, scope, name);
      if (cached && cached.__generated_by === "mock" && this.llm.name !== "mock") {
        // Never let mock artifacts poison a real analysis: recompute.
        this.log(`stage ${name}: cached artifact was generated in mock mode — recomputing with real provider`);
      } else if (cached) {
        this.log(`stage ${name}: reusing existing artifact`);
        await this.setStage(name, "done");
        return cached;
      }
    }
    await this.setStage(name, "running");
    this.log(`stage ${name}: started`);
    try {
      const result = await fn();
      if (result && typeof result === "object" && !Array.isArray(result)) {
        result.__generated_by = this.llm.name;
      }
      await store.saveStage(this.id, scope, name, result);
      await this.setStage(name, "done");
      this.log(`stage ${name}: done`);
      return result;
    } catch (error) {
      await this.setStage(name, "error", String(error.message || error));
      this.log(`stage ${name}: ERROR ${error.stack || error}`);
      throw error;
    }
  }

  async llmStage({ stage, prompt, content, schema, maxTokens }) {
    const { data } = await this.llm.complete({
      stage,
      system: loadPrompt(prompt),
      messages: [{ role: "user", content }],
      schema,
      schemaName: stage,
      maxTokens,
      // Context for engines that surface work in the UI (agent bridge).
      appId: this.id,
      version: this.version,
      log: (l) => this.log(`  [${stage}] ${l}`),
    });
    return data;
  }
}

export async function analyzeApplication(id, version) {
  if (running.has(id)) throw new Error("An analysis is already running for this application.");
  running.add(id);
  const run = new PipelineRun(id, version);
  try {
    await run.saveProgress();
    await store.updateMeta(id, (m) => {
      m.status = "analyzing";
      m.lastError = null;
    });
    await executePipeline(run);
    await store.updateMeta(id, (m) => {
      m.status = "analyzed";
    });
    run.progress.status = "done";
    run.progress.finishedAt = new Date().toISOString();
    await run.saveProgress();
    run.log("pipeline finished successfully");
  } catch (error) {
    // A cancellation is a user decision, not a failure: don't flag the application in red.
    const cancelled = Boolean(error.cancelled);
    run.progress.status = cancelled ? "cancelled" : "error";
    run.progress.error = String(error.message || error);
    run.progress.finishedAt = new Date().toISOString();
    await run.saveProgress().catch(() => {});
    await store
      .updateMeta(id, (m) => {
        m.status = cancelled ? "cancelled" : "error";
        m.lastError = cancelled ? null : String(error.message || error);
      })
      .catch(() => {});
    run.log(cancelled ? `pipeline cancelled: ${error.message}` : `pipeline FAILED: ${error.stack || error}`);
  } finally {
    running.delete(id);
  }
}

async function executePipeline(run) {
  const { id, version } = run;
  const inputs = await store.resolveVersionInputs(id, version);
  const screenshots = inputs.screenshots.filter((f) => isImageFile(f));
  // The posting may also be dropped as a text/PDF export rather than screenshots.
  const jobDocuments = inputs.screenshots.filter((f) => isDocumentFile(f));
  if (!screenshots.length && !jobDocuments.length) {
    throw new Error("Aucune annonce trouvée dans input/job : ajoutez une capture d'écran de l'offre, ou l'annonce en PDF/TXT/MD.");
  }
  if (!inputs.cv) throw new Error("Aucun CV trouvé pour cette version (fichier commençant par 'cv').");
  const hasLetter = Boolean(inputs.letter);

  // ---------- Shared stages (computed once per application, reused across versions) ----------

  const job = await run.stage("job", { scope: "shared", reuse: true }, async () => {
    return run.llmStage({
      stage: "job_parser",
      prompt: "job_parser",
      schema: JobParseSchema,
      maxTokens: 32000,
      content: [
        ...screenshots.map((f, i) => ({ type: "file", path: f, label: `Screenshot de l'offre ${i + 1}/${screenshots.length}` })),
        ...jobDocuments.map((f, i) => ({ type: "file", path: f, label: `Annonce (document) ${i + 1}/${jobDocuments.length}` })),
        {
          type: "text",
          text: `Voici une offre VIE (${[
            screenshots.length ? `${screenshots.length} screenshot(s)` : null,
            jobDocuments.length ? `${jobDocuments.length} document(s)` : null,
          ]
            .filter(Boolean)
            .join(" + ")}). Reconstruis l'annonce, normalise-la et produis la matrice de requirements.`,
        },
      ],
    });
  });

  // Keep dashboard metadata in sync with the parsed job.
  await store.updateMeta(id, (m) => {
    if (job?.job) {
      m.company = job.job.company || m.company;
      m.role = job.job.title || m.role;
      m.location = [job.job.location, job.job.country].filter(Boolean).join(", ") || m.location;
    }
  });

  const research = await run.stage("research", { scope: "shared", reuse: true }, async () => {
    const provider = getResearchProvider();
    run.log(`research provider: ${provider.name}`);
    let memo = null;
    try {
      memo = await provider.research({ job: job.job, log: run.log, appId: id, version });
    } catch (error) {
      // Research failure (network, provider outage) must degrade honestly,
      // not abort the whole pipeline.
      run.log(`research provider FAILED (${error.message}) — continuing without web research`);
      memo = null;
    }
    if (memo) {
      const memoPath = path.join(store.paths.researchDir(id), "company_research_memo.md");
      await fs.promises.mkdir(path.dirname(memoPath), { recursive: true });
      await fs.promises.writeFile(memoPath, memo, "utf8");
    }
    if (memo === null && run.llm.name === "mock") {
      memo = "[MOCK] Mémo de recherche fictif pour tester la pipeline.";
    }
    if (memo === null) {
      // Honest degradation: no web research available.
      return {
        company_name: job.job.company || "",
        overview: "Recherche web non disponible (aucun provider de recherche configuré).",
        products_and_markets: "Recherche non disponible.",
        recent_situation: "Recherche non disponible.",
        presence_in_vie_country: "Recherche non disponible.",
        why_this_mission_exists:
          "Hypothèse basée uniquement sur l'annonce : " + (job.job.responsibilities?.[0] || "non déterminable."),
        stated_values: "Recherche non disponible.",
        findings: [],
        sources: [],
        research_available: false,
      };
    }
    const structured = await run.llmStage({
      stage: "company_researcher",
      prompt: "company_researcher",
      schema: CompanyResearchSchema,
      maxTokens: 16000,
      content: `${jsonBlock("Offre normalisée", job.job)}\n\n--- Mémo de recherche ---\n${memo}`,
    });
    // Also persist a readable markdown version alongside the JSON.
    const md = `# Company research — ${structured.company_name}\n\n${structured.overview}\n\n## Findings\n${structured.findings.map((f) => `- [${f.confidence}] ${f.statement} (${f.source})`).join("\n")}\n\n## Sources\n${structured.sources.map((s) => `- ${s}`).join("\n")}`;
    await fs.promises.mkdir(store.paths.researchDir(id), { recursive: true });
    await fs.promises.writeFile(path.join(store.paths.researchDir(id), "company_research.md"), md, "utf8");
    return structured;
  });

  const thesis = await run.stage("thesis", { scope: "shared", reuse: true }, () =>
    run.llmStage({
      stage: "recruiting_modeler",
      prompt: "recruiting_modeler",
      schema: RecruitingThesisSchema,
      maxTokens: 16000,
      content: `${jsonBlock("Offre normalisée + requirements", job)}\n\n${jsonBlock("Recherche entreprise", research)}`,
    }),
  );

  const opportunity = await run.stage("opportunity", { scope: "shared", reuse: true }, async () => {
    const data = await run.llmStage({
      stage: "opportunity_scorer",
      prompt: "opportunity_scorer",
      schema: OpportunityScoreSchema,
      maxTokens: 16000,
      content: `${jsonBlock("Offre normalisée + requirements", job)}\n\n${jsonBlock("Recherche entreprise", research)}\n\n${jsonBlock("Thèse de recrutement", thesis)}`,
    });
    // The tier is a deterministic function of the score — enforce it in code
    // so an inconsistent LLM tier cannot contradict the displayed thresholds.
    data.tier =
      data.score >= 90 ? "EXCEPTIONAL" : data.score >= 80 ? "STRONG" : data.score >= 70 ? "WORTH_APPLYING" : data.score >= 60 ? "OPTIONAL" : "LOW_PRIORITY";
    return data;
  });

  // ---------- Version-specific stages ----------

  const evidenceBank = await run.stage("evidence_bank", {}, async () => {
    return run.llmStage({
      stage: "cv_extractor",
      prompt: "cv_extractor",
      schema: EvidenceBankSchema,
      maxTokens: 32000,
      content: [
        { type: "file", path: inputs.cv, label: "CV du candidat" },
        { type: "text", text: "Extrais l'Evidence Bank complète de ce CV." },
      ],
    });
  });

  const mapping = await run.stage("mapping", {}, () =>
    run.llmStage({
      stage: "requirement_mapper",
      prompt: "requirement_mapper",
      schema: MappingSchema,
      maxTokens: 32000,
      content: `${jsonBlock("Requirements de l'offre", job.requirements)}\n\n${jsonBlock("Evidence Bank", evidenceBank)}`,
    }),
  );

  const evaluation = await run.stage("cv_evaluation", {}, () =>
    run.llmStage({
      stage: "cv_evaluator",
      prompt: "cv_evaluator",
      schema: CvEvaluationSchema,
      maxTokens: 32000,
      content: `${jsonBlock("Offre + requirements", job)}\n\n${jsonBlock("Thèse de recrutement", thesis)}\n\n${jsonBlock("Evidence Bank", evidenceBank)}\n\n${jsonBlock("Mapping requirement → evidence", mapping)}`,
    }),
  );

  // Independent evaluations can run concurrently.
  const [adversarial, benchmark, letterAnalysis] = await Promise.all([
    run.stage("adversarial", {}, () =>
      run.llmStage({
        stage: "adversarial_reviewer",
        prompt: "adversarial_reviewer",
        schema: AdversarialSchema,
        maxTokens: 16000,
        content: `${jsonBlock("Offre + requirements", job)}\n\n${jsonBlock("Evidence Bank", evidenceBank)}\n\n${jsonBlock("Mapping", mapping)}\n\n${jsonBlock("Évaluation CV", evaluation)}`,
      }),
    ),
    run.stage("benchmark", {}, () =>
      run.llmStage({
        stage: "competitive_benchmark",
        prompt: "competitive_benchmark",
        schema: BenchmarkSchema,
        maxTokens: 16000,
        content: `${jsonBlock("Offre + requirements", job)}\n\n${jsonBlock("Thèse", thesis)}\n\n${jsonBlock("Evidence Bank", evidenceBank)}\n\n${jsonBlock("Mapping", mapping)}\n\n${jsonBlock("Évaluation CV", evaluation)}`,
      }),
    ),
    run.stage("letter_analysis", { skip: !hasLetter }, async () => {
      return run.llmStage({
        stage: "letter_evaluator",
        prompt: "letter_evaluator",
        schema: LetterAnalysisSchema,
        maxTokens: 16000,
        content: [
          { type: "file", path: inputs.letter, label: "Lettre de motivation" },
          {
            type: "text",
            text: `${jsonBlock("Offre + requirements", job)}\n\n${jsonBlock("Recherche entreprise", research)}\n\n${jsonBlock("Thèse", thesis)}\n\n${jsonBlock("Evidence Bank", evidenceBank)}\n\nÉvalue cette lettre de motivation.`,
          },
        ],
      });
    }),
  ]);

  const plan = await run.stage("improvement_plan", {}, () =>
    run.llmStage({
      stage: "improvement_planner",
      prompt: "improvement_planner",
      schema: ImprovementPlanSchema,
      maxTokens: 32000,
      content: `${jsonBlock("Offre + requirements", job)}\n\n${jsonBlock("Recherche entreprise", research)}\n\n${jsonBlock("Thèse", thesis)}\n\n${jsonBlock("Evidence Bank", evidenceBank)}\n\n${jsonBlock("Mapping", mapping)}\n\n${jsonBlock("Évaluation CV", evaluation)}\n\n${jsonBlock("Revue adversariale", adversarial)}\n\n${jsonBlock("Benchmark concurrentiel", benchmark)}\n\n${jsonBlock("Analyse de la lettre", letterAnalysis || { note: "aucune lettre fournie" })}`,
    }),
  );

  // ---------- Optimization + quality control (with one blocking-issue retry) ----------

  const cvBlockForOpt = { type: "file", path: inputs.cv, label: "CV original du candidat" };
  const letterBlockForOpt = hasLetter ? { type: "file", path: inputs.letter, label: "Lettre originale" } : null;

  const optimizeCv = (qcFeedback) =>
    run.llmStage({
      stage: "cv_optimizer",
      prompt: "cv_optimizer",
      schema: OptimizedCvSchema,
      maxTokens: 32000,
      content: [
        cvBlockForOpt,
        {
          type: "text",
          text: `${jsonBlock("Evidence Bank", evidenceBank)}\n\n${jsonBlock("Requirements", job.requirements)}\n\n${jsonBlock("Plan d'amélioration", plan)}${
            qcFeedback ? `\n\n${jsonBlock("PROBLÈMES BLOQUANTS détectés par le contrôle qualité — à corriger impérativement", qcFeedback)}` : ""
          }\n\nProduis le CV optimisé.`,
        },
      ],
    });

  const optimizeLetter = (qcFeedback) =>
    run.llmStage({
      stage: "letter_optimizer",
      prompt: "letter_optimizer",
      schema: OptimizedLetterSchema,
      maxTokens: 16000,
      content: [
        ...(letterBlockForOpt ? [letterBlockForOpt] : []),
        {
          type: "text",
          text: `${jsonBlock("Offre", job.job)}\n\n${jsonBlock("Recherche entreprise", research)}\n\n${jsonBlock("Thèse", thesis)}\n\n${jsonBlock("Evidence Bank", evidenceBank)}\n\n${jsonBlock("Analyse de la lettre", letterAnalysis || { note: "aucune lettre fournie" })}\n\n${jsonBlock("Plan d'amélioration", plan)}${
            qcFeedback ? `\n\n${jsonBlock("PROBLÈMES BLOQUANTS détectés par le contrôle qualité — à corriger impérativement", qcFeedback)}` : ""
          }\n\nProduis la lettre optimisée finale.`,
        },
      ],
    });

  // The letter is optimized even when no original letter was provided:
  // the optimizer then writes one from scratch, grounded in the Evidence Bank.
  let optimizedCv = await run.stage("optimized_cv", {}, () => optimizeCv(null));
  let optimizedLetter = await run.stage("optimized_letter", {}, () => optimizeLetter(null));

  const runQualityControl = async () => {
    const [cvText, letterText] = await Promise.all([
      extractText(inputs.cv).catch(() => "(extraction du CV impossible)"),
      hasLetter ? extractText(inputs.letter).catch(() => "(extraction de la lettre impossible)") : Promise.resolve("(aucune lettre fournie)"),
    ]);
    return run.llmStage({
      stage: "quality_controller",
      prompt: "quality_controller",
      schema: QualityControlSchema,
      maxTokens: 16000,
      content: `${jsonBlock("Evidence Bank", evidenceBank)}\n\n--- CV ORIGINAL (texte extrait) ---\n${cvText}\n\n--- LETTRE ORIGINALE (texte extrait) ---\n${letterText}\n\n${jsonBlock("CV OPTIMISÉ", optimizedCv)}\n\n${jsonBlock("LETTRE OPTIMISÉE", optimizedLetter || { note: "aucune lettre" })}\n\nContrôle l'intégrité des versions optimisées.`,
    });
  };

  let qualityControl = await run.stage("quality_control", {}, runQualityControl);

  const blocking = (qualityControl.issues || []).filter((i) => i.blocking);
  if (qualityControl.verdict === "FAIL" && blocking.length) {
    run.log(`quality control FAILED with ${blocking.length} blocking issue(s) — regenerating optimized versions once`);
    await run.setStage("optimized_cv", "running");
    optimizedCv = await optimizeCv(blocking);
    optimizedCv.__generated_by = run.llm.name;
    await store.saveStage(id, version, "optimized_cv", optimizedCv);
    await run.setStage("optimized_cv", "done");

    await run.setStage("optimized_letter", "running");
    optimizedLetter = await optimizeLetter(blocking);
    optimizedLetter.__generated_by = run.llm.name;
    await store.saveStage(id, version, "optimized_letter", optimizedLetter);
    await run.setStage("optimized_letter", "done");

    await run.setStage("quality_control", "running");
    qualityControl = await runQualityControl();
    qualityControl.__generated_by = run.llm.name;
    await store.saveStage(id, version, "quality_control", qualityControl);
    await run.setStage("quality_control", "done");
    if (qualityControl.verdict === "FAIL") {
      run.log("quality control still FAILING after retry — flagged in the report; optimized content must be reviewed manually");
    }
  }

  // ---------- Loop control: comparison with previous version ----------

  const previousEvaluation = version > 1 ? await store.loadStage(id, version - 1, "cv_evaluation") : null;
  const comparison = await run.stage("comparison", { skip: version === 1 || !previousEvaluation }, async () => {
    const previousAdversarial = await store.loadStage(id, version - 1, "adversarial");
    const narrative = await run.llmStage({
      stage: "version_comparator",
      prompt: "version_comparator",
      schema: VersionComparisonSchema,
      maxTokens: 16000,
      content: `${jsonBlock(`Évaluation v${version - 1} (précédente)`, previousEvaluation)}\n\n${jsonBlock(`Revue adversariale v${version - 1}`, previousAdversarial || {})}\n\n${jsonBlock(`Évaluation v${version} (nouvelle)`, evaluation)}\n\n${jsonBlock("Mapping actuel", mapping)}\n\n${jsonBlock("Contrôle qualité", qualityControl)}\n\nCompare les deux versions et détermine la stop condition.`,
    });
    return {
      previous_score: previousEvaluation.total_score,
      new_score: evaluation.total_score,
      delta: Math.round((evaluation.total_score - previousEvaluation.total_score) * 10) / 10,
      ...narrative,
    };
  });

  // ---------- Verdict + report (deterministic code) ----------

  const verdict = computeVerdict({ opportunity, evaluation, mapping, comparison, qualityControl });
  await store.saveStage(id, version, "verdict", verdict);

  const meta = await store.getMeta(id);
  await run.stage("report", {}, async () => {
    const exportArtifacts = {
      job,
      research,
      thesis,
      opportunity,
      evidenceBank,
      mapping,
      evaluation,
      adversarial,
      benchmark,
      letterAnalysis,
      plan,
      optimizedCv,
      optimizedLetter,
      qualityControl,
      comparison,
      verdict,
    };
    const markdown = buildReport({ meta, version, artifacts: exportArtifacts });
    await store.saveReport(id, version, markdown);
    // Focused exports (synthesis / improvement plan, markdown + PDF) alongside the
    // full report. Best effort: a rendering failure must never fail the analysis.
    const exported = [];
    for (const [kind, spec] of Object.entries(EXPORTS)) {
      try {
        const doc = spec.build({ meta, version, artifacts: exportArtifacts });
        const dir = store.paths.outputDir(id, version);
        const base = path.join(dir, `${spec.filename}-v${version}`);
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(`${base}.md`, doc, "utf8");
        const pdf = await markdownToPdf(doc, {
          title: `${spec.title} - ${meta.company || meta.name} (v${version})`,
          subject: meta.role || "",
        });
        await fs.promises.writeFile(`${base}.pdf`, pdf);
        exported.push(kind);
      } catch (error) {
        run.log(`export ${kind} FAILED (${error.message}) — le rapport complet reste disponible`);
      }
    }
    return { generated: true, length: markdown.length, exports: exported };
  });

  await store.updateMeta(id, (m) => {
    const v = m.versions[version] || {};
    v.analyzedAt = new Date().toISOString();
    v.candidateScore = evaluation.total_score;
    v.opportunityScore = opportunity.score;
    v.letterScore = letterAnalysis?.score ?? null;
    v.filters = {
      ats: evaluation.filters.ats.score,
      hr: evaluation.filters.hr.score,
      hiringManager: evaluation.filters.hiring_manager.score,
      strategic: evaluation.filters.strategic.score,
    };
    v.verdict = verdict.verdict;
    v.stopCondition = verdict.readiness;
    v.position = benchmark.candidate_position;
    m.versions[version] = v;
  });
}
