import fs from "fs";
import path from "path";
import { createRequire } from "module";

// pdf-parse's index.js runs debug code when it thinks it is the entry module;
// import the library file directly to avoid that.
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

const IMAGE_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export const IMAGE_EXTENSIONS = Object.keys(IMAGE_MIME);
export const DOCUMENT_EXTENSIONS = [".pdf", ".txt", ".md"];

export function isImageFile(filePath) {
  return path.extname(filePath).toLowerCase() in IMAGE_MIME;
}

export function isDocumentFile(filePath) {
  return DOCUMENT_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

export function isPdfFile(filePath) {
  return path.extname(filePath).toLowerCase() === ".pdf";
}

/**
 * Extract plain text from a document (PDF, TXT or MD) without destroying the
 * logical structure (pdf-parse keeps line breaks and reading order).
 */
export async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") {
    const buffer = await fs.promises.readFile(filePath);
    const result = await pdfParse(buffer);
    return (result.text || "").trim();
  }
  if (ext === ".txt" || ext === ".md") {
    return (await fs.promises.readFile(filePath, "utf8")).trim();
  }
  throw new Error(`Unsupported document type: ${ext}`);
}

/**
 * Build an Anthropic content block for a document. PDFs are sent natively as
 * document blocks (best structure preservation); text files as text blocks.
 */
export async function buildDocumentContentBlock(filePath, label) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") {
    const data = (await fs.promises.readFile(filePath)).toString("base64");
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data },
      title: label,
    };
  }
  const text = await extractText(filePath);
  return { type: "text", text: `--- ${label} ---\n${text}` };
}

/** Build an Anthropic image content block for a screenshot. */
export async function buildImageContentBlock(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = IMAGE_MIME[ext];
  if (!mime) throw new Error(`Unsupported image type: ${ext}`);
  const data = (await fs.promises.readFile(filePath)).toString("base64");
  return { type: "image", source: { type: "base64", media_type: mime, data } };
}
