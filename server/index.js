import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { config, setLlmProvider, PROVIDERS, WEB_DIR, APPLICATIONS_DIR } from "./config.js";
import * as store from "./storage/applications.js";
import { analyzeApplication, isRunning } from "./pipeline/orchestrator.js";
import { bridgeState, cancelJobs, resetQueue } from "./bridge/queue.js";
import { createTask, listTasks } from "./bridge/tasks.js";
import { EXPORTS } from "./exports/documents.js";
import { loadAnalysisArtifacts } from "./exports/artifacts.js";
import { markdownToPdf } from "./exports/pdf.js";

const app = express();
app.use(express.json());
app.use(express.static(WEB_DIR));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 },
});

const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const DOC_EXT = [".pdf", ".txt", ".md"];

function ext(file) {
  return path.extname(file.originalname || "").toLowerCase();
}

async function writeUpload(dir, name, file) {
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, name), file.buffer);
}

function asyncRoute(fn) {
  return (req, res) => fn(req, res).catch((error) => {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: String(error.message || error) });
  });
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

// ---------- Health ----------

function providerLabel() {
  if (config.llmProvider === "claude-session") return "Session Claude Code (pont agent)";
  if (config.llmProvider === "claude-cli") return `CLI claude -p${config.claudeCliModel ? ` (${config.claudeCliModel})` : ""}`;
  if (config.llmProvider === "anthropic") return `API Anthropic (${config.model})`;
  return "Mock (données factices)";
}

app.get("/api/health", (req, res) => {
  res.json({
    llmProvider: config.llmProvider,
    providers: PROVIDERS,
    providerLabel: providerLabel(),
    bridge: bridgeState().agent,
    llmProviderRequested: config.llmProviderRequested,
    providerNote: config.providerNote,
    researchProvider: config.researchProvider,
    hasApiKey: config.hasApiKey,
    claudeCliAvailable: config.claudeCliAvailable,
    model: config.llmProvider === "claude-cli" ? config.claudeCliModel || "(modèle par défaut de la session Claude)" : config.model,
    effort: config.effort,
    mockMode: config.llmProvider === "mock",
  });
});

// ---------- Applications ----------

app.get(
  "/api/applications",
  asyncRoute(async (req, res) => {
    const apps = await store.listApplications();
    res.json(
      apps.map((m) => {
        const v = m.versions[m.currentVersion] || {};
        return {
          id: m.id,
          name: m.name,
          company: m.company,
          role: m.role,
          location: m.location,
          status: isRunning(m.id) ? "analyzing" : m.status,
          currentVersion: m.currentVersion,
          createdAt: m.createdAt,
          analyzedAt: v.analyzedAt,
          candidateScore: v.candidateScore,
          opportunityScore: v.opportunityScore,
          letterScore: v.letterScore,
          filters: v.filters,
          verdict: v.verdict,
          stopCondition: v.stopCondition,
          position: v.position,
          submittedAt: m.submittedAt || null,
          submittedVersion: m.submittedVersion || null,
          lastError: m.lastError,
        };
      }),
    );
  }),
);

app.post(
  "/api/applications",
  upload.fields([
    { name: "screenshots", maxCount: 15 },
    { name: "cv", maxCount: 1 },
    { name: "letter", maxCount: 1 },
  ]),
  asyncRoute(async (req, res) => {
    const screenshots = req.files?.screenshots || [];
    const cv = req.files?.cv?.[0];
    const letter = req.files?.letter?.[0];

    if (!screenshots.length) throw badRequest("L'annonce est requise : screenshots de l'offre, ou l'annonce en PDF/TXT/MD.");
    if (!cv) throw badRequest("Le CV (PDF) est requis.");
    for (const s of screenshots) {
      // The posting can be captured (images) or exported (pdf/txt/md).
      if (![...IMAGE_EXT, ...DOC_EXT].includes(ext(s))) {
        throw badRequest(`Fichier d'annonce non supporté : ${s.originalname} (formats : png, jpg, webp, gif, pdf, txt, md).`);
      }
    }
    if (!DOC_EXT.includes(ext(cv))) throw badRequest(`Format de CV non supporté : ${cv.originalname} (formats : pdf, txt, md).`);
    if (letter && !DOC_EXT.includes(ext(letter))) throw badRequest(`Format de lettre non supporté : ${letter.originalname} (formats : pdf, txt, md).`);

    const meta = await store.createApplication((req.body.name || "").trim());
    const jobDir = store.paths.jobInputDir(meta.id);
    for (let i = 0; i < screenshots.length; i++) {
      const prefix = IMAGE_EXT.includes(ext(screenshots[i])) ? "screenshot" : "posting";
      await writeUpload(jobDir, `${prefix}-${String(i + 1).padStart(2, "0")}${ext(screenshots[i])}`, screenshots[i]);
    }
    const v1Dir = store.paths.versionInputDir(meta.id, 1);
    await writeUpload(v1Dir, `cv${ext(cv)}`, cv);
    if (letter) await writeUpload(v1Dir, `letter${ext(letter)}`, letter);

    res.status(201).json(meta);
  }),
);

const SHARED_ARTIFACTS = ["job", "research", "thesis", "opportunity"];
const VERSION_ARTIFACTS = [
  "evidence_bank",
  "mapping",
  "cv_evaluation",
  "adversarial",
  "benchmark",
  "letter_analysis",
  "improvement_plan",
  "optimized_cv",
  "optimized_letter",
  "quality_control",
  "comparison",
  "verdict",
  "progress",
];

app.get(
  "/api/applications/:id",
  asyncRoute(async (req, res) => {
    const meta = await store.getMeta(req.params.id);
    const version = Number(req.query.version) || meta.currentVersion;
    const artifacts = {};
    for (const name of SHARED_ARTIFACTS) artifacts[name] = await store.loadStage(meta.id, "shared", name);
    for (const name of VERSION_ARTIFACTS) artifacts[name] = await store.loadStage(meta.id, version, name);
    const report = await store.readReport(meta.id, version);
    res.json({
      meta: { ...meta, status: isRunning(meta.id) ? "analyzing" : meta.status },
      version,
      artifacts,
      hasReport: report !== null,
    });
  }),
);

app.post(
  "/api/applications/:id/analyze",
  asyncRoute(async (req, res) => {
    const meta = await store.getMeta(req.params.id);
    if (isRunning(meta.id)) throw badRequest("Une analyse est déjà en cours pour cette candidature.");
    const version = Number(req.body?.version) || meta.currentVersion;
    if (!meta.versions[version]) throw badRequest(`La version v${version} n'existe pas pour cette candidature.`);
    // Fire and forget: the pipeline runs in the background, the UI polls progress.
    analyzeApplication(meta.id, version);
    res.json({ started: true, version });
  }),
);

app.get(
  "/api/applications/:id/progress",
  asyncRoute(async (req, res) => {
    const meta = await store.getMeta(req.params.id);
    const version = Number(req.query.version) || meta.currentVersion;
    const progress = await store.loadStage(meta.id, version, "progress");
    const log = await store.readLog(meta.id, version);
    res.json({
      running: isRunning(meta.id),
      status: meta.status,
      progress,
      logTail: log.split("\n").slice(-30).join("\n"),
    });
  }),
);

app.post(
  "/api/applications/:id/versions",
  upload.fields([
    { name: "cv", maxCount: 1 },
    { name: "letter", maxCount: 1 },
  ]),
  asyncRoute(async (req, res) => {
    const meta = await store.getMeta(req.params.id);
    if (isRunning(meta.id)) throw badRequest("Attendez la fin de l'analyse en cours avant de déposer une nouvelle version.");
    const cv = req.files?.cv?.[0];
    const letter = req.files?.letter?.[0];
    if (!cv && !letter) throw badRequest("Déposez au moins un nouveau CV ou une nouvelle lettre.");
    if (cv && !DOC_EXT.includes(ext(cv))) throw badRequest(`Format de CV non supporté : ${cv.originalname}.`);
    if (letter && !DOC_EXT.includes(ext(letter))) throw badRequest(`Format de lettre non supporté : ${letter.originalname}.`);

    const version = await store.addVersion(meta.id);
    const dir = store.paths.versionInputDir(meta.id, version);
    if (cv) await writeUpload(dir, `cv${ext(cv)}`, cv);
    if (letter) await writeUpload(dir, `letter${ext(letter)}`, letter);
    res.status(201).json({ version });
  }),
);

app.get(
  "/api/applications/:id/report",
  asyncRoute(async (req, res) => {
    const meta = await store.getMeta(req.params.id);
    const version = Number(req.query.version) || meta.currentVersion;
    const report = await store.readReport(meta.id, version);
    if (report === null) throw badRequest("Aucun rapport pour cette version (lancez d'abord l'analyse).");
    res.type("text/markdown; charset=utf-8").send(report);
  }),
);

// ---------- Submission tracking ----------

app.post(
  "/api/applications/:id/submit",
  asyncRoute(async (req, res) => {
    const meta = await store.getMeta(req.params.id);
    const submitted = req.body?.submitted !== false;
    if (submitted) {
      const version = Number(req.body?.version) || meta.currentVersion;
      if (!meta.versions[version]) throw badRequest(`La version v${version} n'existe pas pour cette candidature.`);
      const at = req.body?.submittedAt || new Date().toISOString();
      if (Number.isNaN(Date.parse(at))) throw badRequest("Date d'envoi invalide.");
      const updated = await store.updateMeta(meta.id, (m) => {
        m.submittedAt = at;
        m.submittedVersion = version;
      });
      res.json({ submittedAt: updated.submittedAt, submittedVersion: updated.submittedVersion });
      return;
    }
    const updated = await store.updateMeta(meta.id, (m) => {
      m.submittedAt = null;
      m.submittedVersion = null;
    });
    res.json({ submittedAt: updated.submittedAt, submittedVersion: updated.submittedVersion });
  }),
);

// ---------- Focused exports (synthesis / improvement plan, markdown or PDF) ----------

app.get(
  "/api/applications/:id/export/:kind",
  asyncRoute(async (req, res) => {
    const spec = EXPORTS[req.params.kind];
    if (!spec) throw badRequest(`Export inconnu : ${req.params.kind} (valeurs : ${Object.keys(EXPORTS).join(", ")}).`);
    const format = String(req.query.format || "md").toLowerCase();
    if (!["md", "pdf"].includes(format)) throw badRequest(`Format inconnu : ${format} (valeurs : md, pdf).`);

    const meta = await store.getMeta(req.params.id);
    const version = Number(req.query.version) || meta.currentVersion;
    const artifacts = await loadAnalysisArtifacts(meta.id, version);
    if (!artifacts.evaluation) throw badRequest(`Aucune analyse disponible pour la v${version} : lancez d'abord l'analyse.`);

    const markdown = spec.build({ meta, version, artifacts });
    const base = `${spec.filename}-v${version}`;
    // Keep a copy next to report.md so the documents also exist on disk.
    const dir = store.paths.outputDir(meta.id, version);
    await fs.promises.mkdir(dir, { recursive: true });

    if (format === "pdf") {
      const buffer = await markdownToPdf(markdown, {
        title: `${spec.title} - ${meta.company || meta.name} (v${version})`,
        subject: meta.role || "",
      });
      await fs.promises.writeFile(path.join(dir, `${base}.pdf`), buffer);
      res.type("application/pdf").set("Content-Disposition", `inline; filename="${base}.pdf"`).send(buffer);
      return;
    }

    await fs.promises.writeFile(path.join(dir, `${base}.md`), markdown, "utf8");
    res.type("text/markdown; charset=utf-8").set("Content-Disposition", `inline; filename="${base}.md"`).send(markdown);
  }),
);

// ---------- Agent bridge (the Claude Code session that runs the work) ----------

app.get("/api/bridge", (req, res) => {
  res.json({ ...bridgeState(), llmProvider: config.llmProvider });
});

app.post(
  "/api/settings",
  asyncRoute(async (req, res) => {
    const requested = String(req.body?.llmProvider || "").toLowerCase();
    if (!requested) throw badRequest("llmProvider manquant.");
    setLlmProvider(requested);
    res.json({
      llmProvider: config.llmProvider,
      llmProviderRequested: config.llmProviderRequested,
      providerLabel: providerLabel(),
      providerNote: config.providerNote,
      researchProvider: config.researchProvider,
    });
  }),
);

app.post(
  "/api/applications/:id/cancel",
  asyncRoute(async (req, res) => {
    const meta = await store.getMeta(req.params.id);
    const cancelled = cancelJobs(meta.id, "Analyse annulée depuis l'interface.");
    res.json({ cancelled });
  }),
);

// Free-form tasks: ask the Claude session anything from the UI console.
app.get("/api/tasks", (req, res) => res.json(listTasks()));

app.post(
  "/api/tasks",
  asyncRoute(async (req, res) => {
    const question = String(req.body?.question || "").trim();
    if (!question) throw badRequest("Question vide.");
    const task = createTask({
      question,
      appId: req.body?.appId || null,
      context: String(req.body?.context || ""),
    });
    res.status(201).json(task);
  }),
);

// SPA fallback
app.get("/", (req, res) => res.sendFile(path.join(WEB_DIR, "index.html")));

await fs.promises.mkdir(APPLICATIONS_DIR, { recursive: true });
// Jobs left over from a previous run have no one waiting for them anymore.
await resetQueue();
app.listen(config.port, () => {
  console.log(`CV system running at http://localhost:${config.port}`);
  if (config.llmProvider === "claude-session") {
    console.log("LLM provider: claude-session — les étapes sont exécutées par votre session Claude Code via le pont agent.");
    console.log("   Dans votre session Claude Code, lancez le pont :  npm run bridge");
  } else if (config.llmProvider === "claude-cli") {
    console.log(`LLM provider: claude-cli (session Claude Code locale${config.claudeCliModel ? `, modèle ${config.claudeCliModel}` : ", modèle par défaut de la session"}) — aucune clé API requise`);
  } else {
    console.log(`LLM provider: ${config.llmProvider} (model: ${config.model}, effort: ${config.effort})`);
  }
  console.log(`Research provider: ${config.researchProvider}`);
  if (config.providerNote) console.log(`⚠️  ${config.providerNote}`);
  if (config.llmProvider === "mock" && config.llmProviderRequested !== "mock") {
    console.log("⚠️  Mode MOCK actif (données factices) : installez la CLI claude (npm i -g @anthropic-ai/claude-code) ou configurez ANTHROPIC_API_KEY.");
  }
});
