/** Deterministic Markdown report assembled from the analysis artifacts. */

function table(headers, rows) {
  const line = (cells) => `| ${cells.map((c) => String(c ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

function bullets(items) {
  return (items || []).map((i) => `- ${i}`).join("\n") || "- (aucun)";
}

export function buildReport({ meta, version, artifacts }) {
  const {
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
  } = artifacts;

  const sections = [];
  const j = job?.job || {};

  sections.push(`# Application Analysis — ${j.company || meta.name} / ${j.title || ""}`);
  sections.push(`Version v${version} — générée le ${new Date().toISOString().slice(0, 16).replace("T", " ")}`);

  sections.push(`## Final Verdict\n\n**${(verdict?.verdict || "").replace(/_/g, " ")}** — statut : ${verdict?.readiness || ""}\n\n${bullets(verdict?.reasons)}`);

  sections.push(
    `## Scores\n\n${table(
      ["Score", "Valeur"],
      [
        ["Opportunity Score", `${opportunity?.score ?? "n/a"}/100 (${opportunity?.tier ?? ""})`],
        ["Candidate Score (CV)", `${evaluation?.total_score ?? "n/a"}/100`],
        ["ATS", `${evaluation?.filters?.ats?.score ?? "n/a"}/100`],
        ["HR", `${evaluation?.filters?.hr?.score ?? "n/a"}/100`],
        ["Hiring Manager", `${evaluation?.filters?.hiring_manager?.score ?? "n/a"}/100`],
        ["Strategic Fit", `${evaluation?.filters?.strategic?.score ?? "n/a"}/100`],
        ["Cover Letter", `${letterAnalysis?.score ?? "n/a"}/100`],
        ["Position concurrentielle estimée", benchmark?.candidate_position ?? "n/a"],
      ],
    )}`,
  );

  if (comparison) {
    sections.push(
      `## Version Comparison\n\nPREVIOUS SCORE : ${comparison.previous_score}/100 → NEW SCORE : ${comparison.new_score}/100 (DELTA : ${comparison.delta >= 0 ? "+" : ""}${comparison.delta})\n\n**What improved**\n${bullets(comparison.what_improved)}\n\n**What regressed**\n${bullets(comparison.what_regressed)}\n\n**What still blocks the application**\n${bullets(comparison.what_still_blocks)}\n\nStop condition : **${comparison.stop_condition}** — ${comparison.rationale}`,
    );
  }

  sections.push(
    `## Opportunity (${opportunity?.score ?? "n/a"}/100 — ${opportunity?.tier ?? ""})\n\n${opportunity?.summary || ""}\n\n${table(
      ["Critère", "Score", "Max", "Justification"],
      (opportunity?.breakdown || []).map((b) => [b.criterion, b.score, b.max, b.rationale]),
    )}`,
  );

  sections.push(
    `## Company Research${research?.research_available === false ? " (recherche web non disponible)" : ""}\n\n**${research?.company_name || j.company || ""}** — ${research?.overview || ""}\n\n- **Produits & marchés** : ${research?.products_and_markets || ""}\n- **Situation récente** : ${research?.recent_situation || ""}\n- **Présence dans le pays du VIE** : ${research?.presence_in_vie_country || ""}\n- **Pourquoi cette mission existe (hypothèse)** : ${research?.why_this_mission_exists || ""}\n- **Valeurs affichées** : ${research?.stated_values || ""}\n\n${table(
      ["Constat", "Confiance", "Source"],
      (research?.findings || []).map((f) => [f.statement, f.confidence, f.source]),
    )}\n\nSources : ${(research?.sources || []).join(", ") || "(aucune)"}`,
  );

  sections.push(
    `## Job Thesis\n\n**Mission thesis** : ${thesis?.mission_thesis || ""}\n\n**Top business problems this hire must solve**\n${bullets(thesis?.top_business_problems)}\n\n**Ideal candidate hypothesis** : ${thesis?.ideal_candidate?.profile_summary || ""}\n- Formation : ${thesis?.ideal_candidate?.education || ""}\n- Expérience : ${thesis?.ideal_candidate?.experience || ""}\n- Compétences clés : ${(thesis?.ideal_candidate?.key_skills || []).join(", ")}\n- Différenciateurs : ${(thesis?.ideal_candidate?.differentiators || []).join(", ")}`,
  );

  sections.push(
    `## Requirements\n\n${table(
      ["Requirement", "Type", "Importance", "Explicite", "Poids estimé", "Evidence (offre)"],
      (job?.requirements || []).map((r) => [r.requirement, r.type, r.importance, r.explicit ? "oui" : "inféré", r.estimated_weight, r.evidence_from_job_post]),
    )}`,
  );

  sections.push(
    `## Candidate Evidence → Requirement Mapping\n\n${table(
      ["Requirement", "Type", "Force", "Gap", "Preuves", "Détail"],
      (mapping?.mappings || []).map((m) => [
        m.requirement,
        m.requirement_type,
        m.strength,
        m.gap_type === "NONE" ? "" : m.gap_type,
        (m.evidence_ids || []).join(", "),
        m.evidence_summary,
      ]),
    )}\n\n${mapping?.coverage_summary || ""}`,
  );

  sections.push(
    `## CV Analysis (${evaluation?.total_score ?? "n/a"}/100)\n\n${evaluation?.summary || ""}\n\n${table(
      ["Dimension", "Poids", "Score", "Justification"],
      (evaluation?.dimensions || []).map((d) => [d.dimension, d.weight, d.score, d.rationale]),
    )}\n\n${["ats", "hr", "hiring_manager", "strategic"]
      .map((k) => {
        const f = evaluation?.filters?.[k];
        return f ? `**${k.toUpperCase()} — ${f.score}/100** : ${f.diagnosis}\n${bullets(f.details)}` : "";
      })
      .join("\n\n")}`,
  );

  sections.push(
    `## Rejection Risks (revue adversariale — "rejet en 20 secondes")\n\n${table(
      ["Raison", "Sévérité", "Probabilité", "Type de gap", "Corrigeable", "Correction"],
      (adversarial?.twenty_second_rejections || []).map((r) => [
        r.reason,
        r.severity,
        r.probability,
        r.gap_type === "NONE" ? "" : r.gap_type,
        r.fixable_by_rewriting ? "oui" : "NON (gap réel)",
        r.fix,
      ]),
    )}\n\n**Risques additionnels**\n${bullets(adversarial?.additional_risks)}`,
  );

  sections.push(
    `## Competitive Benchmark — position estimée : ${benchmark?.candidate_position ?? "n/a"}\n\n${benchmark?.rationale || ""}\n\n${table(
      ["Profil concurrent", "Description", "Forces", "Faiblesses", "Plus fort ?"],
      (benchmark?.competitors || []).map((c) => [
        c.profile_name,
        c.description,
        (c.strengths || []).join("; "),
        (c.weaknesses || []).join("; "),
        c.stronger_than_candidate ? "oui" : "non",
      ]),
    )}\n\n> ${benchmark?.caveat || ""}`,
  );

  sections.push(
    `## Cover Letter Analysis (${letterAnalysis?.score ?? "n/a"}/100)\n\n${letterAnalysis?.summary || ""}\n\n${table(
      ["Dimension", "Score /10", "Commentaire"],
      (letterAnalysis?.dimensions || []).map((d) => [d.dimension, d.score, d.comment]),
    )}\n\n${["why_this_company", "why_this_role", "why_me", "why_now"]
      .map((k) => {
        const w = letterAnalysis?.four_whys?.[k];
        return w ? `- **${k.replace(/_/g, " ").toUpperCase()}** : ${w.present ? "présent" : "ABSENT"} — ${w.quality}` : "";
      })
      .join("\n")}\n\n**Recouvrement avec le CV** : ${letterAnalysis?.cv_overlap || ""}\n\n**Problèmes principaux**\n${bullets(letterAnalysis?.main_issues)}`,
  );

  const changeTable = (changes) =>
    table(
      ["Priorité", "Actuel", "Problème", "Proposé", "Pourquoi", "Requirement ciblé"],
      (changes || []).map((c) => [c.priority, c.current, c.problem, c.proposed, c.why, c.target_requirement]),
    );
  sections.push(
    `## Recommended Changes\n\n### CV\n\n${changeTable(plan?.cv_changes)}\n\n### Lettre\n\n${changeTable(plan?.letter_changes)}\n\n**Recommandations structurelles**\n${bullets(plan?.structural_recommendations)}\n\n> Stabilité d'identité : ${plan?.identity_stability_note || ""}`,
  );

  sections.push(
    `## Optimized CV\n\n${qualityControl?.verdict === "FAIL" ? "> ⚠️ Le contrôle qualité a signalé des problèmes bloquants (voir section Quality Control) — vérifier avant usage.\n\n" : ""}${
      optimizedCv?.optimized_cv_markdown || "(non généré)"
    }\n\n### Bullets modifiés (BEFORE → AFTER)\n\n${table(
      ["Section", "BEFORE", "AFTER", "Justification"],
      (optimizedCv?.bullet_changes || []).map((b) => [b.section, b.before, b.after, b.rationale]),
    )}\n\n${optimizedCv?.unchanged_note || ""}`,
  );

  sections.push(`## Optimized Cover Letter\n\n${optimizedLetter?.optimized_letter || "(non générée)"}\n\n**Changements clés**\n${bullets(optimizedLetter?.key_changes)}`);

  sections.push(
    `## Quality Control — ${qualityControl?.verdict || "n/a"}\n\n${qualityControl?.notes || ""}\n\n${
      (qualityControl?.issues || []).length
        ? table(
            ["Type", "Bloquant", "Localisation", "Texte incriminé", "Détail"],
            qualityControl.issues.map((i) => [i.type, i.blocking ? "OUI" : "non", i.location, i.offending_text, i.detail]),
          )
        : "Aucun problème d'intégrité détecté."
    }`,
  );

  sections.push(
    `## Evidence Bank (référence)\n\n${table(
      ["ID", "Type", "Fait", "Localisation", "Force"],
      (evidenceBank?.evidence || []).map((e) => [e.id, e.type, e.statement, e.source_location, e.proof_strength]),
    )}`,
  );

  return sections.join("\n\n---\n\n") + "\n";
}
