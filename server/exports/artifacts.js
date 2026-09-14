import * as store from "../storage/applications.js";

/** Stage file name -> key used by the report and export builders. */
const SHARED = { job: "job", research: "research", thesis: "thesis", opportunity: "opportunity" };
const VERSIONED = {
  evidence_bank: "evidenceBank",
  mapping: "mapping",
  cv_evaluation: "evaluation",
  adversarial: "adversarial",
  benchmark: "benchmark",
  letter_analysis: "letterAnalysis",
  improvement_plan: "plan",
  optimized_cv: "optimizedCv",
  optimized_letter: "optimizedLetter",
  quality_control: "qualityControl",
  comparison: "comparison",
  verdict: "verdict",
};

/** Load every analysis artifact of a version, keyed the way the builders expect. */
export async function loadAnalysisArtifacts(id, version) {
  const artifacts = {};
  for (const [stage, key] of Object.entries(SHARED)) artifacts[key] = await store.loadStage(id, "shared", stage);
  for (const [stage, key] of Object.entries(VERSIONED)) artifacts[key] = await store.loadStage(id, version, stage);
  return artifacts;
}
