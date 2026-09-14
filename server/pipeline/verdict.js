/**
 * Deterministic final verdict, computed in code from the analysis artifacts so
 * that thresholds cannot drift. Verdicts: APPLY_NOW | IMPROVE_FIRST | LOW_PRIORITY | DO_NOT_APPLY.
 *
 * Precedence rules:
 * 1. A determinant must-have with a real experience gap (no evidence at all) is a
 *    structural blocker — it can never yield APPLY_NOW, and yields DO_NOT_APPLY
 *    when the rest of the application is also weak.
 * 2. A quality-control FAIL means the optimized content is unsafe to use — never APPLY_NOW.
 * 3. A low-value opportunity (<60) is LOW_PRIORITY regardless of candidate quality.
 */
export function computeVerdict({ opportunity, evaluation, mapping, comparison, qualityControl }) {
  const reasons = [];
  const score = evaluation?.total_score ?? 0;
  const oppScore = opportunity?.score ?? null;
  const qcFail = qualityControl?.verdict === "FAIL" && (qualityControl.issues || []).some((i) => i.blocking);

  const mustHaveActualGaps = (mapping?.mappings || []).filter(
    (m) => m.requirement_type === "MUST_HAVE" && m.gap_type === "ACTUAL_EXPERIENCE_GAP",
  );
  const determinantGaps = mustHaveActualGaps.filter((m) => m.strength === "NONE");

  const structurallyWeak =
    comparison?.stop_condition === "APPLICATION_STRUCTURALLY_WEAK" || determinantGaps.length > 0;

  if (mustHaveActualGaps.length > 0) {
    reasons.push(
      `Must-have avec un vrai manque d'expérience (non corrigeable par la rédaction) : ${mustHaveActualGaps
        .map((m) => m.requirement)
        .join("; ")}`,
    );
  }
  if (qcFail) {
    reasons.push("Le contrôle qualité a détecté des claims non supportés dans la version optimisée — à corriger avant tout envoi.");
  }

  let verdict;
  if (determinantGaps.length > 0 && score < 65) {
    verdict = "DO_NOT_APPLY";
    reasons.push("Un must-have déterminant manque réellement et le reste de la candidature ne compense pas.");
  } else if (oppScore !== null && oppScore < 60) {
    verdict = "LOW_PRIORITY";
    reasons.push(`Opportunity score ${oppScore}/100 (<60) : l'offre elle-même ne justifie pas un gros investissement.`);
  } else if (structurallyWeak) {
    verdict = "LOW_PRIORITY";
    reasons.push("Candidature structurellement faible : les gaps restants sont des gaps d'expérience réels que la réécriture ne résout pas.");
  } else if (qcFail) {
    verdict = "IMPROVE_FIRST";
    reasons.push("Corriger d'abord les problèmes d'intégrité signalés par le contrôle qualité.");
  } else if (score >= 88 || comparison?.stop_condition === "APPLICATION_READY") {
    verdict = "APPLY_NOW";
    reasons.push(
      score >= 88
        ? `Score candidat ${score}/100 (>= 88).`
        : "Plus aucune amélioration raisonnable ne dépasserait ~+2 points.",
    );
  } else {
    verdict = "IMPROVE_FIRST";
    reasons.push(`Score candidat ${score}/100 : appliquer le plan d'amélioration puis re-déposer une version.`);
  }

  const readiness = structurallyWeak
    ? "APPLICATION_STRUCTURALLY_WEAK"
    : !qcFail && (score >= 88 || comparison?.stop_condition === "APPLICATION_READY")
      ? "APPLICATION_READY"
      : "CONTINUE_IMPROVING";

  return { verdict, readiness, reasons, mustHaveActualGaps: mustHaveActualGaps.map((m) => m.requirement) };
}
