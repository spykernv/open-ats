import { api, postJson } from "./api.js";
import { esc, scorePill, pill, fmtDate, dropzoneHtml, bindDropzones, VERDICT_LABELS } from "./ui.js";
import { getBridge } from "./bridge.js";

const STATUS_LABELS = {
  created: "à analyser",
  analyzing: "analyse en cours",
  analyzed: "analysée",
  cancelled: "annulée",
  error: "erreur",
};

export async function renderDashboard(root) {
  root.innerHTML = `<div class="card"><p class="muted">Chargement…</p></div>`;
  let apps = [];
  try {
    apps = await api("/api/applications");
  } catch (error) {
    root.innerHTML = `<div class="error-box">${esc(error.message)}</div>`;
    return;
  }

  const scored = apps.filter((a) => a.candidateScore !== null && a.candidateScore !== undefined);
  const best = scored.length ? Math.max(...scored.map((a) => a.candidateScore)) : null;
  const running = apps.filter((a) => a.status === "analyzing").length;
  const ready = apps.filter((a) => a.verdict === "APPLY_NOW").length;
  const sent = apps.filter((a) => a.submittedAt).length;

  const ranked = [...apps].sort((a, b) => (b.candidateScore ?? -1) - (a.candidateScore ?? -1));

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Candidatures</h1>
        <p class="sub">Classées par score candidat. Chaque analyse tourne en arrière-plan dans ta session Claude.</p>
      </div>
      <div class="page-actions">
        <a href="#/new"><button>＋ Nouvelle analyse</button></a>
      </div>
    </div>

    <div class="stat-row">
      <div class="stat"><div class="k">Candidatures</div><div class="v">${apps.length}</div><div class="s">${scored.length} analysée(s)</div></div>
      <div class="stat"><div class="k">Meilleur score</div><div class="v" style="color:${best >= 75 ? "var(--good)" : best >= 55 ? "var(--warn)" : best === null ? "var(--faint)" : "var(--bad)"}">${best ?? "—"}</div><div class="s">sur 100</div></div>
      <div class="stat"><div class="k">Prêtes à envoyer</div><div class="v" style="color:var(--good)">${ready}</div><div class="s">verdict APPLY NOW</div></div>
      <div class="stat"><div class="k">Envoyées</div><div class="v" style="color:${sent ? "var(--accent)" : "var(--faint)"}">${sent}</div><div class="s">candidature(s) envoyée(s)</div></div>
      <div class="stat"><div class="k">En cours</div><div class="v" style="color:${running ? "var(--warn)" : "var(--faint)"}">${running}</div><div class="s">${running ? "pipeline actif" : "aucune analyse"}</div></div>
    </div>

    ${
      apps.length
        ? `<div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>#</th><th>Entreprise</th><th>Poste</th><th>Lieu</th>
            <th>Opportunité</th><th>Candidat</th><th>ATS / RH / HM / Strat</th>
            <th>Verdict</th><th>Statut</th><th>Version</th><th>Date</th>
          </tr></thead>
          <tbody>
            ${ranked
              .map((a, i) => {
                const f = a.filters;
                return `<tr class="clickable" data-id="${esc(a.id)}">
                  <td class="num faint">${i + 1}</td>
                  <td class="clamp"><strong>${esc(a.company || a.name)}</strong></td>
                  <td class="clamp" title="${esc(a.role || "")}">${esc(a.role || "—")}</td>
                  <td class="clamp muted" title="${esc(a.location || "")}">${esc(a.location || "—")}</td>
                  <td>${scorePill(a.opportunityScore)}</td>
                  <td>${scorePill(a.candidateScore)}</td>
                  <td class="muted num">${f ? `${f.ats} / ${f.hr} / ${f.hiringManager} / ${f.strategic}` : "—"}</td>
                  <td>${a.verdict ? `<span class="verdict ${esc(a.verdict)}">${esc(VERDICT_LABELS[a.verdict] || a.verdict)}</span>` : "—"}</td>
                  <td>${
                    a.status === "analyzing"
                      ? `<span class="pill mid"><span class="spinner"></span> en cours</span>`
                      : a.submittedAt
                        ? `<span class="pill good" title="Envoyée le ${esc(fmtDate(a.submittedAt))} (v${a.submittedVersion})">✓ envoyée</span>`
                        : a.status === "error"
                          ? pill("erreur", "bad")
                          : `<span class="muted">${esc(STATUS_LABELS[a.status] || a.status)}</span>`
                  }</td>
                  <td class="num">v${a.currentVersion}</td>
                  <td class="muted num">${esc(fmtDate(a.analyzedAt || a.createdAt))}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </div>`
        : `<div class="card empty">
             <span class="big">▤</span>
             Aucune candidature pour l'instant.<br />
             <a href="#/new">Dépose une offre + ton CV</a> pour lancer la première analyse.
           </div>`
    }`;

  root.querySelectorAll("tr.clickable").forEach((tr) => {
    tr.addEventListener("click", () => (location.hash = `#/app/${tr.dataset.id}`));
  });
}

export function renderNewApplication(root) {
  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Nouvelle analyse</h1>
        <p class="sub">L'offre (screenshots ou annonce exportée) + ton CV. La lettre est optionnelle : sans elle, Claude en rédige une à partir de ton Evidence Bank.</p>
      </div>
      <div class="page-actions"><a href="#/"><button class="ghost">Annuler</button></a></div>
    </div>

    <div class="card">
      <form id="new-app-form">
        <div class="grid cols-3">
          ${dropzoneHtml("screenshots", "📸 L'offre", "screenshots PNG/JPG, ou l'annonce en PDF/TXT/MD", true, "image/png,image/jpeg,image/webp,image/gif,.pdf,.txt,.md")}
          ${dropzoneHtml("cv", "📄 CV", "PDF, TXT ou MD", false, ".pdf,.txt,.md")}
          ${dropzoneHtml("letter", "✉️ Lettre de motivation", "optionnelle", false, ".pdf,.txt,.md")}
        </div>
        <div class="row" style="margin-top:16px;">
          <input type="text" id="app-name" placeholder="Nom (optionnel — ex : Airbus VIE Supply Chain Hambourg)" style="flex:1; min-width:260px;" />
          <button type="submit" id="create-btn">Lancer l'analyse</button>
        </div>
        <p class="muted" id="create-status" style="margin:12px 0 0; font-size:0.86rem;"></p>
      </form>
    </div>

    <div class="card">
      <h2>Ce qui va se passer</h2>
      <p class="muted" style="margin-top:0">16 étapes, exécutées par ta session Claude Code via le pont : lecture de l'annonce, recherche entreprise sur le web,
      modélisation du recrutement en 4 filtres (ATS, RH, Hiring Manager, Strategic Fit), scoring, revue adversariale, plan d'amélioration,
      CV et lettre optimisés, puis contrôle qualité qui bloque toute affirmation non prouvée par ton CV.</p>
      <p class="muted">Tu peux suivre chaque étape en direct, et relancer une v2 après avoir corrigé tes documents.</p>
    </div>`;

  bindDropzones(root);
  root.querySelector("#new-app-form").addEventListener("submit", (event) => onCreate(event, root));
}

async function onCreate(event, root) {
  event.preventDefault();
  const form = event.target;
  const status = root.querySelector("#create-status");
  const button = root.querySelector("#create-btn");
  const screenshots = form.querySelector("input[name=screenshots]").files;
  const cv = form.querySelector("input[name=cv]").files[0];
  const letter = form.querySelector("input[name=letter]").files[0];

  if (!screenshots.length) return (status.textContent = "⚠️ Ajoute l'offre : screenshots, ou l'annonce en PDF/TXT/MD.");
  if (!cv) return (status.textContent = "⚠️ Ajoute ton CV.");

  const fd = new FormData();
  [...screenshots].forEach((f) => fd.append("screenshots", f));
  fd.append("cv", cv);
  if (letter) fd.append("letter", letter);
  fd.append("name", root.querySelector("#app-name").value);

  button.disabled = true;
  status.textContent = "Création de la candidature…";
  try {
    const meta = await api("/api/applications", { method: "POST", body: fd });
    status.textContent = "Lancement de la pipeline…";
    await postJson(`/api/applications/${meta.id}/analyze`, {});
    if (!getBridge().agent.connected && getBridge().llmProvider === "claude-session") {
      status.textContent = "Analyse lancée, mais aucune session Claude n'écoute : lance `npm run bridge`.";
    }
    location.hash = `#/app/${meta.id}`;
  } catch (error) {
    status.textContent = `⚠️ ${error.message}`;
    button.disabled = false;
  }
}
