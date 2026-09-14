/** Shared rendering helpers. Everything user-supplied goes through esc(). */

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function scoreTone(score) {
  if (score === null || score === undefined) return "";
  if (score >= 75) return "good";
  if (score >= 55) return "mid";
  return "bad";
}

export function pill(text, tone = "") {
  return `<span class="pill ${tone}">${esc(text)}</span>`;
}

export function scorePill(score, suffix = "") {
  return pill(score === null || score === undefined ? "—" : `${score}${suffix}`, scoreTone(score));
}

export function ratioPill(score, max) {
  const pct = max > 0 ? (score / max) * 100 : null;
  return pill(`${score ?? "—"}/${max}`, scoreTone(pct));
}

export function strengthPill(strength) {
  const tone = { STRONG: "good", MEDIUM: "mid", WEAK: "bad", NONE: "bad" }[strength] || "";
  return pill(strength || "—", tone);
}

const TONE_COLOR = { good: "#3ecf8e", mid: "#ffb454", bad: "#ff6b7a", "": "#5f6894" };

/** Circular score gauge (0-100). */
export function ring(label, score, sub = "") {
  const value = score === null || score === undefined ? null : Math.max(0, Math.min(100, Number(score)));
  const tone = scoreTone(value);
  const color = TONE_COLOR[tone];
  const r = 26;
  const c = 2 * Math.PI * r;
  const filled = value === null ? 0 : (value / 100) * c;
  return `
    <div class="ring">
      <svg width="66" height="66" viewBox="0 0 66 66" aria-hidden="true">
        <circle cx="33" cy="33" r="${r}" fill="none" stroke="#252c4d" stroke-width="6" />
        <circle cx="33" cy="33" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"
                stroke-dasharray="${filled.toFixed(1)} ${(c - filled).toFixed(1)}" transform="rotate(-90 33 33)" />
        <text x="33" y="38" text-anchor="middle" fill="${color}" font-size="17" font-weight="650"
              font-family="Inter, Segoe UI, sans-serif">${value === null ? "—" : value}</text>
      </svg>
      <div class="rl">${esc(label)}</div>
      ${sub ? `<div class="rs">${esc(sub)}</div>` : ""}
    </div>`;
}

export function fmtDate(iso) {
  return iso ? iso.slice(0, 10) : "—";
}

export function fmtAgo(iso) {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3600)} h`;
}

export function fmtDuration(ms) {
  if (!ms && ms !== 0) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** Minimal, escape-first markdown: headings, bold, italic, code, lists, links off. */
export function markdown(text) {
  const lines = esc(text || "").split("\n");
  const out = [];
  let inList = null;
  let inCode = false;
  const closeList = () => {
    if (inList) {
      out.push(inList === "ul" ? "</ul>" : "</ol>");
      inList = null;
    }
  };
  for (const raw of lines) {
    const line = raw.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    if (/^```/.test(raw)) {
      closeList();
      out.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(raw);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      closeList();
      out.push(`<h3>${heading[2]}</h3>`);
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      if (inList !== "ul") {
        closeList();
        out.push("<ul>");
        inList = "ul";
      }
      out.push(`<li>${ul[1]}</li>`);
      continue;
    }
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      if (inList !== "ol") {
        closeList();
        out.push("<ol>");
        inList = "ol";
      }
      out.push(`<li>${ol[1]}</li>`);
      continue;
    }
    if (!line.trim()) {
      closeList();
      continue;
    }
    closeList();
    out.push(`<p>${line}</p>`);
  }
  closeList();
  if (inCode) out.push("</code></pre>");
  return out.join("\n");
}

export function dropzoneHtml(name, title, hint, multiple, accept) {
  return `
    <label class="dropzone" id="dz-${name}">
      <span class="dz-title">${title}</span>
      <span class="dz-hint">${hint}</span>
      <span class="dz-files"></span>
      <input type="file" name="${name}" ${multiple ? "multiple" : ""} accept="${accept}" hidden />
    </label>`;
}

export function bindDropzones(root = document) {
  root.querySelectorAll(".dropzone").forEach((dz) => {
    const input = dz.querySelector("input[type=file]");
    const filesLabel = dz.querySelector(".dz-files");
    const refresh = () => {
      const names = [...input.files].map((f) => f.name);
      filesLabel.textContent = names.length ? names.join(", ") : "";
      dz.classList.toggle("filled", names.length > 0);
    };
    input.addEventListener("change", refresh);
    dz.addEventListener("dragover", (e) => {
      e.preventDefault();
      dz.classList.add("drag");
    });
    dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
    dz.addEventListener("drop", (e) => {
      e.preventDefault();
      dz.classList.remove("drag");
      const dt = new DataTransfer();
      if (input.multiple) [...input.files].forEach((f) => dt.items.add(f));
      [...e.dataTransfer.files].forEach((f) => dt.items.add(f));
      input.files = dt.files;
      refresh();
    });
  });
}

/** Wire every [data-copy="elementId"] button in a container. */
export function bindCopyButtons(root) {
  root.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.copy);
      if (!target) return;
      navigator.clipboard.writeText(target.textContent).then(() => {
        const original = btn.textContent;
        btn.textContent = "✓ Copié";
        setTimeout(() => (btn.textContent = original), 1500);
      });
    });
  });
}

export const VERDICT_LABELS = {
  APPLY_NOW: "APPLY NOW",
  IMPROVE_FIRST: "IMPROVE FIRST",
  LOW_PRIORITY: "LOW PRIORITY",
  DO_NOT_APPLY: "DO NOT APPLY",
};

export const STAGE_LABELS = {
  job: "Lecture de l'offre",
  research: "Recherche entreprise",
  thesis: "Thèse de recrutement",
  opportunity: "Score d'opportunité",
  evidence_bank: "Evidence Bank (CV)",
  mapping: "Mapping requirements",
  cv_evaluation: "Évaluation du CV",
  adversarial: "Revue adversariale",
  benchmark: "Benchmark concurrentiel",
  letter_analysis: "Analyse de la lettre",
  improvement_plan: "Plan d'amélioration",
  optimized_cv: "CV optimisé",
  optimized_letter: "Lettre optimisée",
  quality_control: "Contrôle qualité",
  comparison: "Comparaison de versions",
  report: "Rapport final",
};
