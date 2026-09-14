import { z } from "zod/v4";

/**
 * Shared prompt flattening for the two "Claude session" engines (headless
 * `claude -p` CLI and the agent bridge). Both talk to a real Claude session
 * that reads files with its own Read tool, so the provider-agnostic messages
 * ({type:"text"|"file"}) become one prompt plus a list of absolute paths.
 */
export function buildFlatPrompt({ system, messages, schema, schemaError }) {
  const parts = [];
  const files = [];
  if (system) parts.push(`=== INSTRUCTIONS (SYSTEM) ===\n${system}`);

  for (const message of messages) {
    const items = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
    for (const item of items) {
      if (item.type === "text") parts.push(item.text);
      else if (item.type === "file") files.push(item);
    }
  }

  if (files.length) {
    const fileList = files.map((f) => `- ${f.label || "fichier"} : ${f.path}`).join("\n");
    parts.unshift(
      `=== FICHIERS À LIRE ===\nCommence par lire chacun de ces fichiers avec ton outil Read (les images sont des captures d'écran à analyser visuellement, les PDF des documents complets) :\n${fileList}`,
    );
  }

  let jsonSchema = null;
  if (schema) {
    jsonSchema = z.toJSONSchema(schema);
    parts.push(
      `=== FORMAT DE SORTIE OBLIGATOIRE ===\nTa réponse finale doit être UNIQUEMENT un objet JSON valide conforme à ce JSON Schema — aucun texte avant ou après, pas de bloc markdown :\n${JSON.stringify(jsonSchema, null, 2)}`,
    );
    if (schemaError) {
      parts.push(
        `=== CORRECTION REQUISE ===\nTa précédente réponse n'était pas conforme au schéma. Erreur de validation :\n${schemaError}\nRenvoie l'objet JSON complet corrigé.`,
      );
    }
  }

  return { prompt: parts.join("\n\n"), files, hasFiles: files.length > 0, jsonSchema };
}

/** Parse JSON that may be wrapped in prose or a markdown fence. */
export function parseJsonLoose(text) {
  const trimmed = String(text).trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return JSON.parse(fenced[1].trim());
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("Aucun objet JSON trouvé dans la réponse du modèle");
  }
}
