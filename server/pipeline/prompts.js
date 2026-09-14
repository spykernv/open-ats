import fs from "fs";
import path from "path";
import { PROMPTS_DIR } from "../config.js";

const cache = new Map();

function readPrompt(name) {
  return fs.readFileSync(path.join(PROMPTS_DIR, `${name}.md`), "utf8").trim();
}

/** Load a role prompt, prefixed with the shared absolute constraints. */
export function loadPrompt(name) {
  if (!cache.has(name)) {
    const core = readPrompt("_core_rules");
    cache.set(name, `${core}\n\n---\n\n${readPrompt(name)}`);
  }
  return cache.get(name);
}
