import fs from "fs";
import path from "path";
import crypto from "crypto";
import { ROOT_DIR } from "../config.js";

/**
 * Agent bridge queue.
 *
 * The `claude-session` LLM provider does not spawn anything: it drops a job on
 * disk and waits. A Claude Code session (the one the user is chatting with)
 * watches this queue with `bridge/cli.mjs`, does the work itself — reading the
 * screenshots and PDFs, searching the web, producing the JSON — and writes the
 * answer back. The pipeline is therefore executed by a real Claude session in
 * the background, without an API key and without headless sub-processes.
 *
 * One job = one directory, so both sides only need plain files:
 *   bridge/queue/<jobId>/job.json      metadata + status (server writes, agent updates status)
 *   bridge/queue/<jobId>/prompt.md     everything the agent has to read
 *   bridge/queue/<jobId>/schema.json   JSON Schema the answer must satisfy (optional)
 *   bridge/queue/<jobId>/result.json   the agent's answer (agent writes -> resolves the job)
 *   bridge/queue/<jobId>/error.txt     the agent gave up (agent writes -> rejects the job)
 */

export const BRIDGE_DIR = path.join(ROOT_DIR, "bridge");
export const QUEUE_DIR = path.join(BRIDGE_DIR, "queue");
export const ARCHIVE_DIR = path.join(BRIDGE_DIR, "archive");
export const AGENT_FILE = path.join(BRIDGE_DIR, "agent.json");

const POLL_MS = 300;
const HEARTBEAT_STALE_MS = 20000;
const HISTORY_MAX = 40;

/** In-flight jobs (jobId -> record). Lives only as long as the server runs. */
const inflight = new Map();
/** Finished jobs kept for the UI, newest first. */
const history = [];

function jobDir(id) {
  if (!/^[a-z0-9-]+$/i.test(id)) throw new Error(`Invalid job id: ${id}`);
  return path.join(QUEUE_DIR, id);
}

function readJsonSync(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

async function writeJson(file, data) {
  await fs.promises.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

/** Move a finished job out of the live queue so the agent only ever sees real work. */
async function archive(id) {
  await fs.promises.mkdir(ARCHIVE_DIR, { recursive: true });
  const target = path.join(ARCHIVE_DIR, id);
  await fs.promises.rm(target, { recursive: true, force: true }).catch(() => {});
  await fs.promises.rename(jobDir(id), target).catch(() => {});
}

function pushHistory(record) {
  history.unshift({
    id: record.id,
    kind: record.kind,
    stage: record.stage,
    appId: record.appId,
    version: record.version,
    title: record.title,
    status: record.status,
    createdAt: record.createdAt,
    finishedAt: record.finishedAt,
    durationMs: record.finishedAt ? new Date(record.finishedAt) - new Date(record.createdAt) : null,
    error: record.error || null,
  });
  history.length = Math.min(history.length, HISTORY_MAX);
}

/** Drop jobs left behind by a previous server run: nobody is waiting for them anymore. */
export async function resetQueue() {
  await fs.promises.mkdir(QUEUE_DIR, { recursive: true });
  const entries = await fs.promises.readdir(QUEUE_DIR, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(QUEUE_DIR, entry.name, "job.json");
    const meta = readJsonSync(file);
    if (meta) {
      meta.status = "orphaned";
      meta.finishedAt = new Date().toISOString();
      await writeJson(file, meta).catch(() => {});
    }
    await archive(entry.name).catch(() => {});
  }
}

/**
 * Publish a job and wait for the Claude session to answer it.
 * Resolves with the parsed content of result.json.
 */
export function submitJob({
  kind = "stage",
  stage = "task",
  title = "",
  appId = null,
  version = null,
  prompt,
  schema = null,
  files = [],
  webSearch = false,
  attempt = 1,
  timeoutMs = 45 * 60 * 1000,
  log = () => {},
}) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const id = `${stamp}-${stage}-${crypto.randomBytes(3).toString("hex")}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const dir = jobDir(id);
  const createdAt = new Date().toISOString();

  const meta = {
    id,
    kind,
    stage,
    title: title || stage,
    appId,
    version,
    status: "pending", // pending -> claimed -> done | error | cancelled | timeout
    attempt,
    createdAt,
    claimedAt: null,
    finishedAt: null,
    webSearch,
    files: files.map((f) => ({ path: f.path, label: f.label || "fichier" })),
    expectsJson: Boolean(schema),
    promptChars: prompt.length,
    timeoutMs,
  };

  const record = { ...meta, error: null };

  const promise = new Promise((resolve, reject) => {
    let settled = false;

    const finish = async (status, payload, error) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      clearTimeout(timeoutTimer);
      record.status = status;
      record.finishedAt = new Date().toISOString();
      record.error = error ? String(error.message || error) : null;
      inflight.delete(id);
      pushHistory(record);
      const current = readJsonSync(path.join(dir, "job.json")) || meta;
      await writeJson(path.join(dir, "job.json"), {
        ...current,
        status,
        finishedAt: record.finishedAt,
        error: record.error,
      }).catch(() => {});
      await archive(id).catch(() => {});
      if (error) reject(error);
      else resolve(payload);
    };

    const timer = setInterval(() => {
      // The agent rewrites job.json when it claims the job — mirror that for the UI.
      const current = readJsonSync(path.join(dir, "job.json"));
      if (current?.status === "claimed" && record.status === "pending") {
        record.status = "claimed";
        record.claimedAt = current.claimedAt;
        log(`job ${id} pris en charge par la session Claude`);
      }
      const errorFile = path.join(dir, "error.txt");
      if (fs.existsSync(errorFile)) {
        const message = fs.readFileSync(errorFile, "utf8").trim() || "La session Claude a signale un echec.";
        finish("error", null, new Error(message));
        return;
      }
      const resultFile = path.join(dir, "result.json");
      if (fs.existsSync(resultFile)) {
        const payload = readJsonSync(resultFile);
        if (payload === null) return; // still being written — retry on the next tick
        log(`job ${id} repondu par la session Claude`);
        finish("done", payload, null);
      }
    }, POLL_MS);

    const timeoutTimer = setTimeout(() => {
      const minutes = Math.round(timeoutMs / 60000);
      finish(
        "timeout",
        null,
        new Error(
          `La session Claude n'a pas repondu au job "${meta.title}" en ${minutes} min. Verifiez que le pont est connecte (voir l'indicateur "Pont Claude" en haut de page).`,
        ),
      );
    }, timeoutMs);

    record.cancel = (reason) => {
      const error = new Error(reason || "Job annulé.");
      error.cancelled = true; // the orchestrator reports a cancellation, not a crash
      finish("cancelled", null, error);
    };
  });

  // Materialize the job on disk only once the watcher above exists, so a very
  // fast agent answer cannot be missed.
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "prompt.md"), prompt, "utf8");
  if (schema) fs.writeFileSync(path.join(dir, "schema.json"), JSON.stringify(schema, null, 2), "utf8");
  fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify(meta, null, 2), "utf8");

  inflight.set(id, record);
  log(`job ${id} en attente de la session Claude (${meta.title})`);
  return { id, promise };
}

/** Cancel in-flight jobs (all of them, or those of one application). */
export function cancelJobs(appId, reason) {
  let count = 0;
  for (const record of [...inflight.values()]) {
    if (!appId || record.appId === appId) {
      record.cancel?.(reason);
      count++;
    }
  }
  return count;
}

export function agentState() {
  const beat = readJsonSync(AGENT_FILE);
  const lastSeen = beat?.updatedAt ? new Date(beat.updatedAt) : null;
  const ageMs = lastSeen ? Date.now() - lastSeen.getTime() : null;
  return {
    connected: ageMs !== null && ageMs < HEARTBEAT_STALE_MS,
    lastSeen: beat?.updatedAt || null,
    ageMs,
    session: beat?.session || null,
    mode: beat?.mode || null,
  };
}

export function bridgeState() {
  const jobs = [...inflight.values()].map((r) => ({
    id: r.id,
    kind: r.kind,
    stage: r.stage,
    title: r.title,
    appId: r.appId,
    version: r.version,
    status: r.status,
    attempt: r.attempt,
    createdAt: r.createdAt,
    claimedAt: r.claimedAt,
    waitingMs: Date.now() - new Date(r.createdAt).getTime(),
    expectsJson: r.expectsJson,
    files: r.files.length,
  }));
  jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { agent: agentState(), jobs, history };
}
