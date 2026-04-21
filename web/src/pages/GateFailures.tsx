import { useEffect, useId, useMemo, useState } from "react";
import { deleteJson } from "../apiDelete";
import ListRowActions from "../components/ListRowActions";
import PageTabs, { tabPanelAttrs } from "../components/PageTabs";
import TimeRangeFilter from "../components/TimeRangeFilter";
import { explainGateFailure, explainWarning, formatWhen } from "../formatDisplay";
import type { TimeRangeId } from "../timeRange";
import { cutoffForRange, filterRowsByTime } from "../timeRange";
import { useListMarks } from "../useListMarks";

type DraftSnapshot = {
  title?: string;
  slug?: string;
  meta_description?: string;
  target_keyword?: string;
  brief_title_suggestion?: string;
  brief_angle?: string;
  secondary_keywords?: string[];
  word_count?: number;
  body_excerpt?: string;
  keywords_used?: string[];
  parse_failed?: boolean;
};

type Row = {
  id: number;
  logged_at?: string;
  loop_id?: string;
  hard_failures: string[];
  warnings: string[];
  draft_snapshot?: DraftSnapshot | null;
};

type GateTab = "log" | "help";

const GATE_TABS = [
  { id: "log", label: "Failure log", hint: "What was checked" },
  { id: "help", label: "Understanding checks", hint: "Hard vs soft" },
] as const;

function DraftSnapshotView({ snap }: { snap: DraftSnapshot }) {
  const hasBody = Boolean(snap.body_excerpt && snap.body_excerpt.trim());
  return (
    <div className="draft-preview">
      <h3 className="prose-h3">Draft that was checked (not published)</h3>
      <p className="prose-muted">
        This is what the generator produced before the quality step rejected it. Nothing here was saved to
        your article library.
      </p>
      {snap.parse_failed ? (
        <p className="prose-muted" style={{ color: "var(--warn)" }}>
          The model response could not be read as a valid draft structure. Details below are from your brief
          only.
        </p>
      ) : null}
      <div className="draft-preview-meta">
        {snap.title ? (
          <p>
            <strong>Headline:</strong> {snap.title}
          </p>
        ) : null}
        {snap.slug ? (
          <p>
            <strong>Planned web slug:</strong> <code>{snap.slug}</code>
          </p>
        ) : null}
        {snap.meta_description ? (
          <p>
            <strong>Meta description (for search):</strong> {snap.meta_description}
          </p>
        ) : null}
        {snap.target_keyword ? (
          <p>
            <strong>Main topic phrase (brief):</strong> {snap.target_keyword}
          </p>
        ) : null}
        {snap.brief_title_suggestion ? (
          <p>
            <strong>Suggested title from research:</strong> {snap.brief_title_suggestion}
          </p>
        ) : null}
        {snap.brief_angle ? (
          <p>
            <strong>Angle from research:</strong> {snap.brief_angle}
          </p>
        ) : null}
        {snap.secondary_keywords && snap.secondary_keywords.length > 0 ? (
          <p>
            <strong>Supporting phrases:</strong> {snap.secondary_keywords.join(", ")}
          </p>
        ) : null}
        {snap.word_count != null ? (
          <p>
            <strong>Approx. word count:</strong> {snap.word_count}
          </p>
        ) : null}
        {snap.keywords_used && snap.keywords_used.length > 0 ? (
          <p>
            <strong>Keywords tagged in draft:</strong> {snap.keywords_used.join(", ")}
          </p>
        ) : null}
      </div>
      {hasBody ? (
        <>
          <h4 className="prose-h3" style={{ marginTop: "0.75rem" }}>
            Article text (excerpt)
          </h4>
          <p className="prose-muted" style={{ fontSize: "0.85rem" }}>
            First portion of the draft body (Markdown). Long articles are truncated here for the screen.
          </p>
          <pre className="draft-preview-body">{snap.body_excerpt}</pre>
        </>
      ) : (
        <p className="prose-muted">No article body was stored for this failure.</p>
      )}
    </div>
  );
}

export default function GateFailures({ clientId }: { clientId: string }) {
  const baseId = useId();
  const timeRangeId = `${baseId}-time-range`;
  const [tab, setTab] = useState<GateTab>("log");
  const [rows, setRows] = useState<Row[]>([]);
  const [timeRange, setTimeRange] = useState<TimeRangeId>("all");
  const [reload, setReload] = useState(0);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const { isMarked, toggleMark, rowClass } = useListMarks(clientId, "gate");

  useEffect(() => {
    fetch(`/api/clients/${encodeURIComponent(clientId)}/gate-failures?limit=200`)
      .then((r) => r.json())
      .then(setRows);
  }, [clientId, reload]);

  const cutoff = useMemo(() => cutoffForRange(timeRange), [timeRange]);
  const visibleRows = useMemo(() => filterRowsByTime(rows, cutoff, "logged_at"), [rows, cutoff]);

  return (
    <div>
      <h1>Draft checks that did not pass</h1>
      <p className="prose-lead">
        When a draft fails an automatic quality check, it is <strong>not</strong> saved as a finished article.
        Read <strong>Understanding checks</strong> for how hard failures differ from warnings.
      </p>

      <PageTabs
        idPrefix={baseId}
        tabs={[...GATE_TABS]}
        active={tab}
        onChange={(id) => setTab(id as GateTab)}
        ariaLabel="Draft checks sections"
      />

      <div className="page-tab-panel" {...tabPanelAttrs(baseId, "log", tab)}>
        <div className="page-toolbar">
          <p className="prose-muted page-toolbar__lead" style={{ marginTop: 0 }}>
            Filter by when the failed check was logged (newest entries are loaded first, up to 200 on file).
          </p>
          <TimeRangeFilter id={timeRangeId} value={timeRange} onChange={setTimeRange} label="Show failures from" />
        </div>
        {rows.length > 0 && visibleRows.length < rows.length ? (
          <p className="prose-muted" style={{ fontSize: "0.88rem" }}>
            Showing <strong>{visibleRows.length}</strong> of <strong>{rows.length}</strong> loaded entries.
          </p>
        ) : null}
        {deleteErr && <p className="status bad">{deleteErr}</p>}
        {visibleRows.map((r) => (
          <div key={r.id} className={`panel panel--note ${rowClass(r.id)}`} style={{ marginBottom: "1rem" }}>
            <div className="learning-card-head">
              <p className="prose-muted learning-card-head__title" style={{ margin: 0 }}>
                <strong>{formatWhen(String(r.logged_at ?? ""))}</strong>
                {r.loop_id ? (
                  <span>
                    {" "}
                    · reference <code>{r.loop_id.slice(0, 8)}…</code>
                  </span>
                ) : null}
              </p>
              <ListRowActions
                compact
                marked={isMarked(r.id)}
                onToggleMark={() => toggleMark(r.id)}
                busy={deletingId === r.id}
                onDelete={async () => {
                  setDeleteErr(null);
                  setDeletingId(r.id);
                  try {
                    await deleteJson(
                      `/api/clients/${encodeURIComponent(clientId)}/gate-failures/${encodeURIComponent(String(r.id))}`,
                    );
                    setReload((n) => n + 1);
                  } catch (e) {
                    setDeleteErr(e instanceof Error ? e.message : "Delete failed.");
                  } finally {
                    setDeletingId(null);
                  }
                }}
                deleteConfirm="Remove this draft check log entry? This cannot be undone."
              />
            </div>

            {r.draft_snapshot && Object.keys(r.draft_snapshot).length > 0 ? (
              <DraftSnapshotView snap={r.draft_snapshot} />
            ) : (
              <div className="draft-preview">
                <h3 className="prose-h3">Draft snapshot</h3>
                <p className="prose-muted">
                  No full draft was stored for this entry. If this is an old record, run the pipeline again. New
                  failures save headline and body excerpt automatically.
                </p>
              </div>
            )}

            <h3 className="prose-h3" style={{ marginTop: "1rem" }}>
              Issues that blocked publishing
            </h3>
            <ul className="prose-list">
              {r.hard_failures.map((h) => (
                <li key={h}>{explainGateFailure(h)}</li>
              ))}
            </ul>
            {r.warnings?.length ? (
              <>
                <h3 className="prose-h3">Warnings (did not block by themselves)</h3>
                <ul className="prose-list">
                  {r.warnings.map((w) => (
                    <li key={w}>{explainWarning(w)}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <details className="tech-details">
              <summary>Technical codes (support)</summary>
              <p className="prose-muted">Hard failures:</p>
              <ul className="prose-list">
                {r.hard_failures.map((h) => (
                  <li key={`t-${h}`}>
                    <code>{h}</code>
                  </li>
                ))}
              </ul>
              {r.warnings?.length ? (
                <>
                  <p className="prose-muted">Warnings (raw):</p>
                  <ul className="prose-list">
                    {r.warnings.map((w) => (
                      <li key={`w-${w}`}>
                        <code>{w}</code>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </details>
          </div>
        ))}
        {!rows.length && <p className="prose-muted">No failed checks on record. Great news.</p>}
        {rows.length > 0 && !visibleRows.length ? (
          <p className="prose-muted">No entries in this time range. Widen the filter or choose All time.</p>
        ) : null}
      </div>

      <div className="panel panel--neutral page-tab-panel" {...tabPanelAttrs(baseId, "help", tab)}>
        <h2 className="prose-h3" style={{ marginTop: 0 }}>
          Understanding draft checks
        </h2>
        <dl className="info-grid">
          <dt>What “blocked publishing” means</dt>
          <dd>
            A <strong>hard failure</strong> is a rule the draft must pass before it counts as finished. For
            example: minimum length, title including your main phrase, or required sections. If any hard failure
            triggers, the article is not saved as published.
          </dd>
          <dt>Warnings</dt>
          <dd>
            <strong>Warnings</strong> flag issues that are worth fixing but do not by themselves stop
            publishing, such as low keyword density or missing internal links, depending on your setup.
          </dd>
          <dt>Draft snapshot</dt>
          <dd>
            Newer log entries include headline, meta, brief context, and a body excerpt so you can see what
            was reviewed. Older rows may only list failure codes.
          </dd>
          <dt>Where to fix settings</dt>
          <dd>
            Word limits and publishing paths live under <strong>Settings</strong>. Operator steering for the
            next brief lives under <strong>Research notes</strong>.
          </dd>
        </dl>
      </div>
    </div>
  );
}
