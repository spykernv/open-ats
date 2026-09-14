#!/usr/bin/env node
/**
 * Agent bridge CLI — the Claude Code side of the pipeline.
 *
 * The server (provider `claude-session`) publishes one directory per job under
 * bridge/queue/. This CLI is what a Claude Code session runs to see that work,
 * claim it, and hand back the answer. No API key, no headless sub-process: the
 * session you are chatting with *is* the engine.
 *
 *   node bridge/cli.mjs wait [--timeout 28800] [--session name]  block until work shows up, claim it, print it
 *   node bridge/cli.mjs status                                   snapshot of the queue
 *   node bridge/cli.mjs show <jobId>                             re-print one job (and its prompt path)
 *   node bridge/cli.mjs answer <jobId> <file.json>               hand back a JSON answer
 *   node bridge/cli.mjs answer <jobId> --text-file <file.md>     hand back free-form text
 *   node bridge/cli.mjs answer <jobId> --text "..."              hand back a short free-form answer
 *   node bridge/cli.mjs fail <jobId> "raison"                    give up on a job (the pipeline reports it)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUEUE_DIR = path.join(ROOT, "bridge", "queue");
const AGENT_FILE = path.join(ROOT, "bridge", "agent.json");
const HEARTBEAT_MS = 3000;
const POLL_MS = 700;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function heartbeat(mode, session) {
  // Keep the session label set by `wait` when a later command beats without one.
  const previous = readJson(AGENT_FILE);
  writeJson(AGENT_FILE, {
    updatedAt: new Date().toISOString(),
    mode,
    session: session || process.env.CLAUDE_BRIDGE_SESSION || previous?.session || "claude-code",
    pid: process.pid,
  });
}

function listJobs() {
  if (!fs.existsSync(QUEUE_DIR)) return [];
  return fs
    .readdirSync(QUEUE_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const dir = path.join(QUEUE_DIR, e.name);
      const meta = readJson(path.join(dir, "job.json"));
      return meta ? { ...meta, dir } : null;
    })
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

function jobDir(id) {
  const dir = path.join(QUEUE_DIR, id);
  if (!fs.existsSync(dir)) {
    const err = new Error(
      `Job introuvable : ${id}\nIl a peut-être déjà été répondu, annulé, ou le serveur a redémarré (les jobs orphelins sont archivés dans bridge/archive/).`,
    );
    err.expected = true;
    throw err;
  }
  return dir;
}

function claim(job) {
  const file = path.join(job.dir, "job.json");
  const meta = readJson(file);
  if (!meta || meta.status !== "pending") return false;
  meta.status = "claimed";
  meta.claimedAt = new Date().toISOString();
  writeJson(file, meta);
  return true;
}

function describe(job, index = null) {
  const lines = [];
  const head = index === null ? `JOB ${job.id}` : `[${index}] ${job.id}`;
  lines.push(head);
  lines.push(`    tâche       : ${job.title}${job.attempt > 1 ? `  (tentative ${job.attempt} — correction demandée)` : ""}`);
  lines.push(`    étape       : ${job.stage}${job.kind === "task" ? "  (demande libre depuis l'interface)" : ""}`);
  if (job.appId) lines.push(`    candidature : ${job.appId}${job.version ? ` (v${job.version})` : ""}`);
  lines.push(`    prompt      : ${path.join(job.dir, "prompt.md")}  (${job.promptChars} caractères — lis-le en entier)`);
  if (job.expectsJson) {
    lines.push(`    schéma      : ${path.join(job.dir, "schema.json")}  → la réponse DOIT être un JSON conforme`);
  } else {
    lines.push(`    réponse     : texte libre (markdown)`);
  }
  if (job.files?.length) {
    lines.push(`    fichiers    :`);
    for (const f of job.files) lines.push(`                  - ${f.label} : ${f.path}`);
  }
  if (job.webSearch) lines.push(`    recherche   : WebSearch / WebFetch autorisés et attendus`);
  lines.push(
    `    répondre    : node bridge/cli.mjs answer ${job.id} <fichier.json>${job.expectsJson ? "" : `   (ou --text-file <fichier.md>)`}`,
  );
  return lines.join("\n");
}

// ---------- commands ----------

async function cmdWait(args) {
  const timeoutSec = Number(getFlag(args, "--timeout") || 28800); // 8h: this is a listener, not a poll
  const session = getFlag(args, "--session");
  const noClaim = args.includes("--no-claim");
  const deadline = Date.now() + timeoutSec * 1000;

  heartbeat("waiting", session);
  let lastBeat = Date.now();

  for (;;) {
    const jobs = listJobs();
    const pending = jobs.filter((j) => j.status === "pending");
    if (pending.length) {
      const taken = noClaim ? pending : pending.filter((j) => claim(j));
      if (taken.length) {
        heartbeat("working", session);
        console.log(`=== ${taken.length} JOB(S) À TRAITER ===`);
        console.log("");
        taken.forEach((job, i) => {
          console.log(describe(job, i + 1));
          console.log("");
        });
        console.log("Marche à suivre : lis le prompt (et les fichiers listés), fais le travail toi-même,");
        console.log("puis renvoie la réponse avec `node bridge/cli.mjs answer <jobId> <fichier>`.");
        console.log("Relance ensuite `node bridge/cli.mjs wait` en arrière-plan pour rester connecté.");
        return 0;
      }
    }
    if (Date.now() > deadline) {
      console.log("TIMEOUT — aucun job pendant la fenêtre d'attente. Relance `wait` pour rester connecté.");
      return 0;
    }
    if (Date.now() - lastBeat > HEARTBEAT_MS) {
      heartbeat("waiting", session);
      lastBeat = Date.now();
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

function cmdStatus() {
  const jobs = listJobs();
  const agent = readJson(AGENT_FILE);
  const age = agent?.updatedAt ? Math.round((Date.now() - new Date(agent.updatedAt)) / 1000) : null;
  console.log(`pont : ${age === null ? "jamais connecté" : `dernier battement il y a ${age}s (${agent.mode})`}`);
  if (!jobs.length) {
    console.log("file d'attente vide — rien à faire.");
    return 0;
  }
  console.log(`${jobs.length} job(s) dans la file :`);
  for (const job of jobs) {
    const waited = Math.round((Date.now() - new Date(job.createdAt)) / 1000);
    console.log(`  [${job.status}] ${job.id} — ${job.title} (${waited}s)`);
  }
  return 0;
}

function cmdShow(args) {
  const id = args[0];
  if (!id) throw usage("show <jobId>");
  const dir = jobDir(id);
  const meta = readJson(path.join(dir, "job.json"));
  console.log(describe({ ...meta, dir }));
  return 0;
}

function cmdAnswer(args) {
  const id = args[0];
  if (!id) throw usage("answer <jobId> <fichier.json> | --text-file <fichier> | --text <texte>");
  const dir = jobDir(id);
  const meta = readJson(path.join(dir, "job.json"));

  const inlineText = getFlag(args, "--text");
  const textFile = getFlag(args, "--text-file");
  const jsonFile = args.slice(1).find((a) => !a.startsWith("--") && a !== inlineText && a !== textFile);

  let payload;
  if (inlineText !== null && inlineText !== undefined) {
    payload = { text: inlineText };
  } else if (textFile) {
    payload = { text: fs.readFileSync(path.resolve(textFile), "utf8") };
  } else if (jsonFile) {
    const raw = fs.readFileSync(path.resolve(jsonFile), "utf8");
    try {
      payload = JSON.parse(raw.replace(/^﻿/, ""));
    } catch (error) {
      if (meta?.expectsJson) {
        const err = new Error(`Le fichier n'est pas du JSON valide (${error.message}). Ce job exige un JSON conforme à schema.json.`);
        err.expected = true;
        throw err;
      }
      payload = { text: raw };
    }
  } else {
    throw usage("answer <jobId> <fichier.json> | --text-file <fichier> | --text <texte>");
  }

  if (meta?.expectsJson && (typeof payload !== "object" || Array.isArray(payload) || payload === null)) {
    const err = new Error("Ce job attend un objet JSON (pas un tableau ni une valeur simple).");
    err.expected = true;
    throw err;
  }

  // Atomic hand-off: the server polls for result.json and must never read a half-written file.
  const tmp = path.join(dir, "result.tmp");
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmp, path.join(dir, "result.json"));
  heartbeat("working");
  console.log(`✓ réponse envoyée pour ${id} (${meta?.title || meta?.stage || ""}).`);
  const remaining = listJobs().filter((j) => j.status === "pending" || j.status === "claimed");
  console.log(remaining.length ? `${remaining.length} job(s) encore dans la file.` : "File vide — relance `wait` pour rester connecté.");
  return 0;
}

function cmdFail(args) {
  const id = args[0];
  const message = args.slice(1).join(" ").trim();
  if (!id || !message) throw usage('fail <jobId> "raison"');
  const dir = jobDir(id);
  fs.writeFileSync(path.join(dir, "error.txt"), message, "utf8");
  heartbeat("working");
  console.log(`✗ job ${id} marqué en échec : ${message}`);
  return 0;
}

// ---------- entry point ----------

function getFlag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

function usage(line) {
  const error = new Error(`Usage : node bridge/cli.mjs ${line}`);
  error.expected = true;
  return error;
}

const [command, ...args] = process.argv.slice(2);

try {
  let code = 0;
  if (command === "wait") code = await cmdWait(args);
  else if (command === "status") code = cmdStatus();
  else if (command === "show") code = cmdShow(args);
  else if (command === "answer") code = cmdAnswer(args);
  else if (command === "fail") code = cmdFail(args);
  else {
    console.log(
      [
        "Pont agent — commandes :",
        "  wait [--timeout 28800]       attendre puis prendre le(s) job(s) en cours",
        "  status                       état de la file",
        "  show <jobId>                 détail d'un job",
        "  answer <jobId> <file.json>   répondre (JSON) — ou --text-file <file> / --text <texte>",
        '  fail <jobId> "raison"        signaler un échec',
      ].join("\n"),
    );
    code = command ? 1 : 0;
  }
  process.exit(code);
} catch (error) {
  console.error(error.expected ? error.message : error.stack || String(error));
  process.exit(1);
}
