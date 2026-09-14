import { api, postJson } from "./api.js";
import {
  esc,
  pill,
  fmtDate,
  scorePill,
  ratioPill,
  strengthPill,
  ring,
  fmtDuration,
  dropzoneHtml,
  bindDropzones,
  bindCopyButtons,
  VERDICT_LABELS,
  STAGE_LABELS,
} from "./ui.js";
import { getBridge } from "./bridge.js";

export async function renderApplication(root, id, versionOverride) {
  root.innerHTML = `<div class="card"><p class="muted">Chargement…</p></div>`;
  let data;
  try {
    data = await api(`/api/applications/${id}${versionOverride ? `?version=${versionOverride}` : ""}`);
  } catch (error) {
    root.innerHTML = `<div class="error-box">${esc(error.message)}</div><p><a href="#/">← Retour aux candidatures</a></p>`;
    return;
  }

  const { meta, version, artifacts: a } = data;
  const analyzing = meta.status === "analyzing";
  const submitted = Boolean(meta.submittedAt);
  const versions = Object.keys(meta.versions).map(Number).sort((x, y) => x - y);
  const verdict = a.verdict;

  root.innerHTML = `
    <div class="crumb"><a href="#/">← Candidatures</a></div>
    <div class="page-head">
      <div>
        <h1>${esc(meta.company || meta.name)}</h1>
        <p class="sub">${esc(meta.role || "poste non encore identifié")}${meta.location ? ` · ${esc(meta.location)}` : ""}
          ${verdict ? ` · <span class="verdict ${esc(verdict.verdict)}">${esc(VERDICT_LABELS[verdict.verdict] || verdict.verdict)}</span>` : ""}</p>
      </div>
      <div class="page-actions">
        <select id="version-select" style="width:auto">
          ${versions.map((v) => `<option value="${v}" ${v === version ? "selected" : ""}>v${v}${meta.versions[v].analyzedAt ? " · analysée" : ""}</option>`).join("")}
        </select>
        ${
          submitted
            ? `<span class="pill good" title="${esc(meta.submittedAt)}">✓ Envoyée v${meta.submittedVersion} · ${esc(fmtDate(meta.submittedAt))}</span>
               <button class="ghost small" id="unsubmit-btn">Annuler l'envoi</button>`
            : `<button class="secondary" id="submit-btn" ${analyzing ? "disabled" : ""}>✓ Marquer comme envoyée</button>`
        }
        ${analyzing ? `<button class="danger" id="cancel-btn">Arrêter</button>` : ""}
        <button id="analyze-btn" ${analyzing ? "disabled" : ""}>${
          analyzing ? "Analyse en cours…" : meta.versions[version]?.analyzedAt ? "Ré-évaluer" : "Lancer l'analyse"
        }</button>
      </div>
    </div>
    ${meta.lastError && !analyzing ? `<div class="error-box">Dernière erreur : ${esc(meta.lastError)}</div>` : ""}
    <div id="progress-zone"></div>
    <div id="results-zone"></div>
    <div class="card">
      <h2>📤 Nouvelle version</h2>
      <form id="version-form">
        <div class="grid cols-3">
          ${dropzoneHtml("cv", "📄 Nouveau CV", "PDF / TXT / MD", false, ".pdf,.txt,.md")}
          ${dropzoneHtml("letter", "✉️ Nouvelle lettre", "PDF / TXT / MD", false, ".pdf,.txt,.md")}
          <div style="display:flex; align-items:center;">
            <button type="submit" ${analyzing ? "disabled" : ""}>Déposer & ré-évaluer</button>
          </div>
        </div>
        <p class="muted" id="version-status" style="margin:12px 0 0; font-size:0.86rem;">Le document non re-déposé est repris de la version précédente.</p>
      </form>
    </div>`;

  root.querySelector("#version-select").addEventListener("change", (e) => {
    location.hash = `#/app/${id}/v${e.target.value}`;
  });

  root.querySelector("#analyze-btn").addEventListener("click", async () => {
    try {
      await postJson(`/api/applications/${id}/analyze`, { version });
      renderApplication(root, id, version);
    } catch (error) {
      alert(error.message);
    }
  });

  root.querySelector("#submit-btn")?.addEventListener("click", async () => {
    try {
      await postJson(`/api/applications/${id}/submit`, { submitted: true, version });
      renderApplication(root, id, version);
    } catch (error) {
      alert(error.message);
    }
  });

  root.querySelector("#unsubmit-btn")?.addEventListener("click", async () => {
    try {
      await postJson(`/api/applications/${id}/submit`, { submitted: false });
      renderApplication(root, id, version);
    } catch (error) {
      alert(error.message);
    }
  });

  root.querySelector("#cancel-btn")?.addEventListener("click", async () => {
    try {
      await postJson(`/api/applications/${id}/cancel`, {});
    } catch (error) {
      alert(error.message);
    }
  });

  bindDropzones(root);
  root.querySelector("#version-form").addEventListener("submit", (e) => onUploadVersion(e, root, id));

  if (analyzing) startProgressPolling(root, id, version);
  renderResults(root, a, { version, id, meta });
}

async function onUploadVersion(event, root, id) {
  event.preventDefault();
  const form = event.target;
  const status = root.querySelector("#version-status");
  const cv = form.querySelector("input[name=cv]").files[0];
  const letter = form.querySelector("input[name=letter]").files[0];
  if (!cv && !letter) return (status.textContent = "⚠️ Dépose au moins un nouveau CV ou une nouvelle lettre.");

  const fd = new FormData();
  if (cv) fd.append("cv", cv);
  if (letter) fd.append("letter", letter);
  status.textContent = "Upload…";
  try {
    const { version } = await api(`/api/applications/${id}/versions`, { method: "POST", body: fd });
    status.textContent = `v${version} créée — lancement de la ré-évaluation…`;
    await postJson(`/api/applications/${id}/analyze`, { version });
    location.hash = `#/app/${id}/v${version}`;
    renderApplication(root, id, version);
  } catch (error) {
    status.textContent = `⚠️ ${error.message}`;
  }
}

// ---------- live pipeline ----------

function startProgressPolling(root, id, version) {
  const zone = root.querySelector("#progress-zone");

  const tick = async () => {
    let p;
    try {
      p = await api(`/api/applications/${id}/progress?version=${version}`);
    } catch {
      return; // transient: the pipeline may be mid-write
    }
    const stages = p.progress?.stages || [];
    const done = stages.filter((s) => s.status === "done" || s.status === "skipped").length;
    const bridge = getBridge();
    const jobs = bridge.jobs.filter((j) => j.appId === id);
    const claimed = jobs.filter((j) => j.status === "claimed");
    const pending = jobs.filter((j) => j.status === "pending");

    let bridgeLine = "";
    if (bridge.llmProvider === "claude-session") {
      if (claimed.length) {
        bridgeLine = `<div class="notice" style="background:rgba(70,214,192,0.08); border-color:rgba(70,214,192,0.3); color:#bff3ea">
          🤖 Claude travaille sur : ${claimed.map((j) => `<strong>${esc(j.title)}</strong> (${esc(fmtDuration(j.waitingMs))})`).join(", ")}</div>`;
      } else if (pending.length) {
        bridgeLine = bridge.agent.connected
          ? `<div class="notice">⏳ ${pending.length} tâche(s) déposée(s) dans la file — Claude va les prendre.</div>`
          : `<div class="error-box">Aucune session Claude à l'écoute : la pipeline attend. Lance <code>npm run bridge</code> dans ta session Claude Code.</div>`;
      }
    }

    zone.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h2><span class="spinner"></span> Pipeline v${version} — ${done}/${stages.length} étapes</h2>
          <span class="muted" style="font-size:0.82rem">${esc(bridge.llmProvider === "claude-session" ? "exécutée par ta session Claude" : `moteur : ${bridge.llmProvider || "?"}`)}</span>
        </div>
        ${bridgeLine}
        <ul class="timeline">
          ${stages
            .map(
              (s) => `<li class="${esc(s.status)}">${esc(STAGE_LABELS[s.name] || s.name)}${
                s.status === "running" ? `<span class="tag">en cours</span>` : ""
              }${s.status === "skipped" ? `<span class="tag" style="color:var(--faint)">non applicable</span>` : ""}${
                s.error ? ` — <span style="color:var(--bad)">${esc(s.error)}</span>` : ""
              }</li>`,
            )
            .join("")}
        </ul>
        <h3>Journal</h3>
        <pre class="log">${esc(p.logTail || "")}</pre>
      </div>`;

    if (!p.running) {
      clearInterval(timer);
      renderApplication(root, id, version);
    }
  };

  tick();
  const timer = setInterval(tick, 2500);
  root.addEventListener("page:leave", () => clearInterval(timer), { once: true });
}

// ---------- results ----------

/** Download buttons for a focused export (markdown + PDF). */
function exportButtons(ctx, kind) {
  const base = `/api/applications/${encodeURIComponent(ctx.id)}/export/${kind}?version=${ctx.version}`;
  return `
    <span class="row" style="gap:6px">
      <a href="${base}&format=md" target="_blank" rel="noopener"><button class="small secondary">↓ Markdown</button></a>
      <a href="${base}&format=pdf" target="_blank" rel="noopener"><button class="small secondary">↓ PDF</button></a>
    </span>`;
}

const TABS = [
  ["synthese", "Synthèse"],
  ["requirements", "Requirements & Evidence"],
  ["research", "Entreprise & Thèse"],
  ["plan", "Plan d'amélioration"],
  ["cv", "CV optimisé"],
  ["letter", "Lettre optimisée"],
  ["benchmark", "Benchmark"],
  ["report", "Rapport"],
];

function renderResults(root, a, ctx) {
  const zone = root.querySelector("#results-zone");
  if (!a.cv_evaluation) {
    zone.innerHTML = a.progress
      ? ""
      : `<div class="card empty"><span class="big">⧗</span>Pas encore d'analyse pour la v${ctx.version}.<br />Clique sur « Lancer l'analyse ».</div>`;
    return;
  }

  zone.innerHTML = `
    <div class="tabs">${TABS.map(([key, label], i) => `<button data-tab="${key}" class="${i === 0 ? "active" : ""}">${label}</button>`).join("")}</div>
    <div id="tab-content"></div>`;

  const content = zone.querySelector("#tab-content");
  const show = (key) => {
    content.innerHTML = tabs[key](a, ctx);
    bindCopyButtons(content);
  };
  zone.querySelectorAll(".tabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      zone.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      show(btn.dataset.tab);
    });
  });
  show("synthese");
}

const tabs = {
  synthese(a, ctx) {
    const ev = a.cv_evaluation;
    const verdict = a.verdict;
    const comp = a.comparison;
    const qc = a.quality_control;
    return `
      <div class="card">
        <div class="card-head">
          <h2>Scores</h2>
          ${exportButtons(ctx, "synthesis")}
        </div>
        <div class="rings">
          ${ring("Opportunité", a.opportunity?.score, a.opportunity?.tier)}
          ${ring("Candidat", ev?.total_score)}
          ${ring("ATS", ev?.filters?.ats?.score)}
          ${ring("RH", ev?.filters?.hr?.score)}
          ${ring("Hiring Manager", ev?.filters?.hiring_manager?.score)}
          ${ring("Strategic Fit", ev?.filters?.strategic?.score)}
          ${ring("Lettre", a.letter_analysis?.score)}
        </div>
        ${
          verdict
            ? `<h3>Verdict</h3>
               <p><span class="verdict ${esc(verdict.verdict)}">${esc(VERDICT_LABELS[verdict.verdict] || verdict.verdict)}</span>
                  ${pill(verdict.readiness, verdict.readiness === "APPLICATION_READY" ? "good" : "")}</p>
               <ul class="muted">${(verdict.reasons || []).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`
            : ""
        }
        ${qc?.verdict === "FAIL" ? `<div class="notice">⚠️ Contrôle qualité : des problèmes bloquants subsistent dans le contenu optimisé — vérifie les onglets CV / Lettre avant usage.</div>` : ""}
        ${
          comp
            ? `<h3>Évolution vs version précédente</h3>
               <p>${scorePill(comp.previous_score)} → ${scorePill(comp.new_score)}
                  ${pill(`${comp.delta >= 0 ? "+" : ""}${comp.delta} pts`, comp.delta > 0 ? "good" : comp.delta < 0 ? "bad" : "")}
                  ${pill(comp.stop_condition, comp.stop_condition === "APPLICATION_READY" ? "good" : "info")}</p>
               <p class="muted"><strong>Amélioré :</strong> ${esc((comp.what_improved || []).join(" · ") || "—")}</p>
               <p class="muted"><strong>Régressions :</strong> ${esc((comp.what_regressed || []).join(" · ") || "aucune")}</p>
               <p class="muted"><strong>Bloque encore :</strong> ${esc((comp.what_still_blocks || []).join(" · ") || "—")}</p>`
            : ""
        }
        <p class="muted">${esc(ev?.summary || "")}</p>
      </div>

      <div class="card">
        <h2>🚫 Risques de rejet en 20 secondes</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Raison</th><th>Sévérité</th><th>Probabilité</th><th>Gap</th><th>Correction</th></tr></thead>
          <tbody>${(a.adversarial?.twenty_second_rejections || [])
            .map(
              (r) => `<tr>
                <td><strong>${esc(r.reason)}</strong></td>
                <td>${pill(r.severity, r.severity === "HIGH" || r.severity === "CRITICAL" ? "bad" : r.severity === "MEDIUM" ? "mid" : "")}</td>
                <td class="muted">${esc(r.probability)}</td>
                <td>${r.gap_type && r.gap_type !== "NONE" ? pill(r.gap_type, r.gap_type === "ACTUAL_EXPERIENCE_GAP" ? "bad" : "mid") : ""}</td>
                <td class="muted">${r.fixable_by_rewriting ? esc(r.fix) : `${pill("gap réel", "bad")} ${esc(r.fix)}`}</td>
              </tr>`,
            )
            .join("")}</tbody>
        </table></div>
        ${a.adversarial?.additional_risks?.length ? `<h3>Risques additionnels</h3><ul class="muted">${a.adversarial.additional_risks.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
      </div>

      <div class="card">
        <h2>Détail du scoring</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Dimension</th><th>Poids</th><th>Score</th><th>Justification</th></tr></thead>
          <tbody>${(ev?.dimensions || [])
            .map((d) => `<tr><td>${esc(d.dimension)}</td><td class="num muted">${d.weight}</td><td>${ratioPill(d.score, d.weight)}</td><td class="muted">${esc(d.rationale)}</td></tr>`)
            .join("")}</tbody>
        </table></div>
        ${["ats", "hr", "hiring_manager", "strategic"]
          .map((k) => {
            const f = ev?.filters?.[k];
            const names = { ats: "ATS", hr: "RH", hiring_manager: "Hiring Manager", strategic: "Strategic Fit" };
            return f ? `<h3>${names[k]} — ${f.score}/100</h3><p class="muted">${esc(f.diagnosis)}</p>` : "";
          })
          .join("")}
      </div>`;
  },

  requirements(a) {
    return `
      <div class="card">
        <h2>Requirement → Evidence</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Requirement</th><th>Type</th><th>Force</th><th>Gap</th><th>Preuves</th><th>Détail</th></tr></thead>
          <tbody>${(a.mapping?.mappings || [])
            .map(
              (m) => `<tr>
                <td><strong>${esc(m.requirement)}</strong></td>
                <td class="muted">${esc(m.requirement_type)}</td>
                <td>${strengthPill(m.strength)}</td>
                <td>${m.gap_type && m.gap_type !== "NONE" ? pill(m.gap_type, m.gap_type === "ACTUAL_EXPERIENCE_GAP" ? "bad" : "mid") : ""}</td>
                <td class="muted">${esc((m.evidence_ids || []).join(", "))}</td>
                <td class="muted">${esc(m.evidence_summary)}</td>
              </tr>`,
            )
            .join("")}</tbody>
        </table></div>
        <p class="muted">${esc(a.mapping?.coverage_summary || "")}</p>
      </div>

      <div class="card">
        <h2>Requirements extraits de l'offre</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Requirement</th><th>Type</th><th>Importance</th><th>Source</th><th>Poids</th></tr></thead>
          <tbody>${(a.job?.requirements || [])
            .map(
              (r) => `<tr><td>${esc(r.requirement)}</td><td class="muted">${esc(r.type)}</td><td class="num">${r.importance}/5</td>
                <td class="muted">${r.explicit ? "explicite" : "inféré"}</td><td class="num muted">${r.estimated_weight}</td></tr>`,
            )
            .join("")}</tbody>
        </table></div>
      </div>

      <div class="card">
        <h2>Evidence Bank</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>ID</th><th>Type</th><th>Fait</th><th>Localisation</th><th>Force</th></tr></thead>
          <tbody>${(a.evidence_bank?.evidence || [])
            .map(
              (e) => `<tr><td class="muted">${esc(e.id)}</td><td class="muted">${esc(e.type)}</td><td>${esc(e.statement)}</td>
                <td class="muted">${esc(e.source_location)}</td><td>${strengthPill(e.proof_strength)}</td></tr>`,
            )
            .join("")}</tbody>
        </table></div>
      </div>`;
  },

  research(a) {
    const r = a.research;
    const t = a.thesis;
    const o = a.opportunity;
    return `
      <div class="card">
        <h2>🏢 Recherche entreprise ${r?.research_available === false ? pill("recherche web indisponible", "mid") : ""}</h2>
        <p><strong>${esc(r?.company_name || "")}</strong> — ${esc(r?.overview || "")}</p>
        <p class="muted"><strong>Produits & marchés :</strong> ${esc(r?.products_and_markets || "")}</p>
        <p class="muted"><strong>Situation récente :</strong> ${esc(r?.recent_situation || "")}</p>
        <p class="muted"><strong>Présence dans le pays VIE :</strong> ${esc(r?.presence_in_vie_country || "")}</p>
        <p class="muted"><strong>Pourquoi cette mission existe :</strong> ${esc(r?.why_this_mission_exists || "")}</p>
        ${
          r?.findings?.length
            ? `<div class="table-wrap"><table><thead><tr><th>Constat</th><th>Confiance</th><th>Source</th></tr></thead>
               <tbody>${r.findings
                 .map(
                   (f) => `<tr><td>${esc(f.statement)}</td><td>${pill(f.confidence, f.confidence === "FACT" ? "good" : f.confidence === "STRONG_INFERENCE" ? "mid" : "")}</td>
                     <td class="muted">${esc(f.source)}</td></tr>`,
                 )
                 .join("")}</tbody></table></div>`
            : ""
        }
      </div>

      <div class="card">
        <h2>🎯 Thèse de recrutement</h2>
        <p>${esc(t?.mission_thesis || "")}</p>
        <h3>Problèmes business que ce recrutement doit résoudre</h3>
        <ol class="muted">${(t?.top_business_problems || []).map((p) => `<li>${esc(p)}</li>`).join("")}</ol>
        <h3>Candidat idéal (hypothèse)</h3>
        <p>${esc(t?.ideal_candidate?.profile_summary || "")}</p>
        <p class="muted">Formation : ${esc(t?.ideal_candidate?.education || "")} · Expérience : ${esc(t?.ideal_candidate?.experience || "")}</p>
        <p class="muted">Compétences : ${esc((t?.ideal_candidate?.key_skills || []).join(", "))}</p>
        <p class="muted">Différenciateurs : ${esc((t?.ideal_candidate?.differentiators || []).join(", "))}</p>
      </div>

      <div class="card">
        <h2>💎 Score d'opportunité — ${o?.score ?? "—"}/100 ${o?.tier ? pill(o.tier, o.score >= 80 ? "good" : o.score >= 70 ? "mid" : "") : ""}</h2>
        <p class="muted">${esc(o?.summary || "")}</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Critère</th><th>Score</th><th>Justification</th></tr></thead>
          <tbody>${(o?.breakdown || []).map((b) => `<tr><td>${esc(b.criterion)}</td><td>${ratioPill(b.score, b.max)}</td><td class="muted">${esc(b.rationale)}</td></tr>`).join("")}</tbody>
        </table></div>
      </div>`;
  },

  plan(a, ctx) {
    const p = a.improvement_plan;
    const rows = (changes) =>
      (changes || [])
        .map(
          (c) => `<tr>
            <td><span class="priority ${esc(c.priority)}">${esc(String(c.priority).replace("_", " "))}</span></td>
            <td class="muted">${esc(c.current)}</td>
            <td>${esc(c.problem)}</td>
            <td><strong>${esc(c.proposed)}</strong></td>
            <td class="muted">${esc(c.why)}</td>
          </tr>`,
        )
        .join("");
    return `
      <div class="card">
        <div class="card-head">
          <h2>🛠 CV — modifications par ROI</h2>
          ${exportButtons(ctx, "plan")}
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Priorité</th><th>Actuel</th><th>Problème</th><th>Proposé</th><th>Pourquoi</th></tr></thead>
          <tbody>${rows(p?.cv_changes)}</tbody>
        </table></div>
      </div>
      <div class="card">
        <h2>✉️ Lettre — modifications</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Priorité</th><th>Actuel</th><th>Problème</th><th>Proposé</th><th>Pourquoi</th></tr></thead>
          <tbody>${rows(p?.letter_changes)}</tbody>
        </table></div>
        <h3>Recommandations structurelles</h3>
        <ul class="muted">${(p?.structural_recommendations || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
        <p class="muted">${esc(p?.identity_stability_note || "")}</p>
      </div>`;
  },

  cv(a) {
    const o = a.optimized_cv;
    const qc = a.quality_control;
    if (!o) return `<div class="card empty">Pas de CV optimisé pour cette version.</div>`;
    return `
      ${qc?.verdict === "FAIL" ? `<div class="notice">⚠️ Le contrôle qualité signale des problèmes bloquants — détail en bas de page.</div>` : ""}
      <div class="card">
        <div class="card-head">
          <h2>📄 CV optimisé</h2>
          <button class="small secondary" data-copy="optimized-cv-text">Copier</button>
        </div>
        <pre class="content-block" id="optimized-cv-text">${esc(o.optimized_cv_markdown)}</pre>
        <p class="muted">${esc(o.unchanged_note || "")}</p>
      </div>
      <div class="card">
        <h2>Before → After</h2>
        ${(o.bullet_changes || [])
          .map(
            (b) => `
          <p class="faint" style="margin-bottom:6px; font-size:0.82rem;">${esc(b.section)} — cible : ${esc(b.target_requirement)}</p>
          <div class="before-after">
            <div class="before"><div class="ba-label">Avant</div>${esc(b.before)}</div>
            <div class="after"><div class="ba-label">Après</div>${esc(b.after)}</div>
          </div>`,
          )
          .join("")}
      </div>
      ${qualityControlCard(qc)}`;
  },

  letter(a) {
    const o = a.optimized_letter;
    if (!o) return `<div class="card empty">Pas de lettre optimisée pour cette version.</div>`;
    const la = a.letter_analysis;
    return `
      <div class="card">
        <div class="card-head">
          <h2>✉️ Lettre optimisée</h2>
          <button class="small secondary" data-copy="optimized-letter-text">Copier</button>
        </div>
        <pre class="content-block" id="optimized-letter-text">${esc(o.optimized_letter)}</pre>
        <h3>Changements clés</h3>
        <ul class="muted">${(o.key_changes || []).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
      </div>
      ${
        la
          ? `<div class="card">
        <h2>Analyse de la lettre originale — ${la.score}/100</h2>
        <p class="muted">${esc(la.summary)}</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Dimension</th><th>Score /10</th><th>Commentaire</th></tr></thead>
          <tbody>${(la.dimensions || []).map((d) => `<tr><td>${esc(d.dimension)}</td><td>${ratioPill(d.score, 10)}</td><td class="muted">${esc(d.comment)}</td></tr>`).join("")}</tbody>
        </table></div>
        ${["why_this_company", "why_this_role", "why_me", "why_now"]
          .map((k) => {
            const w = la.four_whys?.[k];
            return w
              ? `<p><strong>${k.replace(/_/g, " ").toUpperCase()}</strong> ${w.present ? pill("présent", "good") : pill("absent", "bad")} <span class="muted">${esc(w.quality)}</span></p>`
              : "";
          })
          .join("")}
      </div>`
          : ""
      }`;
  },

  benchmark(a) {
    const b = a.benchmark;
    if (!b) return `<div class="card empty">Pas de benchmark pour cette version.</div>`;
    const tone = b.candidate_position === "TOP_10" || b.candidate_position === "TOP_25" ? "good" : b.candidate_position === "MIDDLE" ? "mid" : "bad";
    return `
      <div class="card">
        <h2>🏁 Position estimée ${pill(b.candidate_position, tone)}</h2>
        <p>${esc(b.rationale)}</p>
        <p class="muted">⚠️ ${esc(b.caveat)}</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Profil concurrent</th><th>Description</th><th>Forces</th><th>Faiblesses</th><th>Plus fort ?</th></tr></thead>
          <tbody>${(b.competitors || [])
            .map(
              (c) => `<tr><td><strong>${esc(c.profile_name)}</strong></td><td class="muted">${esc(c.description)}</td>
                <td class="muted">${esc((c.strengths || []).join("; "))}</td><td class="muted">${esc((c.weaknesses || []).join("; "))}</td>
                <td>${c.stronger_than_candidate ? pill("oui", "bad") : pill("non", "good")}</td></tr>`,
            )
            .join("")}</tbody>
        </table></div>
      </div>`;
  },

  report(a, ctx) {
    return `
      <div class="card">
        <h2>📑 Documents à exporter</h2>
        <p class="muted" style="margin-top:0">Chaque export est régénéré à la demande depuis les artefacts d'analyse, et enregistré dans
          <code>applications/${esc(ctx.id)}/output/v${ctx.version}/</code>.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Document</th><th>Contenu</th><th>Formats</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>Synthèse</strong></td>
              <td class="muted">Verdict, scores, diagnostic des quatre filtres, risques de rejet en 20 secondes, contrôle d'intégrité.</td>
              <td>${exportButtons(ctx, "synthesis")}</td>
            </tr>
            <tr>
              <td><strong>Plan d'amélioration</strong></td>
              <td class="muted">Modifications du CV et de la lettre classées par ROI, recommandations structurelles, note de stabilité d'identité.</td>
              <td>${exportButtons(ctx, "plan")}</td>
            </tr>
            <tr>
              <td><strong>Rapport complet</strong></td>
              <td class="muted">L'intégralité des artefacts de l'analyse, y compris recherche entreprise, Evidence Bank et mapping.</td>
              <td><a href="/api/applications/${esc(ctx.id)}/report?version=${ctx.version}" target="_blank" rel="noopener"><button class="small secondary">↓ Markdown</button></a></td>
            </tr>
          </tbody>
        </table></div>
      </div>`;
  },
};

function qualityControlCard(qc) {
  if (!qc) return "";
  return `
    <div class="card">
      <h2>🔍 Contrôle qualité ${qc.verdict === "PASS" ? pill("PASS", "good") : pill("FAIL", "bad")}</h2>
      <p class="muted">${esc(qc.notes || "")}</p>
      ${
        qc.issues?.length
          ? `<div class="table-wrap"><table>
        <thead><tr><th>Type</th><th>Bloquant</th><th>Localisation</th><th>Texte</th><th>Détail</th></tr></thead>
        <tbody>${qc.issues
          .map(
            (i) => `<tr><td class="muted">${esc(i.type)}</td><td>${i.blocking ? pill("oui", "bad") : `<span class="muted">non</span>`}</td>
              <td class="muted">${esc(i.location)}</td><td class="muted">${esc(i.offending_text)}</td><td class="muted">${esc(i.detail)}</td></tr>`,
          )
          .join("")}</tbody>
      </table></div>`
          : `<p class="muted">Aucun problème d'intégrité détecté.</p>`
      }
    </div>`;
}
