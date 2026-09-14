/* End-to-end test of the cv-system pipeline (mock mode). */
const BASE = process.env.BASE_URL || "http://localhost:3777";

// 1x1 red PNG
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const CV_TXT = `Jean Dupont
Junior Business Analyst
Paris, France — jean.dupont@example.com

FORMATION
Master in Management, ESC Demo (2025)

EXPERIENCES
Business Analyst Intern — RetailCo (Jan 2025 - Jun 2025)
- Built sales dashboards in Power BI for 3 regional teams
- Automated weekly reporting, saving ~4h/week

Project Assistant Intern — ConsultCo (Jun 2024 - Dec 2024)
- Supported PMO on ERP migration, tracked 25 milestones

LANGUES
Francais (natif), Anglais (C1)

COMPETENCES
Power BI, Excel, SQL (bases), Coordination de projet
`;

const LETTER_TXT = `Madame, Monsieur,

Actuellement diplome d'un Master in Management, je souhaite rejoindre votre entreprise en VIE.
Mon stage chez RetailCo m'a permis de developper des competences en analyse de donnees.
Je suis motive, mobile et disponible immediatement.

Cordialement,
Jean Dupont
`;

function fail(msg) {
  console.error("E2E FAIL:", msg);
  process.exit(1);
}

async function req(path, options) {
  const res = await fetch(BASE + path, options);
  const type = res.headers.get("content-type") || "";
  const body = type.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

const health = await req("/api/health");
console.log("health:", JSON.stringify(health));
if (!health.mockMode) console.log("NOTE: running against a REAL provider");

const fd = new FormData();
fd.append("screenshots", new Blob([Buffer.from(PNG_B64, "base64")], { type: "image/png" }), "offer-1.png");
fd.append("cv", new Blob([CV_TXT], { type: "text/plain" }), "cv-jean.txt");
fd.append("letter", new Blob([LETTER_TXT], { type: "text/plain" }), "letter-jean.txt");
fd.append("name", "DemoCorp VIE Test");

const meta = await req("/api/applications", { method: "POST", body: fd });
console.log("created application:", meta.id);

await req(`/api/applications/${meta.id}/analyze`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
});
console.log("analysis started");

let done = false;
for (let i = 0; i < 120 && !done; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const p = await req(`/api/applications/${meta.id}/progress?version=1`);
  const stages = (p.progress?.stages || []).map((s) => `${s.name}:${s.status}`).join(" ");
  if (i % 5 === 0) console.log(`[${i}s] running=${p.running} status=${p.status}`);
  if (!p.running) {
    done = true;
    console.log("final stages:", stages);
    if (p.status === "error") fail("pipeline ended in error status; log tail:\n" + p.logTail);
  }
}
if (!done) fail("pipeline did not finish within 120s");

const detail = await req(`/api/applications/${meta.id}?version=1`);
const a = detail.artifacts;
const required = ["job", "research", "thesis", "opportunity", "evidence_bank", "mapping", "cv_evaluation", "adversarial", "benchmark", "letter_analysis", "improvement_plan", "optimized_cv", "optimized_letter", "quality_control", "verdict"];
for (const name of required) {
  if (!a[name]) fail(`missing artifact: ${name}`);
}
console.log("all artifacts present");
console.log("candidate score:", a.cv_evaluation.total_score, "| opportunity:", a.opportunity.score, "| verdict:", a.verdict.verdict);

const report = await req(`/api/applications/${meta.id}/report?version=1`);
if (!report.includes("# Application Analysis")) fail("report markdown malformed");
console.log("report length:", report.length);

// New version upload + re-evaluate
const fd2 = new FormData();
fd2.append("cv", new Blob([CV_TXT + "\n(updated v2)"], { type: "text/plain" }), "cv-jean-v2.txt");
const v2 = await req(`/api/applications/${meta.id}/versions`, { method: "POST", body: fd2 });
console.log("created version:", v2.version);
await req(`/api/applications/${meta.id}/analyze`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ version: v2.version }),
});
done = false;
for (let i = 0; i < 120 && !done; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const p = await req(`/api/applications/${meta.id}/progress?version=${v2.version}`);
  if (!p.running) {
    done = true;
    if (p.status === "error") fail("v2 pipeline error; log tail:\n" + p.logTail);
  }
}
if (!done) fail("v2 pipeline did not finish");

const detail2 = await req(`/api/applications/${meta.id}?version=2`);
if (!detail2.artifacts.comparison) fail("missing comparison artifact on v2");
console.log("v2 comparison:", JSON.stringify(detail2.artifacts.comparison.stop_condition), "delta:", detail2.artifacts.comparison.delta);

const list = await req("/api/applications");
console.log("dashboard list:", list.map((x) => `${x.id} v${x.currentVersion} score=${x.candidateScore} verdict=${x.verdict}`).join("; "));

console.log("\nE2E PASS ✅");
