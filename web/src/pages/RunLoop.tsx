import { useEffect, useId, useState } from "react";
import FormField from "../components/FormField";
import PageTabs, { tabPanelAttrs } from "../components/PageTabs";
import { explainGateFailure, friendlyRunStatus, shortPath } from "../formatDisplay";

type Job = {
  status: string;
  error?: string | null;
  loop_id?: string | null;
  publish_path?: string | null;
  gate_failures?: string[] | null;
};

type RunOptions = {
  candidates: string[];
  topic_cluster: string[];
  target_word_count: number;
  /** Set when Serper (or similar) failed and the API used MOCK-style gaps for this preview only */
  load_warning?: string | null;
};

type RunTab = "write" | "pipeline";

async function parseFetchErrorMessage(res: Response): Promise<string> {
  try {
    const b = (await res.json()) as { detail?: unknown };
    if (typeof b.detail === "string") return b.detail;
    if (Array.isArray(b.detail)) {
      return b.detail
        .map((item) => {
          if (typeof item === "object" && item !== null && "msg" in item) {
            return String((item as { msg?: unknown }).msg);
          }
          return typeof item === "string" ? item : JSON.stringify(item);
        })
        .join(" ");
    }
  } catch {
    /* ignore */
  }
  return res.statusText || `HTTP ${res.status}`;
}

const RUN_TABS = [
  { id: "write", label: "Run", hint: "Generate one article" },
  { id: "pipeline", label: "What runs", hint: "Steps in order" },
] as const;

export default function RunLoop({ clientId }: { clientId: string }) {
  const baseId = useId();
  const [tab, setTab] = useState<RunTab>("write");
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [runOptions, setRunOptions] = useState<RunOptions | null>(null);
  const [optionsErr, setOptionsErr] = useState<string | null>(null);

  useEffect(() => {
    setOptionsErr(null);
    setRunOptions(null);
    fetch(`/api/clients/${encodeURIComponent(clientId)}/run-options`)
      .then(async (r) => {
        if (!r.ok) {
          const msg = await parseFetchErrorMessage(r);
          throw new Error(msg);
        }
        return r.json();
      })
      .then((d: RunOptions) =>
        setRunOptions({
          candidates: Array.isArray(d.candidates) ? d.candidates : [],
          topic_cluster: Array.isArray(d.topic_cluster) ? d.topic_cluster : [],
          target_word_count: typeof d.target_word_count === "number" ? d.target_word_count : 1200,
          load_warning: typeof d.load_warning === "string" && d.load_warning.trim() ? d.load_warning.trim() : undefined,
        }),
      )
      .catch((e: unknown) => {
        const detail = e instanceof Error ? e.message : String(e);
        const isNetwork =
          detail === "Failed to fetch" ||
          detail.startsWith("NetworkError") ||
          detail.includes("Load failed");
        setOptionsErr(
          isNetwork
            ? "Could not reach the API. Start the Content workspace backend (uvicorn), then refresh this page."
            : `Could not load topic suggestions: ${detail}`,
        );
      });
  }, [clientId]);

  async function startRun() {
    setJob(null);

    const payload = { mode: "auto" as const };

    setBusy(true);
    let jobId: string;
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let detail = res.statusText;
        try {
          const b = (await res.json()) as { detail?: unknown };
          if (typeof b.detail === "string") detail = b.detail;
          else if (Array.isArray(b.detail)) detail = b.detail.map(String).join("; ");
        } catch {
          /* use statusText */
        }
        setJob({ status: "failed", error: detail });
        setBusy(false);
        return;
      }
      const data = (await res.json()) as { job_id: string };
      jobId = data.job_id;
    } catch (e) {
      setJob({ status: "failed", error: String(e) });
      setBusy(false);
      return;
    }
    const poll = async () => {
      const jr = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
      const j = (await jr.json()) as Job;
      setJob(j);
      if (j.status === "pending" || j.status === "running") {
        setTimeout(poll, 1200);
      } else {
        setBusy(false);
      }
    };
    void poll();
  }

  const wordHint = runOptions?.target_word_count ?? 1200;

  return (
    <div>
      <h1>Write new article</h1>
      <p className="prose-lead">
        Each run uses <strong>automatic topic choice</strong>: the engine builds a candidate list from keyword gaps plus your
        topic cluster (excluding overlaps with published pieces), then the research step picks a main phrase, steered by your{" "}
        <strong>Research notes</strong> and learning history. You need an Anthropic API key in <strong>.env</strong>. Target
        length from settings is about <strong>{wordHint}</strong> words. For a <strong>daily hands-off run</strong>, enable{" "}
        <strong>Settings → Schedule &amp; autopilot</strong> (keeps the API running).
      </p>

      <PageTabs
        idPrefix={baseId}
        tabs={[...RUN_TABS]}
        active={tab}
        onChange={(id) => setTab(id as RunTab)}
        ariaLabel="Write article sections"
      />

      <div className="panel page-tab-panel" {...tabPanelAttrs(baseId, "write", tab)}>
        <h2 className="prose-h3" style={{ marginTop: 0 }}>
          Run once
        </h2>
        {optionsErr && <p className="status bad">{optionsErr}</p>}
        {runOptions?.load_warning && !optionsErr && (
          <p className="status warn">
            Keyword preview fell back to topic-cluster ideas (MOCK-style) because: {runOptions.load_warning} Fix{" "}
            <strong>Settings → Length &amp; data</strong> or <code>SERPER_API_KEY</code> in <code>.env</code> before running;
            otherwise research may fail the same way when you generate an article.
          </p>
        )}
        <p className="prose-muted" style={{ marginTop: 0, marginBottom: "1rem" }}>
          Generates <strong>one draft</strong> per click. Topic sources come from <strong>Settings → Topics &amp; voice</strong>
          , <strong>Length &amp; data</strong> (Serper/MOCK), and your research notes.
        </p>
        {runOptions && runOptions.candidates.length > 0 ? (
          <FormField id={`${baseId}-preview`} label="Example candidates (not a manual picker)" hint="The model will choose; this is what deduplication currently allows.">
            <ul className="prose-list" style={{ marginTop: "0.35rem", fontSize: "0.92rem" }}>
              {runOptions.candidates.slice(0, 8).map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </FormField>
        ) : runOptions && !optionsErr ? (
          <p className="prose-muted">
            No topic candidates right now (everything may be too similar to existing articles). Adjust topics in Settings or
            published library, then try again.
          </p>
        ) : null}

        <div className="row" style={{ margin: "1rem 0" }}>
          <button type="button" disabled={busy} onClick={() => void startRun()}>
            {busy ? "Working…" : "Generate one article now"}
          </button>
        </div>
        {job && (
          <div className="panel panel--neutral" style={{ marginTop: "1rem", marginBottom: 0 }}>
            <p style={{ marginTop: 0 }}>
              Status:{" "}
              <strong
                className={
                  job.status === "succeeded"
                    ? "status ok"
                    : job.status === "failed"
                      ? "status bad"
                      : "status"
                }
              >
                {friendlyRunStatus(job.status)}
              </strong>
            </p>
            {job.loop_id && job.status === "succeeded" && (
              <p className="prose-muted">
                Your latest draft is linked to reference ID <code>{job.loop_id.slice(0, 8)}…</code> (see more under{" "}
                <strong>Technical details</strong> below).
              </p>
            )}
            {job.publish_path && job.status === "succeeded" && (
              <p>
                Saved draft file: <strong>{shortPath(job.publish_path)}</strong>
              </p>
            )}
            {job.error && (
              <p className="prose-muted" style={{ color: "var(--error)" }}>
                {job.error}
              </p>
            )}
            {job.gate_failures?.length ? (
              <div>
                <h3 className="prose-h3">Why the draft was rejected</h3>
                <ul className="prose-list">
                  {job.gate_failures.map((g) => (
                    <li key={g}>{explainGateFailure(g)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <details className="tech-details">
              <summary>Technical details</summary>
              {job.loop_id && <p className="prose-muted">Loop ID: {job.loop_id}</p>}
              {job.publish_path && <p className="prose-muted">Full path: {job.publish_path}</p>}
              {job.gate_failures?.length ? (
                <p className="prose-muted">Raw codes: {job.gate_failures.join(", ")}</p>
              ) : null}
            </details>
          </div>
        )}
      </div>

      <div className="panel panel--neutral page-tab-panel" {...tabPanelAttrs(baseId, "pipeline", tab)}>
        <h2 className="prose-h3" style={{ marginTop: 0 }}>
          What happens in one run
        </h2>
        <ol className="prose-list" style={{ paddingLeft: "1.35rem" }}>
          <li>
            <strong>Research &amp; brief.</strong> Builds candidates from your topic cluster and keyword ideas, drops topics
            too similar to published work, then the model selects a main phrase. Research notes steer the brief.
          </li>
          <li>
            <strong>Generate draft.</strong> Writes Markdown: title, meta, body, internal link placeholders.
          </li>
          <li>
            <strong>Quality gate.</strong> Checks rules (length, title, headings, duplicate topics, etc.).
            Failures are listed on this page and under <strong>Draft checks</strong>.
          </li>
          <li>
            <strong>Publish / save.</strong> Writes the file locally (see Settings for destination).
          </li>
          <li>
            <strong>Evaluate &amp; learn.</strong> Scores the piece and updates what to try or avoid next time.
          </li>
        </ol>
        <p className="prose-muted" style={{ marginBottom: 0 }}>
          Use <strong>Research notes</strong> and <strong>Settings</strong> before running if you need to steer
          audience or word counts.
        </p>
      </div>
    </div>
  );
}
