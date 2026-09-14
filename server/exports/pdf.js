import PDFDocument from "pdfkit";

/**
 * Minimal Markdown -> PDF renderer (pdfkit, standard fonts, no headless browser).
 * Supports the subset the export documents actually use: headings, paragraphs
 * with **bold** / *italic*, bullet and numbered lists, pipe tables, rules.
 */

const PAGE = { size: "A4", margin: 54 };
const COLORS = { text: "#1b1f2e", muted: "#5d6478", accent: "#3d4ea8", rule: "#d7dbe6", headBg: "#eef1f8" };

// Standard PDF fonts are WinAnsi-encoded: anything outside it must be mapped,
// otherwise pdfkit silently drops or mangles the glyph.
const CHAR_MAP = {
  "→": "->",
  "←": "<-",
  "↔": "<->",
  "⇒": "=>",
  "’": "'",
  "‘": "'",
  "“": '"',
  "”": '"',
  "…": "...",
  "•": "-",
  "≥": ">=",
  "≤": "<=",
  "≈": "~",
  " ": " ",
  " ": " ",
  "✓": "[ok]",
  "✗": "[x]",
  "⚠": "[!]",
};

// Outside Latin-1 but present in WinAnsi, so the standard fonts render them:
// em/en dashes, French oe ligature, euro, trademark, dagger, per-mille.
const WINANSI_EXTRA = "€ƒ†‡ˆ‰Š‹ŒŽ–—˜™š›œžŸ";

function sanitize(text) {
  let out = String(text ?? "");
  for (const [from, to] of Object.entries(CHAR_MAP)) out = out.split(from).join(to);
  // Drop anything still unsupported (emoji, rare symbols) rather than risk a broken glyph.
  return out.replace(/[^\x00-\xFF]/g, (c) => (WINANSI_EXTRA.includes(c) ? c : ""));
}

/** Split a line into {text, bold, italic} runs from **bold** / *italic* markers. */
function inlineRuns(line) {
  const runs = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let match;
  while ((match = re.exec(line)) !== null) {
    if (match.index > last) runs.push({ text: line.slice(last, match.index), bold: false, italic: false });
    const token = match[0];
    if (token.startsWith("**")) runs.push({ text: token.slice(2, -2), bold: true, italic: false });
    else runs.push({ text: token.slice(1, -1), bold: false, italic: true });
    last = match.index + token.length;
  }
  if (last < line.length) runs.push({ text: line.slice(last), bold: false, italic: false });
  return runs.length ? runs : [{ text: line, bold: false, italic: false }];
}

function fontFor(bold, italic) {
  if (bold && italic) return "Helvetica-BoldOblique";
  if (bold) return "Helvetica-Bold";
  if (italic) return "Helvetica-Oblique";
  return "Helvetica";
}

function writeRuns(doc, line, { size = 10, color = COLORS.text, indent = 0, paragraphGap = 6 } = {}) {
  const runs = inlineRuns(line);
  doc.fontSize(size).fillColor(color);
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right - indent;
  const x = doc.page.margins.left + indent;
  runs.forEach((run, i) => {
    const isLast = i === runs.length - 1;
    doc.font(fontFor(run.bold, run.italic));
    const options = { continued: !isLast, paragraphGap: isLast ? paragraphGap : 0 };
    if (i === 0) doc.text(sanitize(run.text), x, doc.y, { ...options, width, align: "left" });
    else doc.text(sanitize(run.text), options);
  });
}

function parseTable(lines, start) {
  const rows = [];
  let i = start;
  while (i < lines.length && /^\s*\|/.test(lines[i])) {
    const cells = lines[i]
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    if (!cells.every((c) => /^-{3,}$/.test(c))) rows.push(cells);
    i++;
  }
  return { rows, next: i };
}

function drawTable(doc, rows) {
  if (!rows.length) return;
  const [header, ...body] = rows;
  const columns = header.length;
  const available = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // Column widths proportional to the longest content, clamped so no column collapses.
  const weights = header.map((_, c) => {
    const longest = Math.max(...rows.map((r) => sanitize(r[c] || "").length));
    return Math.max(longest, 6);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.max(48, (w / total) * available));
  const scale = available / widths.reduce((a, b) => a + b, 0);
  const finalWidths = widths.map((w) => w * scale);

  const padding = 5;
  const rowHeight = (cells, bold) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
    return (
      Math.max(
        ...cells.map((cell, c) => doc.heightOfString(sanitize(cell || ""), { width: finalWidths[c] - padding * 2 })),
      ) +
      padding * 2
    );
  };

  const drawRow = (cells, bold) => {
    const height = rowHeight(cells, bold);
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const top = doc.y;
    let x = doc.page.margins.left;
    if (bold) doc.rect(x, top, available, height).fill(COLORS.headBg);
    cells.forEach((cell, c) => {
      doc
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(9)
        .fillColor(bold ? COLORS.accent : COLORS.text)
        .text(sanitize(cell || ""), x + padding, top + padding, { width: finalWidths[c] - padding * 2 });
      x += finalWidths[c];
    });
    doc
      .moveTo(doc.page.margins.left, top + height)
      .lineTo(doc.page.margins.left + available, top + height)
      .lineWidth(0.5)
      .strokeColor(COLORS.rule)
      .stroke();
    doc.y = top + height;
  };

  drawRow(header, true);
  body.forEach((row) => drawRow(row, false));
  doc.moveDown(0.8);
}

/** Render a markdown string to a PDF Buffer. */
export function markdownToPdf(markdown, { title = "", subject = "" } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ ...PAGE, bufferPages: true, info: { Title: sanitize(title), Subject: sanitize(subject) } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const lines = String(markdown).replace(/\r\n/g, "\n").split("\n");
    let i = 0;
    let listIndex = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (/^\s*\|/.test(line)) {
        const { rows, next } = parseTable(lines, i);
        drawTable(doc, rows);
        i = next;
        continue;
      }

      if (!line.trim()) {
        listIndex = 0;
        i++;
        continue;
      }

      if (/^---+$/.test(line.trim())) {
        doc
          .moveTo(doc.page.margins.left, doc.y + 4)
          .lineTo(doc.page.width - doc.page.margins.right, doc.y + 4)
          .lineWidth(0.7)
          .strokeColor(COLORS.rule)
          .stroke();
        doc.moveDown(0.8);
        i++;
        continue;
      }

      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        const sizes = { 1: 20, 2: 14, 3: 11.5, 4: 10.5 };
        const space = { 1: 10, 2: 16, 3: 10, 4: 8 };
        if (doc.y + 60 > doc.page.height - doc.page.margins.bottom) doc.addPage();
        else if (doc.y > doc.page.margins.top) doc.moveDown(space[level] / 14);
        doc
          .font("Helvetica-Bold")
          .fontSize(sizes[level])
          .fillColor(level === 1 ? COLORS.text : COLORS.accent)
          .text(sanitize(heading[2]), doc.page.margins.left, doc.y, {
            width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
          });
        if (level === 1) {
          doc
            .moveTo(doc.page.margins.left, doc.y + 5)
            .lineTo(doc.page.width - doc.page.margins.right, doc.y + 5)
            .lineWidth(1.2)
            .strokeColor(COLORS.accent)
            .stroke();
          doc.moveDown(0.9);
        } else {
          doc.moveDown(0.35);
        }
        i++;
        continue;
      }

      const bullet = line.match(/^\s*[-*]\s+(.*)$/);
      if (bullet) {
        const top = doc.y;
        doc.font("Helvetica").fontSize(10).fillColor(COLORS.muted).text("•", doc.page.margins.left + 4, top, { lineBreak: false, width: 12 });
        doc.y = top;
        writeRuns(doc, bullet[1], { indent: 16, paragraphGap: 4 });
        i++;
        continue;
      }

      const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
      if (numbered) {
        listIndex = Number(numbered[1]);
        const top = doc.y;
        doc.font("Helvetica").fontSize(10).fillColor(COLORS.muted).text(`${listIndex}.`, doc.page.margins.left + 2, top, { lineBreak: false, width: 18 });
        doc.y = top;
        writeRuns(doc, numbered[2], { indent: 20, paragraphGap: 4 });
        i++;
        continue;
      }

      writeRuns(doc, line, { size: 10, paragraphGap: 7 });
      i++;
    }

    // Footer with page numbers, added once the content is laid out.
    const range = doc.bufferedPageRange();
    for (let p = range.start; p < range.start + range.count; p++) {
      doc.switchToPage(p);
      const y = doc.page.height - doc.page.margins.bottom + 18;
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(COLORS.muted)
        .text(sanitize(title), doc.page.margins.left, y, {
          width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
          align: "left",
          lineBreak: false,
        });
      doc.text(`${p - range.start + 1} / ${range.count}`, doc.page.margins.left, y, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: "right",
        lineBreak: false,
      });
    }

    doc.end();
  });
}
