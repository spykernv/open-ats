/**
 * Seeds one fictional application and runs the full pipeline against it, so you
 * can explore the whole interface without uploading anything of your own.
 *
 *   1. LLM_PROVIDER=mock MOCK_DELAY_MS=1200 npm start   (in one terminal)
 *   2. npm run demo                                     (in another)
 *
 * Everything it creates is fictional and lives in applications/, which is
 * git-ignored. Delete that folder to start from a clean slate.
 */

const BASE = process.env.BASE_URL || "http://localhost:3777";

const POSTING = `VIE - Business Analyst, Digital Transformation
DemoCorp Industries - Munich, Germany - 24 months - starting January 2027

About the role
You will support the digital transformation roadmap of our Digital & Data business
unit, build dashboards and KPIs for operational teams, and coordinate between the
local German teams and the French headquarters.

What we are looking for
- Master's degree (business or engineering school)
- First experience (internship) in analytics or consulting
- Data analysis: Excel, Power BI. SAP exposure is a plus
- Fluent English required, German appreciated
- Autonomy, clear communication, comfortable working cross-functionally

Eligibility
Standard Business France VIE conditions apply.
`;

const CV_V1 = `Alex Martin
Junior Business Analyst
Lyon, France - alex.martin@example.com

EDUCATION
Master in Management, Demo Business School (2025)
Exchange semester, Technische Hochschule Demo, Germany (2024)

EXPERIENCE
Business Analyst Intern - RetailCo (Jan 2025 - Jun 2025)
- Built sales dashboards in Power BI for 3 regional teams
- Automated weekly reporting, saving around 4h/week
- Presented monthly performance reviews to the regional director

Project Assistant Intern - ConsultCo (Jun 2024 - Dec 2024)
- Supported the PMO on an ERP migration, tracked 25 milestones
- Maintained the risk register and prepared steering committee packs

LANGUAGES
French (native), English (C1), German (A2)

SKILLS
Power BI, Excel (advanced), SQL (basics), project coordination
`;

const CV_V2 = CV_V1.replace(
  "Junior Business Analyst",
  "Business Analyst - Data & Digital Transformation"
).replace(
  "- Built sales dashboards in Power BI for 3 regional teams",
  "- Built sales dashboards in Power BI used weekly by 3 regional teams (~40 users)"
);

const LETTER = `Madame, Monsieur,

Diplome d'un Master in Management et fort d'une premiere experience en analyse de
donnees chez RetailCo, je souhaite rejoindre DemoCorp Industries en VIE sur le poste
de Business Analyst Digital Transformation.

Mon stage m'a permis de construire des tableaux de bord Power BI utilises chaque
semaine par trois equipes regionales, et d'automatiser un reporting hebdomadaire.
Mon semestre d'echange en Allemagne m'a familiarise avec le contexte local.

Je reste a votre disposition pour en echanger.

Cordialement,
Alex Martin
`;

function blob(text, type = "text/plain") {
  return new Blob([text], { type });
}

async function req(path, options) {
  const res = await fetch(BASE + path, options);
  const type = res.headers.get("content-type") || "";
  const body = type.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function waitForPipeline(id, version) {
  let last = "";
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const p = await req(`/api/applications/${id}/progress?version=${version}`);
    const stages = p.progress?.stages || [];
    const done = stages.filter((s) => s.status === "done" || s.status === "skipped").length;
    const line = `   ${done}/${stages.length} étapes`;
    if (line !== last) {
      process.stdout.write(`\r${line}          `);
      last = line;
    }
    if (!p.running) {
      process.stdout.write("\n");
      if (p.status === "error") throw new Error(`pipeline en erreur :\n${p.logTail}`);
      return;
    }
  }
  throw new Error("la pipeline n'a pas terminé à temps");
}

const health = await req("/api/health");
console.log(`Serveur : ${BASE} — moteur : ${health.providerLabel || health.llmProvider}`);
if (!health.mockMode) {
  console.log(
    "\n⚠️  Le moteur actif n'est pas le mock : cette démo va consommer du quota réel.\n" +
      "   Pour une démo gratuite et instantanée, relancez le serveur avec LLM_PROVIDER=mock.\n"
  );
}

console.log("\n1/3 · Création de la candidature de démonstration…");
const fd = new FormData();
fd.append("screenshots", blob(POSTING), "offre-democorp.txt");
fd.append("cv", blob(CV_V1), "cv-alex-martin-v1.txt");
fd.append("letter", blob(LETTER), "lettre-alex-martin.txt");
fd.append("name", "DemoCorp VIE Business Analyst");
const meta = await req("/api/applications", { method: "POST", body: fd });
console.log(`   → ${meta.id}`);

console.log("\n2/3 · Analyse v1 (16 étapes)…");
await req(`/api/applications/${meta.id}/analyze`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
});
await waitForPipeline(meta.id, 1);

console.log("\n3/3 · Dépôt d'une v2 corrigée, puis ré-évaluation…");
const fd2 = new FormData();
fd2.append("cv", blob(CV_V2), "cv-alex-martin-v2.txt");
const v2 = await req(`/api/applications/${meta.id}/versions`, { method: "POST", body: fd2 });
await req(`/api/applications/${meta.id}/analyze`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ version: v2.version }),
});
await waitForPipeline(meta.id, v2.version);

const detail = await req(`/api/applications/${meta.id}?version=${v2.version}`);
const a = detail.artifacts;
console.log(
  `\n✅ Terminé — opportunité ${a.opportunity?.score}/100 · candidat ${a.cv_evaluation?.total_score}/100 · verdict ${a.verdict?.verdict}`
);
console.log(`\nOuvrez ${BASE}/#/app/${meta.id}/v${v2.version}\n`);
