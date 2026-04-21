import yaml from "js-yaml";

export type PublishDestination = "LOCAL_MARKDOWN" | "GHOST_API" | "WEBHOOK";

/** Editable workspace settings (mirrors `seo_engine.engine.state.ClientConfig`). */
export type WorkspaceConfigForm = {
  client_id: string;
  domain: string;
  topic_cluster_lines: string;
  excluded_topics_lines: string;
  target_audience: string;
  tone: string;
  brand_voice_notes: string;
  publish_destination: PublishDestination;
  output_dir: string;
  ghost_api_url: string;
  ghost_api_key: string;
  webhook_url: string;
  min_word_count: number;
  max_word_count: number;
  target_word_count: number;
  keyword_data_source: string;
  serper_api_key: string;
  autopilot_enabled: boolean;
  /** Time of day HH:MM (24h) on the host computer for at most one automatic run per day while the app stays running */
  autopilot_time: string;
};

export const EMPTY_FORM: WorkspaceConfigForm = {
  client_id: "",
  domain: "",
  topic_cluster_lines: "",
  excluded_topics_lines: "",
  target_audience: "",
  tone: "",
  brand_voice_notes: "",
  publish_destination: "LOCAL_MARKDOWN",
  output_dir: "./output",
  ghost_api_url: "",
  ghost_api_key: "",
  webhook_url: "",
  min_word_count: 600,
  max_word_count: 4000,
  target_word_count: 1200,
  keyword_data_source: "MOCK",
  serper_api_key: "",
  autopilot_enabled: false,
  autopilot_time: "09:00",
};

export function linesToList(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function listToLines(items: string[]): string {
  return items.join("\n");
}

function asString(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v);
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string") {
    return v
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function asInt(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = parseInt(v, 10);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

function asPublishDestination(v: unknown): PublishDestination {
  const s = asString(v);
  if (s === "GHOST_API" || s === "WEBHOOK" || s === "LOCAL_MARKDOWN") return s;
  return "LOCAL_MARKDOWN";
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === 1) return true;
  if (v === "false" || v === 0) return false;
  return fallback;
}

/** Parse server YAML text into structured form fields. */
export function parseYamlToForm(text: string): WorkspaceConfigForm {
  const raw = yaml.load(text);
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...EMPTY_FORM };
  }
  const o = raw as Record<string, unknown>;
  return {
    client_id: asString(o.client_id),
    domain: asString(o.domain),
    topic_cluster_lines: listToLines(asStringArray(o.topic_cluster)),
    excluded_topics_lines: listToLines(asStringArray(o.excluded_topics)),
    target_audience: asString(o.target_audience),
    tone: asString(o.tone),
    brand_voice_notes: asString(o.brand_voice_notes),
    publish_destination: asPublishDestination(o.publish_destination),
    output_dir: asString(o.output_dir),
    ghost_api_url: asString(o.ghost_api_url),
    ghost_api_key: asString(o.ghost_api_key),
    webhook_url: asString(o.webhook_url),
    min_word_count: asInt(o.min_word_count, EMPTY_FORM.min_word_count),
    max_word_count: asInt(o.max_word_count, EMPTY_FORM.max_word_count),
    target_word_count: asInt(o.target_word_count, EMPTY_FORM.target_word_count),
    keyword_data_source: asString(o.keyword_data_source) || EMPTY_FORM.keyword_data_source,
    serper_api_key: asString(o.serper_api_key),
    autopilot_enabled: asBool(o.autopilot_enabled, false),
    autopilot_time: asString(o.autopilot_time).trim() || EMPTY_FORM.autopilot_time,
  };
}

/** Build a plain object suitable for YAML export (matches Python loader expectations). */
export function formToSerializableObject(form: WorkspaceConfigForm): Record<string, unknown> {
  const topic_cluster = linesToList(form.topic_cluster_lines);
  const excluded_topics = linesToList(form.excluded_topics_lines);

  const out: Record<string, unknown> = {
    client_id: form.client_id,
    domain: form.domain,
    topic_cluster,
    target_audience: form.target_audience,
    tone: form.tone,
    publish_destination: form.publish_destination,
    output_dir: form.output_dir,
    min_word_count: form.min_word_count,
    max_word_count: form.max_word_count,
    target_word_count: form.target_word_count,
    keyword_data_source: form.keyword_data_source,
  };

  if (excluded_topics.length) {
    out.excluded_topics = excluded_topics;
  }

  if (form.brand_voice_notes.trim()) {
    out.brand_voice_notes = form.brand_voice_notes.trim();
  }

  if (form.publish_destination === "GHOST_API") {
    if (form.ghost_api_url.trim()) out.ghost_api_url = form.ghost_api_url.trim();
    if (form.ghost_api_key.trim()) out.ghost_api_key = form.ghost_api_key.trim();
  }

  if (form.publish_destination === "WEBHOOK" && form.webhook_url.trim()) {
    out.webhook_url = form.webhook_url.trim();
  }

  const serperResolved = form.serper_api_key.trim();
  if (serperResolved) {
    out.serper_api_key = serperResolved;
  }

  out.autopilot_enabled = Boolean(form.autopilot_enabled);
  out.autopilot_time = form.autopilot_time.trim() || "09:00";

  return out;
}

/**
 * When the UI masks the Serper field as empty but a key already exists on disk, merge so Save does not drop it.
 * `removeRequested` forces omission (clear key on next save).
 */
export function resolveSerperForSave(
  formSerperInput: string,
  opts: { storedKey: string; removeRequested: boolean },
): string {
  if (opts.removeRequested) return "";
  const t = formSerperInput.trim();
  if (t) return t;
  return (opts.storedKey || "").trim();
}

export function formToYamlString(form: WorkspaceConfigForm): string {
  const obj = formToSerializableObject(form);
  return yaml.dump(obj, {
    lineWidth: -1,
    noRefs: true,
    schema: yaml.DEFAULT_SCHEMA,
  });
}
