/* Test du pont agent (aucun serveur, aucune session Claude requise).
   Vérifie the schema-validated stage path of the agent bridge:
   attempt 1 answers with a payload that violates the schema -> the provider must
   re-publish a repair job -> attempt 2 answers correctly -> complete() resolves. */
import { z } from "zod/v4";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);
const { claudeSessionProvider } = await import("../server/llm/claude_session.js");

const Schema = z.object({ ok: z.boolean(), stages: z.array(z.string()).min(2) });
const QUEUE = path.join(ROOT, "bridge", "queue");
const answers = [{ ok: "oui" }, { ok: true, stages: ["quality_control", "comparison", "report"] }];
let index = 0;
const seen = new Set();

const agent = setInterval(() => {
  for (const dir of fs.existsSync(QUEUE) ? fs.readdirSync(QUEUE) : []) {
    if (seen.has(dir)) continue;
    const jobFile = path.join(QUEUE, dir, "job.json");
    if (!fs.existsSync(jobFile)) continue;
    const meta = JSON.parse(fs.readFileSync(jobFile, "utf8"));
    const prompt = fs.readFileSync(path.join(QUEUE, dir, "prompt.md"), "utf8");
    seen.add(dir);
    console.log(`agent: job ${meta.id} (tentative ${meta.attempt}) — prompt contient "CORRECTION REQUISE": ${prompt.includes("CORRECTION REQUISE")}`);
    const file = path.join(ROOT, "bridge", `test-answer-${index}.json`);
    fs.writeFileSync(file, JSON.stringify(answers[index++]), "utf8");
    execFileSync("node", ["bridge/cli.mjs", "answer", meta.id, file], { encoding: "utf8" });
  }
}, 200);

const { data } = await claudeSessionProvider.complete({
  stage: "cv_evaluator",
  system: "Tu évalues un CV.",
  messages: [{ role: "user", content: "Rends le JSON demandé." }],
  schema: Schema,
  appId: "test-app",
  version: 1,
  log: (l) => console.log("  log:", l),
});

clearInterval(agent);
for (let i = 0; i < 2; i++) fs.rmSync(path.join(ROOT, "bridge", `test-answer-${i}.json`), { force: true });
console.log("RÉSULTAT VALIDÉ:", JSON.stringify(data));
console.log(index === 2 ? "OK — la réparation automatique a bien eu lieu (2 jobs)" : `ÉCHEC — ${index} job(s) seulement`);
process.exit(0);
