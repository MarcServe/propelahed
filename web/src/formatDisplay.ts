/** Plain-language helpers for the UI (no raw JSON). */

/** Shown when a table cell or score has no value yet. */
export const EMPTY_LABEL = "Not set";

/** Learning store lines sometimes used em dashes; show a plain sentence break instead. */
export function humanizeLearningCopy(text: string): string {
  return text
    .replace(/\s*—\s*/g, ". ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function friendlyRunStatus(status: string): string {
  switch (status) {
    case "succeeded":
      return "Completed successfully";
    case "failed":
      return "Did not complete";
    case "running":
      return "In progress…";
    case "pending":
      return "Waiting to start…";
    default:
      return status;
  }
}

export function shortPath(fullPath: string | null | undefined): string {
  if (!fullPath) return "";
  const parts = fullPath.split(/[/\\]/);
  return parts[parts.length - 1] || fullPath;
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T");
  const d = new Date(normalized.endsWith("Z") ? normalized : normalized + "Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function explainGateFailure(code: string): string {
  const c = code.toLowerCase();
  const hints: [string, string][] = [
    ["target_keyword_not_in_title", "The title must include the main topic phrase from the brief."],
    ["target_keyword_not_in_opening", "The opening text must mention the main topic phrase."],
    ["minimum_word_count", "The article body is shorter than the minimum word count."],
    ["maximum_word_count", "The article body is longer than the allowed maximum."],
    ["meta_description_missing", "The short summary for search results is missing."],
    ["meta_description_length", "The search-result summary is too long (max 160 characters)."],
    ["title_missing", "The headline is missing."],
    ["h2_headers", "The article needs more section headings (## in the draft)."],
    ["slug_missing", "The web address slug for the article is missing."],
    ["body_missing", "The article body is missing."],
    ["duplicate_topic", "This title or address is too similar to an article you already published."],
    ["schema:", "A required field in the generated draft was missing or invalid."],
  ];
  for (const [needle, msg] of hints) {
    if (c.includes(needle)) return msg;
  }
  return code.replace(/_/g, " ");
}

/** Soft warnings from the gate (free-text lines, often with metrics). */
export function explainWarning(line: string): string {
  const low = line.toLowerCase();
  if (low.includes("keyword_density_low")) {
    return "The focus phrase appears less often in the body than the recommended range (it can still publish if nothing else failed).";
  }
  if (low.includes("keyword_density_high")) {
    return "The focus phrase appears very often in the body; it may sound repetitive.";
  }
  if (low.includes("no_internal_link")) {
    return "The draft had no internal links using the [LINK: page-name] placeholder.";
  }
  if (low.includes("no_conclusion")) {
    return "A clear closing or conclusion section was not detected.";
  }
  if (low.includes("readability_complex")) {
    return "The reading level looks harder than ideal (very long or dense sentences).";
  }
  if (low.includes("readability_too_simple")) {
    return "The reading level looks simpler than ideal.";
  }
  return line;
}

export function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter(Boolean);
}

export function scoreOutOf(n: unknown, max: number): string {
  const x = typeof n === "number" ? n : parseFloat(String(n));
  if (Number.isNaN(x)) return "Not scored";
  return `${Math.round(x * 10) / 10} / ${max}`;
}
