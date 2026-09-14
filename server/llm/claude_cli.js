import { spawn } from "child_process";
import { config } from "../config.js";
import { buildFlatPrompt, parseJsonLoose } from "./prompt_builder.js";

/**
 * LLM provider backed by the local `claude` CLI (Claude Code) in headless mode.
 * Uses the user's Claude desktop/subscription session — no API key required.
 * - Prompts are piped through stdin (Windows command lines are length-limited).
 * - Files (screenshots, PDFs) are referenced by absolute path; the CLI reads
 *   them itself with its Read tool (vision included for images).
 * - Structured outputs: the zod schema is converted to JSON Schema and embedded
 *   in the prompt; the response is parsed then validated with the same schema,
 *   with one repair retry on validation failure.
 */

const BASE_DISALLOWED = ["Bash", "Edit", "Write", "NotebookEdit", "Task", "TodoWrite"];

// Simple semaphore: don't spawn unlimited concurrent Claude sessions.
let active = 0;
const waiters = [];
async function withSlot(fn) {
  if (active >= config.claudeCliConcurrency) {
    await new Promise((resolve) => waiters.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    const next = waiters.shift();
    if (next) next();
  }
}

function runClaudeProcess({ prompt, allowedTools, timeoutMs, log }) {
  const args = ["-p", "--output-format", "json"];
  if (config.claudeCliModel) args.push("--model", config.claudeCliModel);
  if (allowedTools?.length) args.push("--allowedTools", ...allowedTools);
  args.push("--disallowedTools", ...BASE_DISALLOWED);

  return new Promise((resolve, reject) => {
    // npm installs claude as a .cmd/.ps1 shim on Windows: shell:true is required.
    const child = spawn("claude", args, { shell: true, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`La CLI claude n'a pas répondu en ${Math.round(timeoutMs / 60000)} min (timeout).`));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Impossible de lancer la CLI claude : ${error.message}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let payload = null;
      try {
        payload = JSON.parse(stdout.trim());
      } catch {
        // fall through — handled below
      }
      if (payload && payload.type === "result") {
        if (payload.is_error) {
          const message = String(payload.result || "erreur inconnue");
          if (/401|authenticate|oauth/i.test(message)) {
            reject(
              new Error(
                "Session Claude expirée ou non authentifiée. Lancez `claude` dans un terminal puis `/login` pour vous reconnecter, et relancez l'analyse.",
              ),
            );
            return;
          }
          reject(new Error(`Erreur CLI claude : ${message}`));
          return;
        }
        log(
          `claude CLI done (turns: ${payload.num_turns}, ${Math.round((payload.duration_ms || 0) / 1000)}s${
            payload.total_cost_usd ? `, ~$${payload.total_cost_usd.toFixed(3)}` : ""
          })`,
        );
        resolve(String(payload.result ?? ""));
        return;
      }
      reject(
        new Error(
          `Sortie CLI claude inattendue (exit ${code}) : ${(stderr || stdout || "").slice(0, 500)}`,
        ),
      );
    });

    child.stdin.on("error", () => {}); // EPIPE if the CLI exits early — the close handler reports the real error
    child.stdin.write(prompt, "utf8");
    child.stdin.end();
  });
}

async function completeClaudeCli({ system, messages, schema, webSearch = false, log = () => {} }) {
  return withSlot(async () => {
    let schemaError = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const { prompt, hasFiles } = buildFlatPrompt({ system, messages, schema, schemaError });
      const allowedTools = [
        ...(hasFiles ? ["Read"] : []),
        ...(webSearch ? ["WebSearch", "WebFetch"] : []),
      ];
      const text = await runClaudeProcess({
        prompt,
        allowedTools,
        timeoutMs: config.claudeCliTimeoutMs,
        log,
      });
      if (!schema) return { text };
      try {
        const data = schema.parse(parseJsonLoose(text));
        return { data, text };
      } catch (error) {
        schemaError = String(error.message || error).slice(0, 2000);
        log(`réponse non conforme au schéma (tentative ${attempt}/2) : ${schemaError.slice(0, 200)}`);
        if (attempt === 2) {
          throw new Error(`La CLI claude n'a pas produit de JSON conforme après 2 tentatives : ${schemaError.slice(0, 300)}`);
        }
      }
    }
  });
}

export const claudeCliProvider = {
  name: "claude-cli",
  complete: completeClaudeCli,
};
