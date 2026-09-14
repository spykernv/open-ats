import fs from "fs";
import path from "path";
import { APPLICATIONS_DIR } from "../config.js";

const META_FILE = "application.json";

function assertSafeId(id) {
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(id)) {
    throw new Error(`Invalid application id: ${id}`);
  }
}

export function slugify(text) {
  return (
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "application"
  );
}

export function appDir(id) {
  assertSafeId(id);
  return path.join(APPLICATIONS_DIR, id);
}

export const paths = {
  meta: (id) => path.join(appDir(id), META_FILE),
  jobInputDir: (id) => path.join(appDir(id), "input", "job"),
  versionInputDir: (id, v) => path.join(appDir(id), "input", `v${v}`),
  researchDir: (id) => path.join(appDir(id), "research"),
  sharedAnalysisDir: (id) => path.join(appDir(id), "analysis", "shared"),
  versionAnalysisDir: (id, v) => path.join(appDir(id), "analysis", `v${v}`),
  outputDir: (id, v) => path.join(appDir(id), "output", `v${v}`),
  logFile: (id, v) => path.join(appDir(id), "logs", `v${v}.log`),
};

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

export async function readJson(filePath) {
  try {
    // Tolerate a UTF-8 BOM (files edited by external tools on Windows).
    return JSON.parse((await fs.promises.readFile(filePath, "utf8")).replace(/^﻿/, ""));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

let tmpCounter = 0;

/**
 * Write JSON atomically (temp file + rename).
 * The pipeline rewrites progress.json and the application metadata while the UI
 * polls them every couple of seconds; an in-place truncate-then-write can be read
 * half-finished, which surfaces as "Unexpected end of JSON input".
 */
export async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${tmpCounter++}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.promises.rename(tmp, filePath);
      return;
    } catch (error) {
      // Windows briefly denies the rename while a reader holds the target open.
      if (attempt >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(error.code)) {
        await fs.promises.rm(tmp, { force: true });
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }
}

export async function createApplication(name) {
  await ensureDir(APPLICATIONS_DIR);
  const date = new Date().toISOString().slice(0, 10);
  let base = slugify(name ? `${name}-${date}` : `application-${date}`);
  let id = base;
  let counter = 2;
  while (fs.existsSync(appDir(id))) {
    id = `${base}-${counter++}`;
  }
  const meta = {
    id,
    createdAt: new Date().toISOString(),
    name: name || id,
    company: "",
    role: "",
    location: "",
    status: "created", // created | analyzing | analyzed | error
    currentVersion: 1,
    versions: {
      1: { createdAt: new Date().toISOString(), analyzedAt: null, candidateScore: null, opportunityScore: null, filters: null, letterScore: null, verdict: null, stopCondition: null, position: null },
    },
    lastError: null,
  };
  await ensureDir(paths.jobInputDir(id));
  await ensureDir(paths.versionInputDir(id, 1));
  await writeJson(paths.meta(id), meta);
  return meta;
}

export async function getMeta(id) {
  const meta = await readJson(paths.meta(id));
  if (!meta) throw new Error(`Application not found: ${id}`);
  return meta;
}

export async function saveMeta(meta) {
  await writeJson(paths.meta(meta.id), meta);
}

export async function updateMeta(id, updater) {
  const meta = await getMeta(id);
  updater(meta);
  await saveMeta(meta);
  return meta;
}

export async function listApplications() {
  await ensureDir(APPLICATIONS_DIR);
  const entries = await fs.promises.readdir(APPLICATIONS_DIR, { withFileTypes: true });
  const apps = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = await readJson(path.join(APPLICATIONS_DIR, entry.name, META_FILE));
    if (meta) apps.push(meta);
  }
  apps.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return apps;
}

/** Create a new version folder (for a re-uploaded CV/letter) and return its number. */
export async function addVersion(id) {
  const meta = await getMeta(id);
  const next = meta.currentVersion + 1;
  await ensureDir(paths.versionInputDir(id, next));
  meta.currentVersion = next;
  meta.versions[next] = { createdAt: new Date().toISOString(), analyzedAt: null, candidateScore: null, opportunityScore: null, filters: null, letterScore: null, verdict: null, stopCondition: null, position: null };
  meta.status = "created";
  await saveMeta(meta);
  return next;
}

/** List input files for a version; falls back to the latest earlier version for missing docs. */
export async function resolveVersionInputs(id, version) {
  const findDoc = async (v, prefix) => {
    const dir = paths.versionInputDir(id, v);
    try {
      const files = await fs.promises.readdir(dir);
      const match = files.find((f) => f.toLowerCase().startsWith(prefix));
      return match ? path.join(dir, match) : null;
    } catch {
      return null;
    }
  };
  let cv = null;
  let letter = null;
  for (let v = version; v >= 1 && (!cv || !letter); v--) {
    if (!cv) cv = await findDoc(v, "cv");
    if (!letter) letter = await findDoc(v, "letter");
  }
  const jobDir = paths.jobInputDir(id);
  let screenshots = [];
  try {
    screenshots = (await fs.promises.readdir(jobDir)).map((f) => path.join(jobDir, f));
  } catch {
    // no screenshots yet
  }
  return { cv, letter, screenshots };
}

export async function saveStage(id, version, stageName, data) {
  const dir = version === "shared" ? paths.sharedAnalysisDir(id) : paths.versionAnalysisDir(id, version);
  await writeJson(path.join(dir, `${stageName}.json`), data);
}

export async function loadStage(id, version, stageName) {
  const dir = version === "shared" ? paths.sharedAnalysisDir(id) : paths.versionAnalysisDir(id, version);
  return readJson(path.join(dir, `${stageName}.json`));
}

export async function appendLog(id, version, line) {
  const file = paths.logFile(id, version);
  await ensureDir(path.dirname(file));
  const stamped = `[${new Date().toISOString()}] ${line}\n`;
  await fs.promises.appendFile(file, stamped, "utf8");
}

export async function readLog(id, version) {
  try {
    return await fs.promises.readFile(paths.logFile(id, version), "utf8");
  } catch {
    return "";
  }
}

export async function saveReport(id, version, markdown) {
  const dir = paths.outputDir(id, version);
  await ensureDir(dir);
  await fs.promises.writeFile(path.join(dir, "report.md"), markdown, "utf8");
}

export async function readReport(id, version) {
  try {
    return await fs.promises.readFile(path.join(paths.outputDir(id, version), "report.md"), "utf8");
  } catch {
    return null;
  }
}
