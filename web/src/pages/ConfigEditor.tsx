import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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

export default function ConfigEditor({ clientId }: { clientId: string }) {
  const baseId = useId();
  const [tab, setTab] = useState<TabId>("basics");
  const [form, setForm] = useState<WorkspaceConfigForm>(() => ({ ...EMPTY_FORM }));
  const [rawYaml, setRawYaml] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** Last Serper key loaded from disk / saved (field is often left blank to mean “keep”). */
  const [storedSerperKey, setStoredSerperKey] = useState("");
  const [serperRemoveRequested, setSerperRemoveRequested] = useState(false);
  /** Read on save: browsers/password managers sometimes fill the DOM without firing onChange. */
  const serperInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    setMsg(null);
    setErr(null);
    setLoadError(null);
    fetch(`/api/clients/${encodeURIComponent(clientId)}/config`)
      .then((r) => r.json())
      .then((d: { yaml?: string }) => {
        const text = d.yaml ?? "";
        setRawYaml(text);
        try {
          const parsed = parseYamlToForm(text);
          setStoredSerperKey(parsed.serper_api_key);
          setSerperRemoveRequested(false);
          setForm({ ...parsed, serper_api_key: "" });
        } catch (e) {
          setLoadError(e instanceof Error ? e.message : "Could not read settings file.");
          setForm({ ...EMPTY_FORM, client_id: clientId });
          setStoredSerperKey("");
          setSerperRemoveRequested(false);
        }
      })
      .catch(() => setErr("Failed to load settings."));
  }, [clientId]);

  useEffect(() => {
    if (tab === "raw") {
      try {
        setRawYaml(formToYamlString(formMergedForYaml));
      } catch {
        /* keep previous rawYaml */
      }
    }
  }, [tab, formMergedForYaml]);

  async function save() {
    setMsg(null);
    setErr(null);
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
      setErr(formatSaveErrorDetail(body, res.statusText));
      return;
    }
    setMsg("Settings saved. You can use “Write new article” when ready.");
    try {
      const next = parseYamlToForm(yamlText);
      setStoredSerperKey(next.serper_api_key);
      setSerperRemoveRequested(false);
      setForm({ ...next, serper_api_key: "" });
      setRawYaml(yamlText);
    } catch {
      /* ignore */
    }
  }

  function applyRawYaml() {
    setErr(null);
    try {
      const parsed = parseYamlToForm(rawYaml);
      setStoredSerperKey(parsed.serper_api_key);
      setSerperRemoveRequested(false);
      setForm({ ...parsed, serper_api_key: "" });
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
        through each area. Everything is saved together when you click <strong>Save settings</strong>.
      </p>
      {loadError && (
        <p className="status bad">
          The file could not be parsed into fields ({loadError}). You can fix it under{" "}
          <strong>Raw YAML</strong> or ask your technical contact for help.
        </p>
      )}
      {err && <p className="status bad">{err}</p>}
      {msg && <p className="status ok">{msg}</p>}

      <div className="row" style={{ marginBottom: "1rem", alignItems: "stretch" }}>
        <button type="button" onClick={() => void save()}>
          Save settings
        </button>
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
          <strong>Multi-client / agency:</strong> each workspace has its own settings file in your project folder. Choose Serper
          below and paste that client&apos;s key so keyword research is billed per business. Leave the key blank to use the
          single <code>SERPER_API_KEY</code> from the project <code>.env</code> for every workspace instead.
        </p>
        <FormField
          id={`${baseId}-keyword_data_source`}
          label="Keyword data source"
          hint="MOCK builds sample gaps from your topic list only. Serper calls the live Google Search API via Serper (you need at least one topic under Topics & voice)."
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
            <option value="SERPER">Serper (live search data, needs API key)</option>
          </select>
        </FormField>
        <FormField
          id={`${baseId}-serper_api_key`}
          label="Serper API key for this workspace"
          hint="The field is left blank on load when a key is already saved (so it is not shown on screen). Type only when adding or replacing. Saving always keeps the stored key unless you replace it or click Remove."
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
                  : "Paste client Serper key, or rely on .env"
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
          <button type="button" className="secondary" onClick={() => setRawYaml(formToYamlString(formMergedForYaml))}>
            Reset from form fields
          </button>
        </div>
        <textarea
          className="code"
          style={{ minHeight: "380px" }}
          value={rawYaml}
          onChange={(e) => setRawYaml(e.target.value)}
          spellCheck={false}
          aria-label="Raw YAML configuration"
        />
      </div>

      <p className="prose-muted" style={{ marginTop: "1rem" }}>
        Saving writes to your <code>seo_engine/config/</code> file for this workspace. Invalid settings are rejected before
        they are saved.
      </p>
    </div>
  );
}
