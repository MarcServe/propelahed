import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { deleteJson } from "../apiDelete";
import BulletSection from "../components/BulletSection";
import FormField from "../components/FormField";
import ListRowActions from "../components/ListRowActions";
import PageTabs, { tabPanelAttrs } from "../components/PageTabs";
import TimeRangeFilter from "../components/TimeRangeFilter";
import { asStringArray, EMPTY_LABEL, formatWhen } from "../formatDisplay";
import type { TimeRangeId } from "../timeRange";
import { cutoffForRange, filterRowsByTime } from "../timeRange";
import { useListMarks } from "../useListMarks";

type ResearchContext = Record<string, unknown>;

type HintHistoryRow = {
  id?: number;
  loop_id?: string;
  hint_text?: string;
  created_at?: string;
  article_id?: number | null;
  article_title?: string | null;
  article_slug?: string | null;
};

type ResTab = "notes" | "context" | "history";

const RES_TABS = [
  { id: "notes", label: "Your notes", hint: "Instructions for the next brief" },
  { id: "context", label: "Engine context", hint: "What the model already sees" },
  { id: "history", label: "Run history", hint: "Notes tied to each run" },
] as const;

export default function Research({ clientId }: { clientId: string }) {
  const baseId = useId();
  const historyTimeId = `${baseId}-history-time`;
  const [tab, setTab] = useState<ResTab>("notes");
  const [ctx, setCtx] = useState<ResearchContext | null>(null);
  const [hint, setHint] = useState("");
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [historyRows, setHistoryRows] = useState<HintHistoryRow[]>([]);
  const [historyErr, setHistoryErr] = useState<string | null>(null);
  const [historyTimeRange, setHistoryTimeRange] = useState<TimeRangeId>("all");
  const [histReload, setHistReload] = useState(0);
  const [histDeleteErr, setHistDeleteErr] = useState<string | null>(null);
  const [deletingHistId, setDeletingHistId] = useState<number | null>(null);
  const { isMarked, toggleMark, rowClass } = useListMarks(clientId, "research");

  /** Load server context into state. Does not clear the “Saved” message (that was wiping feedback after save). */
  const refreshContext = useCallback(async (): Promise<void> => {
    const r = await fetch(`/api/clients/${encodeURIComponent(clientId)}/research-context`);
    if (!r.ok) {
      throw new Error(r.statusText);
    }
    const data = (await r.json()) as ResearchContext;
    setCtx(data);
    setHint(String(data.operator_hint ?? ""));
  }, [clientId]);

  const loadHistory = useCallback(async () => {
    setHistoryErr(null);
    try {
      const r = await fetch(`/api/clients/${encodeURIComponent(clientId)}/research-hint-history?limit=50`);
      if (!r.ok) throw new Error(r.statusText);
      const data = (await r.json()) as HintHistoryRow[];
      setHistoryRows(Array.isArray(data) ? data : []);
    } catch {
      setHistoryErr("Could not load run history.");
      setHistoryRows([]);
    }
  }, [clientId]);

  useEffect(() => {
    setErr(null);
    refreshContext().catch(() =>
      setErr("We could not load this page. Start Content workspace, then try again."),
    );
  }, [refreshContext]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory, histReload]);

  const historyCutoff = useMemo(() => cutoffForRange(historyTimeRange), [historyTimeRange]);
  const visibleHistoryRows = useMemo(
    () => filterRowsByTime(historyRows, historyCutoff, "created_at"),
    [historyRows, historyCutoff],
  );

  async function saveHint() {
    setErr(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/research-hint`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hint }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr((body as { detail?: string }).detail || res.statusText);
        return;
      }
      const data = (await res.json()) as { hint?: string; updated_at?: string };
      const nextHint = String(data.hint ?? "");
      setHint(nextHint);
      setCtx((prev) =>
        prev
          ? {
              ...prev,
              operator_hint: nextHint,
              operator_hint_updated_at: data.updated_at ?? "",
            }
          : prev,
      );
      setSavedMsg(
        data.updated_at ? `Saved (${formatWhen(data.updated_at)}).` : "Saved.",
      );
      void loadHistory();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function onRefreshClick() {
    setSavedMsg(null);
    setErr(null);
    refreshContext().catch(() =>
      setErr("We could not refresh. Start Content workspace, then try again."),
    );
    void loadHistory();
  }

  const topicCluster = asStringArray(ctx?.topic_cluster);
  const covered = Array.isArray(ctx?.covered_topics)
    ? (ctx!.covered_topics as { title?: string; primary_keyword?: string }[]).map((row) => {
        const t = row.title || "";
        const k = row.primary_keyword || "";
        return t && k ? `${t} (${k})` : t || k || "";
      }).filter(Boolean)
    : [];
  const gaps =
    ctx?.keyword_gaps && typeof ctx.keyword_gaps === "object"
      ? asStringArray((ctx.keyword_gaps as { gaps?: { keyword?: string }[] }).gaps?.map((g) => g.keyword || ""))
      : [];
  const excluded = asStringArray(ctx?.excluded_topics);
  const learning = ctx?.learning_state as Record<string, unknown> | null | undefined;
  const learnPriorities = asStringArray(learning?.priority_topics);
  const learnAvoid = asStringArray(learning?.do_not_repeat);

  return (
    <div>
      <h1>Research notes</h1>
      <p className="prose-lead">
        Steer the engine before you run <strong>Write new article</strong>. Each time you <strong>Save notes</strong> or
        start a draft run, we store a snapshot. Open <strong>Run history</strong> to review past wording or load it back
        into the editor.
      </p>
      {err && <p className="status bad">{err}</p>}
      {savedMsg && <p className="status ok">{savedMsg}</p>}

      <PageTabs
        idPrefix={baseId}
        tabs={[...RES_TABS]}
        active={tab}
        onChange={(id) => setTab(id as ResTab)}
        ariaLabel="Research sections"
      />

      <div className="panel page-tab-panel" {...tabPanelAttrs(baseId, "notes", tab)}>
        <FormField
          id={`${baseId}-hint`}
          label="Instructions for the next content brief"
          hint="Write in normal sentences: audience, products, topics to favour or avoid, tone, or anything a writer should know before a draft is planned."
        >
          <textarea
            id={`${baseId}-hint`}
            className="prose-input"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="Example: Focus on housing associations in the UK; keep language simple; mention accessibility and response times."
            spellCheck
            disabled={saving}
          />
        </FormField>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <button type="button" disabled={saving} onClick={() => void saveHint()}>
            {saving ? "Saving…" : "Save notes"}
          </button>
          <button type="button" className="secondary" disabled={saving} onClick={onRefreshClick}>
            Refresh what the engine sees
          </button>
        </div>
      </div>

      <div className="panel panel--neutral page-tab-panel" {...tabPanelAttrs(baseId, "context", tab)}>
        <h2 className="prose-h3" style={{ marginTop: 0 }}>
          What the engine is using (read-only)
        </h2>
        <p className="prose-muted">
          Pulled from your workspace settings, article database, and learning state. Edit these under{" "}
          <strong>Settings</strong> or via successful runs, not here.
        </p>
        {!ctx ? (
          <p>Loading…</p>
        ) : (
          <div>
            <FormField id={`${baseId}-ro-domain`} label="Website domain">
              <p id={`${baseId}-ro-domain`} className="prose-muted" style={{ margin: 0 }}>
                {String(ctx.domain ?? EMPTY_LABEL)}
              </p>
            </FormField>
            <FormField id={`${baseId}-ro-audience`} label="Who you are writing for">
              <p id={`${baseId}-ro-audience`} className="prose-muted" style={{ margin: 0 }}>
                {String(ctx.target_audience ?? EMPTY_LABEL)}
              </p>
            </FormField>
            <FormField id={`${baseId}-ro-tone`} label="Tone and style">
              <p id={`${baseId}-ro-tone`} className="prose-muted" style={{ margin: 0 }}>
                {String(ctx.tone ?? EMPTY_LABEL)}
              </p>
            </FormField>
            <BulletSection title="Broad topics you configured" items={topicCluster} />
            <BulletSection
              title="Topic ideas from the keyword helper"
              items={gaps}
              emptyNote="No sample keyword list (check your configuration)."
            />
            <BulletSection
              title="Articles already in the library"
              items={covered}
              emptyNote="No published articles in the database yet."
            />
            <BulletSection
              title="Topics you asked us never to cover"
              items={excluded}
              emptyNote="No hard exclusions configured."
            />
            <BulletSection
              title="Next topics the system wants to prioritise"
              items={learnPriorities}
              emptyNote="Priorities appear after successful runs."
            />
            <BulletSection
              title="Wording or angles to skip next time"
              items={learnAvoid}
              emptyNote="Nothing stored yet."
            />
            {ctx.operator_hint_updated_at ? (
              <p className="prose-muted">
                Your saved notes were last stored: {formatWhen(String(ctx.operator_hint_updated_at))}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="panel panel--note page-tab-panel" {...tabPanelAttrs(baseId, "history", tab)}>
        <div className="page-toolbar">
          <div>
            <h2 className="prose-h3" style={{ marginTop: 0 }}>
              Research notes at run time
            </h2>
            <p className="prose-muted" style={{ marginBottom: 0 }}>
              Entries from <strong>Save notes</strong> are labeled as dashboard saves. Entries from <strong>Write new article</strong>{" "}
              use the pipeline run id; if a draft was saved, the article title appears here.{" "}
              <strong>Use these notes</strong> copies that snapshot into the <strong>Your notes</strong> box. It does not start a
              draft by itself. Click <strong>Save notes</strong> if you want this text to be what the engine uses next, then run{" "}
              <strong>Write new article</strong>. The research step adds your saved notes to the brief so the new article
              follows them.
            </p>
          </div>
          <TimeRangeFilter
            id={historyTimeId}
            className="time-range-filter--toolbar"
            value={historyTimeRange}
            onChange={setHistoryTimeRange}
            label="Show entries from"
          />
        </div>
        {historyErr && <p className="status bad">{historyErr}</p>}
        {!historyRows.length && !historyErr ? (
          <p className="prose-muted">
            No snapshots yet. Save your notes on the <strong>Your notes</strong> tab, or run <strong>Write new article</strong>
            Either action adds an entry here.
          </p>
        ) : null}
        {historyRows.length > 0 && !visibleHistoryRows.length ? (
          <p className="prose-muted">No note history in this time range. Widen the filter or choose All time.</p>
        ) : null}
        {historyRows.length > 0 && visibleHistoryRows.length < historyRows.length ? (
          <p className="prose-muted" style={{ fontSize: "0.88rem" }}>
            Showing <strong>{visibleHistoryRows.length}</strong> of <strong>{historyRows.length}</strong> loaded entries.
          </p>
        ) : null}
        {histDeleteErr && <p className="status bad">{histDeleteErr}</p>}
        {visibleHistoryRows.map((row) => {
          const hid = row.id;
          return (
          <div
            key={String(hid ?? row.loop_id)}
            className={`research-history-card${typeof hid === "number" ? ` ${rowClass(hid)}` : ""}`}
          >
            <div className="research-history-card__head">
              <p className="research-history-meta">
                <strong>{formatWhen(String(row.created_at ?? ""))}</strong>
                {row.loop_id?.startsWith("dashboard-save-") ? (
                  <span className="prose-muted"> · Saved from Research notes</span>
                ) : row.loop_id ? (
                  <span className="prose-muted">
                    {" "}
                    · Pipeline run <code>{row.loop_id.slice(0, 8)}…</code>
                  </span>
                ) : null}
              </p>
              {typeof hid === "number" ? (
                <ListRowActions
                  compact
                  marked={isMarked(hid)}
                  onToggleMark={() => toggleMark(hid)}
                  busy={deletingHistId === hid}
                  onDelete={async () => {
                    setHistDeleteErr(null);
                    setDeletingHistId(hid);
                    try {
                      await deleteJson(
                        `/api/clients/${encodeURIComponent(clientId)}/research-hint-history/${encodeURIComponent(String(hid))}`,
                      );
                      setHistReload((n) => n + 1);
                    } catch (e) {
                      setHistDeleteErr(e instanceof Error ? e.message : "Delete failed.");
                    } finally {
                      setDeletingHistId(null);
                    }
                  }}
                  deleteConfirm="Remove this notes snapshot from history?"
                />
              ) : null}
            </div>
            {row.article_title ? (
              <p style={{ margin: "0.35rem 0" }}>
                <strong>Article produced:</strong> {String(row.article_title)}
                {row.article_slug ? (
                  <span className="prose-muted" style={{ fontSize: "0.88rem" }}>
                    {" "}
                    (slug: {String(row.article_slug)})
                  </span>
                ) : null}
                {" "}
                <Link to="/articles" className="research-history-link">
                  Published articles
                </Link>
              </p>
            ) : (
              <p className="prose-muted" style={{ margin: "0.35rem 0" }}>
                No article saved for this run (pipeline may have stopped early).
              </p>
            )}
            <div className="research-history-hint">
              <span className="research-history-hint-label">Notes snapshot</span>
              <pre className="research-history-pre">{String(row.hint_text ?? "") || "(Empty)"}</pre>
            </div>
            <div className="research-history-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setHint(String(row.hint_text ?? ""));
                  setTab("notes");
                  setSavedMsg(
                    "Loaded into Your notes. Save notes if this should guide the next run, then open Write new article.",
                  );
                  setErr(null);
                }}
              >
                Use these notes
              </button>
            </div>
          </div>
        );
        })}
      </div>
    </div>
  );
}
