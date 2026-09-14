import { api, postJson } from "./api.js";
import { esc, fmtAgo, fmtDuration, markdown } from "./ui.js";

/**
 * Agent bridge widget: shows whether the Claude Code session is listening,
 * what it is working on, and lets you switch engine without restarting.
 */

const ENGINE_LABELS = {
  "claude-session": "Session Claude Code (pont)",
  "claude-cli": "CLI claude -p (headless)",
  anthropic: "API Anthropic",
  mock: "Mock (données factices)",
};

let state = { agent: { connected: false }, jobs: [], history: [], llmProvider: null };
const listeners = new Set();

export function getBridge() {
  return state;
}

/** Subscribe to bridge updates; returns an unsubscribe function. */
export function onBridge(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function initBridge() {
  await renderEngineSelect();
  await tick();
  setInterval(tick, 2000);
}

async function tick() {
  try {
    state = await api("/api/bridge");
  } catch {
    state = { agent: { connected: false }, jobs: [], history: [], llmProvider: null, unreachable: true };
  }
  renderCard();
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch {
      /* a broken listener must not kill the poll loop */
    }
  });
}

function renderCard() {
  const card = document.getElementById("bridge-card");
  const dotTitle = document.getElementById("bridge-title");
  const line = document.getElementById("bridge-state");
  const jobsEl = document.getElementById("bridge-jobs");
  const hint = document.getElementById("bridge-hint");
  if (!card) return;

  const usingBridge = state.llmProvider === "claude-session";
  const busy = state.jobs.some((j) => j.status === "claimed");
  const waiting = state.jobs.filter((j) => j.status === "pending").length;

  card.classList.remove("on", "off", "busy");
  dotTitle.textContent = "Pont Claude";

  if (!usingBridge) {
    line.innerHTML = `Moteur actif : <strong>${esc(ENGINE_LABELS[state.llmProvider] || state.llmProvider || "…")}</strong>. Le pont n'est pas utilisé.`;
    jobsEl.innerHTML = "";
    hint.innerHTML = `Choisis <em>Session Claude Code</em> ci-dessous pour que ta session exécute les étapes.`;
    return;
  }

  if (busy) {
    card.classList.add("busy");
    line.innerHTML = `Claude travaille sur ${state.jobs.filter((j) => j.status === "claimed").length} tâche(s).`;
  } else if (state.agent.connected) {
    card.classList.add("on");
    line.innerHTML = waiting
      ? `${waiting} tâche(s) en file — Claude va les prendre.`
      : `Connecté et en attente de travail.`;
  } else {
    card.classList.add("off");
    line.innerHTML = state.agent.lastSeen
      ? `Déconnecté (vu il y a ${esc(fmtAgo(state.agent.lastSeen))}).`
      : `Aucune session Claude à l'écoute.`;
  }

  jobsEl.innerHTML = state.jobs
    .slice(0, 4)
    .map(
      (j) => `<li><strong>${esc(j.title)}</strong>${j.status === "claimed" ? "en cours" : "en attente"} · ${esc(fmtDuration(j.waitingMs))}${
        j.attempt > 1 ? ` · tentative ${j.attempt}` : ""
      }</li>`,
    )
    .join("");

  hint.innerHTML = state.agent.connected
    ? `Session : <code>${esc(state.agent.session || "claude-code")}</code>`
    : `Dans ta session Claude Code, lance&nbsp;: <code>npm run bridge</code>`;
}

async function renderEngineSelect() {
  const select = document.getElementById("engine-select");
  const note = document.getElementById("engine-note");
  if (!select) return;
  let health;
  try {
    health = await api("/api/health");
  } catch {
    return;
  }
  select.innerHTML = (health.providers || [])
    .map((p) => `<option value="${esc(p)}" ${p === health.llmProvider ? "selected" : ""}>${esc(ENGINE_LABELS[p] || p)}</option>`)
    .join("");
  note.textContent = health.providerNote || (health.llmProvider === "mock" ? "Données factices : rien n'est réellement analysé." : "");

  select.addEventListener("change", async () => {
    note.textContent = "Changement…";
    try {
      const next = await postJson("/api/settings", { llmProvider: select.value });
      note.textContent = next.providerNote || `Moteur : ${ENGINE_LABELS[next.llmProvider] || next.llmProvider}`;
      select.value = next.llmProvider;
      tick();
    } catch (error) {
      note.textContent = error.message;
    }
  });
}

// ---------- console page ----------

export async function renderConsole(root) {
  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Console Claude</h1>
        <p class="sub">Envoie une demande libre à ta session Claude Code : elle la traite en arrière-plan, avec accès aux dossiers <code>applications/</code> et au web.</p>
      </div>
    </div>
    <div class="card">
      <form id="task-form">
        <textarea id="task-question" placeholder="Ex : compare les deux dernières candidatures et dis-moi laquelle a le meilleur ratio effort/chances."></textarea>
        <div class="row" style="margin-top:12px; justify-content:space-between;">
          <select id="task-app" style="max-width:340px;"><option value="">Sans candidature liée</option></select>
          <button type="submit" id="task-send">Envoyer à Claude</button>
        </div>
        <p class="muted" id="task-status" style="margin:10px 0 0; font-size:0.85rem;"></p>
      </form>
    </div>
    <div id="task-list" class="chat"></div>`;

  try {
    const apps = await api("/api/applications");
    const select = root.querySelector("#task-app");
    select.innerHTML += apps
      .map((a) => `<option value="${esc(a.id)}">${esc(a.company || a.name)}${a.role ? ` — ${esc(a.role)}` : ""}</option>`)
      .join("");
  } catch {
    /* the console still works without the application list */
  }

  const listEl = root.querySelector("#task-list");
  const status = root.querySelector("#task-status");

  const refresh = async () => {
    let tasks = [];
    try {
      tasks = await api("/api/tasks");
    } catch {
      return;
    }
    listEl.innerHTML = tasks.length
      ? tasks
          .map(
            (t) => `
        <div class="msg q">
          <div class="who"><span>Vous · ${esc(fmtAgo(t.createdAt))}</span>${t.appId ? `<span>${esc(t.appId)}</span>` : ""}</div>
          <div>${esc(t.question)}</div>
        </div>
        <div class="msg a">
          <div class="who"><span>Claude</span><span>${
            t.status === "pending" ? "en cours" : t.status === "error" ? "échec" : esc(fmtAgo(t.finishedAt))
          }</span></div>
          ${
            t.status === "pending"
              ? `<p class="muted"><span class="spinner"></span> En attente de la session Claude…</p>`
              : t.status === "error"
                ? `<p class="error-box" style="margin:0">${esc(t.error)}</p>`
                : `<div class="md">${markdown(t.answer)}</div>`
          }
        </div>`,
          )
          .join("")
      : `<div class="card empty"><span class="big">✦</span>Aucune demande pour l'instant.</div>`;
  };

  await refresh();
  const timer = setInterval(refresh, 2500);
  root.addEventListener("page:leave", () => clearInterval(timer), { once: true });

  root.querySelector("#task-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = root.querySelector("#task-question").value.trim();
    if (!question) return;
    const button = root.querySelector("#task-send");
    button.disabled = true;
    status.textContent = "Envoi à la session Claude…";
    try {
      await postJson("/api/tasks", { question, appId: root.querySelector("#task-app").value || null });
      root.querySelector("#task-question").value = "";
      status.textContent = getBridge().agent.connected
        ? "Envoyé — Claude va traiter la demande."
        : "Envoyé, mais aucune session Claude n'est à l'écoute : lance `npm run bridge` dans ta session.";
      await refresh();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}
