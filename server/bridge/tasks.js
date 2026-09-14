import { submitJob } from "./queue.js";
import { config } from "../config.js";

/**
 * Free-form tasks sent from the UI console straight to the Claude Code session
 * (same queue as the pipeline stages, no schema, answer rendered as markdown).
 * Kept in memory: this is a local single-user tool, tasks are conversation, not data.
 */
const tasks = [];
const MAX = 50;

function textOf(payload) {
  if (payload === null || payload === undefined) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload.text === "string") return payload.text;
  return JSON.stringify(payload, null, 2);
}

export function createTask({ question, appId = null, context = "" }) {
  const prompt = [
    "=== TÂCHE DEMANDÉE DEPUIS L'INTERFACE ===",
    "L'utilisateur t'envoie cette demande depuis le tableau de bord VIE Application Optimizer.",
    "Réponds directement, en français, en markdown. Tu peux lire les fichiers de la candidature et chercher sur le web si c'est utile.",
    appId ? `\nCandidature concernée : applications/${appId}/ (métadonnées, analyses et rapports y sont stockés).` : "",
    context ? `\nContexte fourni :\n${context}` : "",
    `\n=== DEMANDE ===\n${question}`,
  ]
    .filter(Boolean)
    .join("\n");

  const { id, promise } = submitJob({
    kind: "task",
    stage: "task",
    title: question.slice(0, 70),
    appId,
    prompt,
    schema: null,
    webSearch: true,
    timeoutMs: config.claudeSessionTimeoutMs,
  });

  const task = {
    id,
    question,
    appId,
    status: "pending",
    answer: null,
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  tasks.unshift(task);
  tasks.length = Math.min(tasks.length, MAX);

  promise
    .then((payload) => {
      task.status = "done";
      task.answer = textOf(payload);
    })
    .catch((error) => {
      task.status = "error";
      task.error = String(error.message || error);
    })
    .finally(() => {
      task.finishedAt = new Date().toISOString();
    });

  return task;
}

export function listTasks() {
  return tasks;
}
