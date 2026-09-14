/**
 * Focused export documents, assembled deterministically from the analysis
 * artifacts (no LLM call). The full report.md keeps everything; these two are
 * the documents you actually read and act on:
 *   - synthesis: where the application stands and why;
 *   - plan: what to change, ranked by ROI.
 */

const VERDICT_LABELS = {
  APPLY_NOW: "APPLY NOW",
  IMPROVE_FIRST: "IMPROVE FIRST",
  LOW_PRIORITY: "LOW PRIORITY",
  DO_NOT_APPLY: "DO NOT APPLY",
};

const PRIORITY_ORDER = ["CRITICAL", "HIGH_IMPACT", "MEDIUM", "OPTIONAL"];
const PRIORITY_LABELS = {
  CRITICAL: "Critique",
  HIGH_IMPACT: "Fort impact",
  MEDIUM: "Moyen",
  OPTIONAL: "Optionnel",
};

function table(headers, rows) {
  const line = (cells) => `| ${cells.map((c) => String(c ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

function bullets(items, empty = "(aucun)") {
  const list = (items || []).filter(Boolean);
  return list.length ? list.map((i) => `- ${i}`).join("\n") : `- ${empty}`;
}

function score(value, suffix = "/100") {
  return value === null || value === undefined ? "n/a" : `${value}${suffix}`;
}

function stamp(version) {
  return `Version v${version} — document généré le ${new Date().toISOString().slice(0, 16).replace("T", " à ")}`;
}

function headerBlock(meta, version, job, title) {
  const j = job?.job || {};
  const company = j.company || meta.company || meta.name;
  const role = j.title || meta.role || "";
  const place = [j.location, j.country].filter(Boolean).join(", ") || meta.location || "";
  return [
    `# ${title} — ${company}${role ? ` / ${role}` : ""}`,
    "",
    [place, j.contract_type, j.duration].filter(Boolean).join(" · "),
    "",
    stamp(version),
  ].join("\n");
}

/** Executive summary: verdict, scores, the four filters, rejection risks. */
export function buildSynthesis({ meta, version, artifacts }) {
  const { job, opportunity, evaluation, adversarial, benchmark, letterAnalysis, qualityControl, comparison, verdict, mapping } = artifacts;
  const s = [];

  s.push(headerBlock(meta, version, job, "Synthèse"));

  s.push(
    [
      "## Verdict",
      "",
      `**${VERDICT_LABELS[verdict?.verdict] || verdict?.verdict || "n/a"}** — statut : ${verdict?.readiness || "n/a"}`,
      "",
      bullets(verdict?.reasons),
    ].join("\n"),
  );

  s.push(
    [
      "## Scores",
      "",
      table(
        ["Indicateur", "Valeur", "Lecture"],
        [
          ["Opportunité", score(opportunity?.score), opportunity?.tier || ""],
          ["Candidat (CV)", score(evaluation?.total_score), "score global sur cette offre"],
          ["Filtre ATS", score(evaluation?.filters?.ats?.score), "passage du tri automatique"],
          ["Filtre RH", score(evaluation?.filters?.hr?.score), "lisibilité du profil en 20 secondes"],
          ["Filtre Hiring Manager", score(evaluation?.filters?.hiring_manager?.score), "capacité à résoudre les problèmes du poste"],
          ["Filtre Strategic Fit", score(evaluation?.filters?.strategic?.score), "potentiel et différenciation"],
          ["Lettre", score(letterAnalysis?.score), letterAnalysis ? "analyse de la lettre fournie" : "aucune lettre fournie"],
          ["Position estimée", benchmark?.candidate_position || "n/a", "face au vivier réaliste de candidats"],
        ],
      ),
    ].join("\n"),
  );

  if (evaluation?.summary) {
    s.push(["## Ce que dit l'évaluation", "", evaluation.summary].join("\n"));
  }

  if (comparison) {
    s.push(
      [
        "## Évolution depuis la version précédente",
        "",
        `${comparison.previous_score}/100 -> ${comparison.new_score}/100 (delta : ${comparison.delta >= 0 ? "+" : ""}${comparison.delta})`,
        "",
        `Stop condition : **${comparison.stop_condition}**`,
        "",
        "**Ce qui s'est amélioré**",
        bullets(comparison.what_improved),
        "",
        "**Ce qui a régressé**",
        bullets(comparison.what_regressed, "aucune régression"),
        "",
        "**Ce qui bloque encore**",
        bullets(comparison.what_still_blocks),
      ].join("\n"),
    );
  }

  const rejections = adversarial?.twenty_second_rejections || [];
  if (rejections.length) {
    s.push(
      [
        "## Pourquoi ce dossier peut être rejeté en 20 secondes",
        "",
        ...rejections.map((r, i) =>
          [
            `### ${i + 1}. ${r.reason}`,
            "",
            `Sévérité : **${r.severity}** · Probabilité : **${r.probability}**${
              r.gap_type && r.gap_type !== "NONE" ? ` · Type de gap : **${r.gap_type}**` : ""
            }`,
            "",
            r.fixable_by_rewriting ? `**Correction possible** : ${r.fix}` : `**Non corrigeable par la rédaction** : ${r.fix}`,
          ].join("\n"),
        ),
      ].join("\n\n"),
    );
  }

  if (adversarial?.additional_risks?.length) {
    s.push(["## Risques additionnels", "", bullets(adversarial.additional_risks)].join("\n"));
  }

  const filters = evaluation?.filters || {};
  const filterNames = { ats: "ATS", hr: "RH", hiring_manager: "Hiring Manager", strategic: "Strategic Fit" };
  const filterBlocks = Object.entries(filterNames)
    .filter(([key]) => filters[key])
    .map(([key, label]) => [`### ${label} — ${score(filters[key].score)}`, "", filters[key].diagnosis || ""].join("\n"));
  if (filterBlocks.length) {
    s.push(["## Diagnostic des quatre filtres", "", ...filterBlocks].join("\n\n"));
  }

  if (mapping?.coverage_summary) {
    s.push(["## Couverture des requirements", "", mapping.coverage_summary].join("\n"));
  }

  if (qualityControl) {
    const blocking = (qualityControl.issues || []).filter((i) => i.blocking);
    s.push(
      [
        "## Contrôle d'intégrité du contenu optimisé",
        "",
        `Verdict : **${qualityControl.verdict}**${blocking.length ? ` — ${blocking.length} problème(s) bloquant(s)` : " — aucun problème bloquant"}`,
        "",
        qualityControl.notes || "",
      ].join("\n"),
    );
  }

  return s.join("\n\n");
}

/** Action document: what to change in the CV and the letter, ranked by ROI. */
export function buildImprovementPlan({ meta, version, artifacts }) {
  const { job, plan, adversarial, verdict, evaluation } = artifacts;
  const s = [];

  s.push(headerBlock(meta, version, job, "Plan d'amélioration"));

  s.push(
    [
      "## Point de départ",
      "",
      `Score candidat : **${score(evaluation?.total_score)}** · Verdict : **${VERDICT_LABELS[verdict?.verdict] || verdict?.verdict || "n/a"}**`,
      "",
      "Les modifications ci-dessous sont classées par retour sur investissement. Les critiques traitent les motifs de rejet les plus probables : à traiter d'abord.",
    ].join("\n"),
  );

  const fixable = (adversarial?.twenty_second_rejections || []).filter((r) => r.fixable_by_rewriting);
  const notFixable = (adversarial?.twenty_second_rejections || []).filter((r) => !r.fixable_by_rewriting);
  if (fixable.length || notFixable.length) {
    s.push(
      [
        "## Ce que ce plan corrige",
        "",
        "**Corrigeable par la rédaction**",
        bullets(fixable.map((r) => r.reason), "rien à corriger par la rédaction"),
        "",
        "**Gaps réels — aucune reformulation ne les comble**",
        bullets(
          notFixable.map((r) => `${r.reason} — ${r.fix}`),
          "aucun gap réel identifié",
        ),
      ].join("\n"),
    );
  }

  const renderChanges = (changes, heading) => {
    const list = changes || [];
    if (!list.length) return [`## ${heading}`, "", "(aucune modification proposée)"].join("\n");
    const ordered = [...list].sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority));
    const blocks = [`## ${heading}`];
    let currentPriority = null;
    ordered.forEach((c, i) => {
      if (c.priority !== currentPriority) {
        currentPriority = c.priority;
        blocks.push(`### Priorité : ${PRIORITY_LABELS[c.priority] || c.priority}`);
      }
      blocks.push(
        [
          `**${i + 1}. ${c.target_requirement || "Amélioration"}**`,
          "",
          `*Actuellement* : ${c.current}`,
          "",
          `*Problème* : ${c.problem}`,
          "",
          `*Proposé* : ${c.proposed}`,
          "",
          `*Pourquoi* : ${c.why}`,
        ].join("\n"),
      );
    });
    return blocks.join("\n\n");
  };

  s.push(renderChanges(plan?.cv_changes, "Modifications du CV"));
  s.push(renderChanges(plan?.letter_changes, "Modifications de la lettre"));

  if (plan?.structural_recommendations?.length) {
    s.push(["## Recommandations structurelles", "", bullets(plan.structural_recommendations)].join("\n"));
  }

  if (plan?.identity_stability_note) {
    s.push(["## Stabilité de l'identité professionnelle", "", plan.identity_stability_note].join("\n"));
  }

  return s.join("\n\n");
}

export const EXPORTS = {
  synthesis: { build: buildSynthesis, filename: "synthese", title: "Synthèse" },
  plan: { build: buildImprovementPlan, filename: "plan-amelioration", title: "Plan d'amélioration" },
};
