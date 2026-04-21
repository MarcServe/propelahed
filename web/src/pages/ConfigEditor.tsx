import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import FormField from "../components/FormField";
import PageTabs, { tabPanelAttrs } from "../components/PageTabs";
import {
  EMPTY_FORM,
  type WorkspaceConfigForm,
  formToYamlString,
  parseYamlToForm,
  resolveSerperForSave,
} from "../workspaceConfig";

type TabId = "basics" | "topics" | "publishing" | "schedule" | "lengths" | "raw";

function formatSaveErrorDetail(body: unknown, statusText: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
      return d
        .map((item) => {
          if (typeof item === "object" && item !== null && "msg" in item) {
            return String((item as { msg?: unknown }).msg);
          }
          return typeof item === "string" ? item : JSON.stringify(item);
        })
        .join(" ");
    }
  }
  return statusText;
}

const TABS: { id: TabId; label: string; hint: string }[] = [
  { id: "basics", label: "Business & site", hint: "Name and domain" },
  { id: "topics", label: "Topics & voice", hint: "What you write about and how it sounds" },
  { id: "publishing", label: "Publishing", hint: "Where drafts are saved or sent" },
  { id: "schedule", label: "Schedule & autopilot", hint: "Optional daily run while the app stays open" },
  { id: "lengths", label: "Length & data", hint: "Article size and keyword data" },
  { id: "raw", label: "Raw YAML", hint: "For technical users" },
];

/** v1: sessionStorage JSON of form only. v2: localStorage full workspace draft. */
const DRAFT_V1_PREFIX = "propelhed-config-draft-v1:";
const DRAFT_V2_PREFIX = "propelhed-config-draft-v2:";

type WorkspaceConfigDraftV2 = {
  v: 2;
  client_id: string;
  form: WorkspaceConfigForm;
  rawYaml: string;
  /** True if Raw YAML was edited independently (not only synced from form fields). */
  rawYamlDirty: boolean;
  tab: TabId;
  serperRemoveRequested: boolean;
};

function draftStorageKeyV2(workspaceId: string) {
  return `${DRAFT_V2_PREFIX}${workspaceId}`;
}

function readWorkspaceDraft(workspaceId: string): WorkspaceConfigDraftV2 | null {
  try {
    const v2 = localStorage.getItem(draftStorageKeyV2(workspaceId));
    if (v2) {
      const o = JSON.parse(v2) as Partial<WorkspaceConfigDraftV2>;
      if (o.v === 2 && o.client_id === workspaceId && o.form && typeof o.form === "object") {
        return {
          v: 2,
          client_id: workspaceId,
          form: { ...o.form, serper_api_key: "", client_id: workspaceId },
          rawYaml: typeof o.rawYaml === "string" ? o.rawYaml : "",
          rawYamlDirty: Boolean(o.rawYamlDirty),
          tab: (TABS.some((t) => t.id === o.tab) ? o.tab : "basics") as TabId,
          serperRemoveRequested: Boolean(o.serperRemoveRequested),
        };
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const legacy = sessionStorage.getItem(`${DRAFT_V1_PREFIX}${workspaceId}`);
    if (!legacy) return null;
    const form = JSON.parse(legacy) as Partial<WorkspaceConfigForm>;
    if (form.client_id !== workspaceId) return null;
    return {
      v: 2,
      client_id: workspaceId,
      form: { ...EMPTY_FORM, ...form, serper_api_key: "", client_id: workspaceId },
      rawYaml: "",
      rawYamlDirty: false,
      tab: "basics",
      serperRemoveRequested: false,
    };
  } catch {
    return null;
  }
}

function clearWorkspaceDraft(workspaceId: string) {
  try {
    localStorage.removeItem(draftStorageKeyV2(workspaceId));
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.removeItem(`${DRAFT_V1_PREFIX}${workspaceId}`);
  } catch {
    /* ignore */
  }
}

/** Avoid persisting while switching workspace in the toolbar before the new config has loaded. */
function canPersistDraftForWorkspace(selectedClientId: string, form: WorkspaceConfigForm): boolean {
  return form.client_id.trim() === selectedClientId.trim();
}

export default function ConfigEditor({ clientId }: { clientId: string }) {
  const baseId = useId();
  const [tab, setTab] = useState<TabId>("basics");
  const [form, setForm] = useState<WorkspaceConfigForm>(() => ({ ...EMPTY_FORM }));
  const [rawYaml, setRawYaml] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Last Serper key loaded from disk / saved (field is often left blank to mean “keep”). */
  const [storedSerperKey, setStoredSerperKey] = useState("");
  const [serperRemoveRequested, setSerperRemoveRequested] = useState(false);
  /** True when Raw YAML textarea was edited (vs synced from form / server). */
  const [rawYamlDirty, setRawYamlDirty] = useState(false);
  /** True after load finishes (or fails); avoids overwriting session draft before the server form is applied. */
  const [hydrated, setHydrated] = useState(false);
  /** Read on save: browsers/password managers sometimes fill the DOM without firing onChange. */
  const serperInputRef = useRef<HTMLInputElement>(null);
  const prevTabRef = useRef<TabId | null>(null);
  /** After Save, restore scroll position once layout updates (avoids jump when status line appears). */
  const scrollRestoreAfterSaveRef = useRef<number | null>(null);
  /** Latest settings snapshot for synchronous flush (debounce cleanup / unmount). */
  const draftLiveRef = useRef<{
    clientId: string;
    hydrated: boolean;
    form: WorkspaceConfigForm;
    rawYaml: string;
    rawYamlDirty: boolean;
    tab: TabId;
    serperRemoveRequested: boolean;
  } | null>(null);

  const patch = useCallback((partial: Partial<WorkspaceConfigForm>) => {
    setForm((f) => ({ ...f, ...partial }));
  }, []);

  const formMergedForYaml = useMemo(
    () => ({
      ...form,
      serper_api_key: resolveSerperForSave(form.serper_api_key, {
        storedKey: storedSerperKey,
        removeRequested: serperRemoveRequested,
      }),
    }),
    [form, storedSerperKey, serperRemoveRequested],
  );

  draftLiveRef.current = {
    clientId,
    hydrated,
    form,
    rawYaml,
    rawYamlDirty,
    tab,
    serperRemoveRequested,
  };

  useEffect(() => {
    const ac = new AbortController();
    setMsg(null);
    setErr(null);
    setLoadError(null);
    setHydrated(false);

    (async () => {
      try {
        const r = await fetch(`/api/clients/${encodeURIComponent(clientId)}/config`, {
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        const d = (await r.json()) as { yaml?: string };
        if (ac.signal.aborted) return;
        const text = d.yaml ?? "";
        try {
          const parsed = parseYamlToForm(text);
          setStoredSerperKey(parsed.serper_api_key);
          const base = { ...parsed, serper_api_key: "" };
          const draft = readWorkspaceDraft(clientId);
          if (draft) {
            const merged = { ...base, ...draft.form, serper_api_key: "", client_id: clientId };
            setForm(merged);
            setSerperRemoveRequested(draft.serperRemoveRequested);
            setTab(draft.tab);
            if (draft.rawYamlDirty) {
              setRawYaml(draft.rawYaml);
              setRawYamlDirty(true);
            } else {
              setRawYamlDirty(false);
              try {
                const mergedForYaml: WorkspaceConfigForm = {
                  ...merged,
                  serper_api_key: resolveSerperForSave(merged.serper_api_key, {
                    storedKey: parsed.serper_api_key,
                    removeRequested: draft.serperRemoveRequested,
                  }),
                };
                setRawYaml(formToYamlString(mergedForYaml));
              } catch {
                setRawYaml(text);
              }
            }
          } else {
            setForm(base);
            setSerperRemoveRequested(false);
            setRawYaml(text);
            setRawYamlDirty(false);
          }
        } catch (e) {
          setLoadError(e instanceof Error ? e.message : "Could not read settings file.");
          const base = { ...EMPTY_FORM, client_id: clientId };
          const draft = readWorkspaceDraft(clientId);
          if (draft) {
            const merged = { ...base, ...draft.form, serper_api_key: "", client_id: clientId };
            setForm(merged);
            setSerperRemoveRequested(draft.serperRemoveRequested);
            setTab(draft.tab);
            if (draft.rawYamlDirty) {
              setRawYaml(draft.rawYaml);
              setRawYamlDirty(true);
            } else {
              setRawYaml(text);
              setRawYamlDirty(false);
            }
          } else {
            setForm(base);
            setRawYaml(text);
            setSerperRemoveRequested(false);
            setRawYamlDirty(false);
          }
          setStoredSerperKey("");
        }
      } catch (e: unknown) {
        if ((e as { name?: string })?.name === "AbortError") return;
        setErr("Failed to load settings.");
      } finally {
        if (!ac.signal.aborted) setHydrated(true);
      }
    })();

    return () => ac.abort();
  }, [clientId]);

  useEffect(() => {
    if (!hydrated) return;
    const flush = () => {
      const r = draftLiveRef.current;
      if (!r?.hydrated || !canPersistDraftForWorkspace(r.clientId, r.form)) return;
      try {
        const payload: WorkspaceConfigDraftV2 = {
          v: 2,
          client_id: r.clientId,
          form: { ...r.form, serper_api_key: "" },
          rawYaml: r.rawYaml,
          rawYamlDirty: r.rawYamlDirty,
          tab: r.tab,
          serperRemoveRequested: r.serperRemoveRequested,
        };
        localStorage.setItem(draftStorageKeyV2(r.clientId), JSON.stringify(payload));
      } catch {
        /* quota / private mode */
      }
    };
    const t = window.setTimeout(flush, 200);
    return () => {
      window.clearTimeout(t);
      flush();
    };
  }, [form, rawYaml, rawYamlDirty, tab, serperRemoveRequested, clientId, hydrated]);

  useLayoutEffect(() => {
    const y = scrollRestoreAfterSaveRef.current;
    if (y === null) return;
    scrollRestoreAfterSaveRef.current = null;
    window.scrollTo(0, y);
  }, [msg, err]);

  /** When entering Raw YAML from another tab, show the YAML for current form fields unless Raw was edited. */
  useEffect(() => {
    if (tab === "raw") {
      const prev = prevTabRef.current;
      prevTabRef.current = tab;
      if (prev !== "raw" && !rawYamlDirty) {
        try {
          setRawYaml(formToYamlString(formMergedForYaml));
        } catch {
          /* keep previous rawYaml */
        }
      }
    } else {
      prevTabRef.current = tab;
    }
  }, [tab, formMergedForYaml, rawYamlDirty]);

  async function save() {
    if (saving) return;
    setMsg(null);
    setErr(null);
    setSaving(true);
    try {
      const liveSerper = serperInputRef.current?.value ?? form.serper_api_key;
      const mergedForYamlPut: WorkspaceConfigForm = {
        ...form,
        serper_api_key: resolveSerperForSave(liveSerper, {
          storedKey: storedSerperKey,
          removeRequested: serperRemoveRequested,
        }),
      };
      const yamlText = tab === "raw" ? rawYaml : formToYamlString(mergedForYamlPut);
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml: yamlText }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        scrollRestoreAfterSaveRef.current = window.scrollY;
        setErr(formatSaveErrorDetail(body, res.statusText));
        return;
      }
      scrollRestoreAfterSaveRef.current = window.scrollY;
      clearWorkspaceDraft(clientId);
      setMsg("Settings saved. You can use “Write new article” when ready.");
      try {
        const next = parseYamlToForm(yamlText);
        setStoredSerperKey(next.serper_api_key);
        setSerperRemoveRequested(false);
        setForm({ ...next, serper_api_key: "" });
        setRawYaml(yamlText);
        setRawYamlDirty(false);
      } catch {
        /* ignore */
      }
    } finally {
      setSaving(false);
    }
  }

  function applyRawYaml() {
    setErr(null);
    try {
      const parsed = parseYamlToForm(rawYaml);
      setStoredSerperKey(parsed.serper_api_key);
      setSerperRemoveRequested(false);
      setForm({ ...parsed, serper_api_key: "" });
      setRawYamlDirty(false);
      setMsg("Loaded the YAML below into the form fields. Review each tab, then save.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Invalid YAML.");
    }
  }

  const keywordSourceSelectValue = (() => {
    const u = form.keyword_data_source.trim().toUpperCase();
    if (u === "SERPER" || u === "SERPER_API") return "SERPER";
    return "MOCK";
  })();

  return (
    <div>
      <h1>Workspace settings</h1>
      <p className="prose-lead">
        Set your business details, topics, audience, tone, and where drafts go. Use the tabs to move
        through each area. Your edits are remembered in this browser until you save or discard them (use the same URL in
        every browser—either <code>localhost</code> or <code>127.0.0.1</code>, not both—so drafts line up). Everything is
        written to disk when you click <strong>Save settings</strong> (top or bottom of this page).
      </p>
      <div className="config-status-region" aria-live="polite">
        {loadError && (
          <p className="status bad">
            The file could not be parsed into fields ({loadError}). You can fix it under{" "}
            <strong>Raw YAML</strong> or ask your technical contact for help.
          </p>
        )}
        {err && <p className="status bad">{err}</p>}
        {msg && <p className="status ok">{msg}</p>}
      </div>

      <div className="config-save-bar row" style={{ marginBottom: "1rem", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
        <button type="button" onClick={() => void save()} disabled={saving} aria-busy={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
        <span className="prose-muted" style={{ fontSize: "0.9rem" }}>
          Persists to <code>seo_engine/config/{clientId}.yaml</code>
        </span>
      </div>

      <PageTabs
        idPrefix={baseId}
        tabs={TABS}
        active={tab}
        onChange={(id) => setTab(id as TabId)}
        ariaLabel="Workspace setting sections"
      />

      <div className="panel panel--neutral page-tab-panel" {...tabPanelAttrs(baseId, "basics", tab)}>
        <FormField
          id={`${baseId}-client_id`}
          label="Workspace / client ID"
          hint='Short id for this site (usually matches the settings file name, e.g. "talkweb").'
        >
          <input
            id={`${baseId}-client_id`}
            className="form-input"
            value={form.client_id}
            onChange={(e) => patch({ client_id: e.target.value })}
            autoComplete="off"
            spellCheck={false}
          />
        </FormField>
        <FormField
          id={`${baseId}-domain`}
          label="Domain"
          hint="The website this content is for (shown to the model as context)."
        >
          <input
            id={`${baseId}-domain`}
            className="form-input"
            value={form.domain}
            onChange={(e) => patch({ domain: e.target.value })}
            autoComplete="off"
            placeholder="example.com"
          />
        </FormField>
      </div>

      <div className="panel panel--neutral page-tab-panel" {...tabPanelAttrs(baseId, "topics", tab)}>
        <FormField
          id={`${baseId}-topic_cluster`}
          label="Topic cluster"
          hint="Main themes to stay near (one line each). These steer research and drafts."
        >
          <textarea
            id={`${baseId}-topic_cluster`}
            className="prose-input"
            style={{ minHeight: "140px" }}
            value={form.topic_cluster_lines}
            onChange={(e) => patch({ topic_cluster_lines: e.target.value })}
            placeholder={"AI tools for customer support\nIndustry news and trends"}
          />
        </FormField>
        <FormField
          id={`${baseId}-excluded_topics`}
          label="Topics to avoid (optional)"
          hint="Optional. Lines of subjects or phrases the engine should not lean into."
        >
          <textarea
            id={`${baseId}-excluded_topics`}
            className="prose-input"
            style={{ minHeight: "88px" }}
            value={form.excluded_topics_lines}
            onChange={(e) => patch({ excluded_topics_lines: e.target.value })}
          />
        </FormField>
        <FormField
          id={`${baseId}-target_audience`}
          label="Target audience"
          hint="Who the reader is: role, region, industry, and what they need from the content."
        >
          <textarea
            id={`${baseId}-target_audience`}
            className="prose-input"
            style={{ minHeight: "100px" }}
            value={form.target_audience}
            onChange={(e) => patch({ target_audience: e.target.value })}
          />
        </FormField>
        <FormField
          id={`${baseId}-tone`}
          label="Tone of voice"
          hint="How articles should sound (e.g. practical, plain language, no hype)."
        >
          <textarea
            id={`${baseId}-tone`}
            className="prose-input"
            style={{ minHeight: "88px" }}
            value={form.tone}
            onChange={(e) => patch({ tone: e.target.value })}
          />
        </FormField>
        <FormField
          id={`${baseId}-brand_voice_notes`}
          label="Brand voice notes (optional)"
          hint="Extra style rules: words to use or avoid, formatting preferences, disclaimers."
        >
          <textarea
            id={`${baseId}-brand_voice_notes`}
            className="prose-input"
            style={{ minHeight: "88px" }}
            value={form.brand_voice_notes}
            onChange={(e) => patch({ brand_voice_notes: e.target.value })}
          />
        </FormField>
      </div>

      <div className="panel panel--neutral page-tab-panel" {...tabPanelAttrs(baseId, "publishing", tab)}>
        <FormField
          id={`${baseId}-publish_destination`}
          label="Where drafts go"
          hint="Most setups save Markdown files on this computer. Other options need API details."
        >
          <select
            id={`${baseId}-publish_destination`}
            className="form-input form-select"
            value={form.publish_destination}
            onChange={(e) =>
              patch({ publish_destination: e.target.value as WorkspaceConfigForm["publish_destination"] })
            }
          >
            <option value="LOCAL_MARKDOWN">Save as Markdown files (local folder)</option>
            <option value="GHOST_API">Publish to Ghost (API)</option>
            <option value="WEBHOOK">Send to a webhook URL</option>
          </select>
        </FormField>
        <FormField
          id={`${baseId}-output_dir`}
          label="Output folder"
          hint='Where Markdown files are written when using “local files” (path on this machine).'
        >
          <input
            id={`${baseId}-output_dir`}
            className="form-input"
            value={form.output_dir}
            onChange={(e) => patch({ output_dir: e.target.value })}
            spellCheck={false}
            placeholder="./output/yoursite"
          />
        </FormField>
        <FormField
          id={`${baseId}-public_base_url`}
          label="Public site URL (for internal links)"
          hint='Optional. Full origin such as https://talkweb.io — used to turn [LINK: slug] into real links in drafts. Leave blank to use https:// plus your domain above.'
        >
          <input
            id={`${baseId}-public_base_url`}
            className="form-input"
            value={form.public_base_url}
            onChange={(e) => patch({ public_base_url: e.target.value })}
            spellCheck={false}
            placeholder="https://talkweb.io"
            autoComplete="off"
          />
        </FormField>
        <FormField
          id={`${baseId}-url_path_prefix`}
          label="URL path before article slug"
          hint='Optional. For example /blog if URLs look like https://site.com/blog/my-post. Leave empty for https://site.com/my-post.'
        >
          <input
            id={`${baseId}-url_path_prefix`}
            className="form-input"
            value={form.url_path_prefix}
            onChange={(e) => patch({ url_path_prefix: e.target.value })}
            spellCheck={false}
            placeholder="/blog"
            autoComplete="off"
          />
        </FormField>
        {form.publish_destination === "GHOST_API" && (
          <>
            <FormField
              id={`${baseId}-ghost_api_url`}
              label="Ghost Admin API URL"
              hint="Base URL of your Ghost site’s Admin API (from your Ghost settings)."
            >
              <input
                id={`${baseId}-ghost_api_url`}
                className="form-input"
                value={form.ghost_api_url}
                onChange={(e) => patch({ ghost_api_url: e.target.value })}
                autoComplete="off"
              />
            </FormField>
            <FormField
              id={`${baseId}-ghost_api_key`}
              label="Ghost Admin API key"
              hint="Keep this secret. Stored in your local settings file only."
            >
              <input
                id={`${baseId}-ghost_api_key`}
                className="form-input"
                type="password"
                value={form.ghost_api_key}
                onChange={(e) => patch({ ghost_api_key: e.target.value })}
                autoComplete="off"
              />
            </FormField>
          </>
        )}
        {form.publish_destination === "WEBHOOK" && (
          <FormField
            id={`${baseId}-webhook_url`}
            label="Webhook URL"
            hint="Endpoint that receives draft payloads when a run finishes."
          >
            <input
              id={`${baseId}-webhook_url`}
              className="form-input"
              value={form.webhook_url}
              onChange={(e) => patch({ webhook_url: e.target.value })}
              autoComplete="off"
              placeholder="https://"
            />
          </FormField>
        )}
      </div>

      <div className="panel panel--neutral page-tab-panel" {...tabPanelAttrs(baseId, "schedule", tab)}>
        <h2 className="prose-h3" style={{ marginTop: 0 }}>
          Daily autopilot (app must stay running)
        </h2>
        <p className="prose-muted" style={{ marginBottom: "1rem" }}>
          When this is on, Content workspace tries to create <strong>one article per day</strong> at the time you choose. It
          uses the same steps as <strong>Write new article</strong> with automatic topic choice (topic cluster, keyword ideas,
          research notes, and learning).{" "}
          <strong>The time uses the clock on the computer where this app is running</strong> (the same timezone you see in
          your system tray or Date &amp; time settings). If you close the app or the computer sleeps, that day&apos;s run is
          skipped until the app is open again.
        </p>
        <FormField
          id={`${baseId}-autopilot`}
          label="Enable daily automatic run"
          hint="Requires a saved time. Disable to run only when you click “Generate” on Write new article."
        >
          <label className="run-mode-option" style={{ padding: "0.5rem 0" }}>
            <input
              id={`${baseId}-autopilot`}
              type="checkbox"
              checked={form.autopilot_enabled}
              onChange={(e) => patch({ autopilot_enabled: e.target.checked })}
            />
            <span className="prose-muted" style={{ marginLeft: "0.35rem" }}>
              Run autopilot for this workspace
            </span>
          </label>
        </FormField>
        <FormField
          id={`${baseId}-autopilot_time`}
          label="Time of day (24-hour clock)"
          hint="Uses this computer’s date and time. Example: 09:00 for a morning run. At most one automatic run per calendar day."
        >
          <input
            id={`${baseId}-autopilot_time`}
            className="form-input"
            type="time"
            value={form.autopilot_time || "09:00"}
            onChange={(e) => patch({ autopilot_time: e.target.value })}
            disabled={!form.autopilot_enabled}
          />
        </FormField>
      </div>

      <div className="panel panel--neutral page-tab-panel" {...tabPanelAttrs(baseId, "lengths", tab)}>
        <div className="form-field-row">
          <FormField
            id={`${baseId}-min_word_count`}
            label="Minimum words"
            hint="Drafts shorter than this fail the quality check."
          >
            <input
              id={`${baseId}-min_word_count`}
              className="form-input"
              type="number"
              min={0}
              value={form.min_word_count}
              onChange={(e) => patch({ min_word_count: parseInt(e.target.value, 10) || 0 })}
            />
          </FormField>
          <FormField
            id={`${baseId}-max_word_count`}
            label="Maximum words"
            hint="Upper bound used when asking the model for length."
          >
            <input
              id={`${baseId}-max_word_count`}
              className="form-input"
              type="number"
              min={0}
              value={form.max_word_count}
              onChange={(e) => patch({ max_word_count: parseInt(e.target.value, 10) || 0 })}
            />
          </FormField>
          <FormField
            id={`${baseId}-target_word_count`}
            label="Target words"
            hint="Aim for this length in the brief and draft."
          >
            <input
              id={`${baseId}-target_word_count`}
              className="form-input"
              type="number"
              min={0}
              value={form.target_word_count}
              onChange={(e) => patch({ target_word_count: parseInt(e.target.value, 10) || 0 })}
            />
          </FormField>
        </div>
        <p className="prose-muted" style={{ marginBottom: "0.75rem", maxWidth: "52rem" }}>
          <strong>Multi-client / agency:</strong> each workspace has its own settings file in your project folder. Choose{" "}
          <strong>Serper</strong> below and paste that client&apos;s key so keyword research is billed per business. Leave the
          key blank to use the single <code>SERPER_API_KEY</code> from the project <code>.env</code> for every workspace
          instead.
        </p>
        <FormField
          id={`${baseId}-keyword_data_source`}
          label="Keyword data source"
          hint="MOCK builds sample gaps from your topic list only. Serper (serper.dev) calls Google Search via that service—you need at least one topic under Topics & voice."
        >
          <select
            id={`${baseId}-keyword_data_source`}
            className="form-input form-select"
            value={keywordSourceSelectValue}
            onChange={(e) => {
              const v = e.target.value;
              patch({ keyword_data_source: v === "SERPER" ? "SERPER" : "MOCK" });
            }}
            aria-label="Keyword data source"
          >
            <option value="MOCK">MOCK (sample keyword ideas, no external API)</option>
            <option value="SERPER">Serper at serper.dev (live search; needs a serper.dev API key)</option>
          </select>
        </FormField>
        <FormField
          id={`${baseId}-serper_api_key`}
          label="Serper API key (serper.dev)"
          hint="Paste the key from your serper.dev dashboard—not SerpApi. The field is left blank on load when a key is already saved. Type only when adding or replacing; Save keeps the stored key unless you replace it or click Remove."
        >
          {storedSerperKey && !serperRemoveRequested ? (
            <p className="status ok" style={{ marginBottom: "0.5rem", fontSize: "0.9rem" }}>
              A key is saved for this workspace
              {storedSerperKey.length >= 4 ? (
                <span className="prose-muted"> (ends with …{storedSerperKey.slice(-4)})</span>
              ) : null}
              . Leave the box empty to keep it, type a new key to replace, or use Remove.
            </p>
          ) : null}
          {serperRemoveRequested ? (
            <p className="prose-muted" style={{ marginBottom: "0.5rem", fontSize: "0.9rem" }}>
              The saved key will be removed when you click <strong>Save settings</strong>. You can paste a new key before
              saving instead.
            </p>
          ) : null}
          <input
            id={`${baseId}-serper_api_key`}
            ref={serperInputRef}
            className="form-input"
            type="password"
            value={form.serper_api_key}
            onChange={(e) => {
              patch({ serper_api_key: e.target.value });
              if (serperRemoveRequested) setSerperRemoveRequested(false);
            }}
            onBlur={() => {
              const el = serperInputRef.current;
              if (el && el.value !== form.serper_api_key) {
                patch({ serper_api_key: el.value });
              }
            }}
            autoComplete="new-password"
            data-lpignore="true"
            data-form-type="other"
            placeholder={
              form.serper_api_key.trim()
                ? "Replace with a new key"
                : storedSerperKey
                  ? "Optional: new key (leave empty to keep saved)"
                  : "serper.dev key, or rely on SERPER_API_KEY in .env"
            }
          />
          <div className="row" style={{ marginTop: "0.5rem", flexWrap: "wrap", gap: "0.5rem" }}>
            <button
              type="button"
              className="secondary"
              disabled={!storedSerperKey || serperRemoveRequested}
              onClick={() => {
                setSerperRemoveRequested(true);
                patch({ serper_api_key: "" });
              }}
            >
              Remove saved Serper key
            </button>
            {serperRemoveRequested ? (
              <button type="button" className="secondary" onClick={() => setSerperRemoveRequested(false)}>
                Undo remove
              </button>
            ) : null}
          </div>
        </FormField>
      </div>

      <div className="panel panel--neutral page-tab-panel" {...tabPanelAttrs(baseId, "raw", tab)}>
        <p className="prose-muted" style={{ marginTop: 0 }}>
          This is the same settings file in YAML form. Edit here if you know the format, or use{" "}
          <strong>Load into form</strong> after pasting, then check the other tabs before saving.
        </p>
        <div className="row" style={{ marginBottom: "0.75rem" }}>
          <button type="button" className="secondary" onClick={applyRawYaml}>
            Load into form
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              try {
                setRawYaml(formToYamlString(formMergedForYaml));
                setRawYamlDirty(false);
              } catch {
                /* keep previous rawYaml */
              }
            }}
          >
            Reset from form fields
          </button>
        </div>
        <textarea
          className="code"
          style={{ minHeight: "380px" }}
          value={rawYaml}
          onChange={(e) => {
            setRawYaml(e.target.value);
            setRawYamlDirty(true);
          }}
          spellCheck={false}
          aria-label="Raw YAML configuration"
        />
      </div>

      <div
        className="config-save-bar config-save-bar--sticky row"
        style={{ marginTop: "1.5rem", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}
      >
        <button type="button" onClick={() => void save()} disabled={saving} aria-busy={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
        <span className="prose-muted" style={{ fontSize: "0.9rem" }}>
          Invalid settings are rejected by the server; fix any red error above and try again.
        </span>
      </div>

      <p className="prose-muted" style={{ marginTop: "1rem" }}>
        Saving writes to your <code>seo_engine/config/</code> file for this workspace. Invalid settings are rejected before
        they are saved.
      </p>
    </div>
  );
}
