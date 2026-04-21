import { useEffect, useId, useMemo, useState } from "react";
import { deleteJson } from "../apiDelete";
import ListRowActions from "../components/ListRowActions";
import LearningCategoriesPanel from "../components/LearningCategoriesPanel";
import PageTabs, { tabPanelAttrs } from "../components/PageTabs";
import TimeRangeFilter from "../components/TimeRangeFilter";
import { useListMarks } from "../useListMarks";
import {
  EMPTY_LABEL,
  explainGateFailure,
  formatWhen,
  friendlyRunStatus,
  shortPath,
} from "../formatDisplay";
import type { TimeRangeId } from "../timeRange";
import { cutoffForRange, filterRowsByTime } from "../timeRange";

type LearningRow = Record<string, unknown>;
type LoopRun = {
  id: number;
  loop_id: string;
  status: string;
  stage_reached: number;
  error_message: string | null;
  publish_path: string | null;
  gate_failures: string[];
  finished_at: string;
  /** Present when an article row exists for this pipeline loop. */
  article_title?: string | null;
  article_slug?: string | null;
  article_primary_keyword?: string | null;
};

type ArticleRow = { title?: string; loop_id?: string };

type DashTab = "latest" | "history" | "learning";

const DASH_TABS = [
  { id: "latest", label: "Latest run", hint: "What just happened" },
  { id: "history", label: "Run history", hint: "Past attempts" },
  { id: "learning", label: "Learning", hint: "What improves next time" },
] as const;

function RunHistoryCell({
  text,
  emptyHint = EMPTY_LABEL,
  mono = false,
  maxLen = 64,
}: {
  text: string | null | undefined;
  emptyHint?: string;
  mono?: boolean;
  /** Longer snippets for error details vs short headline cells. */
  maxLen?: number;
}) {
  const t = (text ?? "").trim();
  if (!t) return <span className="prose-muted">{emptyHint}</span>;
  const clipped = t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
  return (
    <span className={mono ? "run-history-mono" : undefined} title={t}>
      {clipped}
    </span>
  );
}

/** Error line, gate summary, or empty for successful runs */
function runHistoryFailureDetail(r: LoopRun): string {
  const err = (r.error_message ?? "").trim();
  if (err) return err;
  if (r.status === "succeeded") return "";
  const gf = r.gate_failures;
  if (gf?.length) return gf.map((g) => explainGateFailure(g)).join("; ");
  return "";
}

export default function Dashboard({ clientId }: { clientId: string }) {
  const tabId = useId();
  const runHistoryRangeId = `${tabId}-run-history-range`;
  const [tab, setTab] = useState<DashTab>("latest");
  const [learning, setLearning] = useState<LearningRow[]>([]);
  const [runs, setRuns] = useState<LoopRun[]>([]);
  const [latestArticle, setLatestArticle] = useState<ArticleRow | null>(null);
  const [runHistoryRange, setRunHistoryRange] = useState<TimeRangeId>("all");
  const [runsReload, setRunsReload] = useState(0);
  const [runDeleteErr, setRunDeleteErr] = useState<string | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<number | null>(null);
  const { isMarked, toggleMark, rowClass } = useListMarks(clientId, "runs");

  useEffect(() => {
    fetch(`/api/clients/${encodeURIComponent(clientId)}/learning?limit=3`)
      .then((r) => r.json())
      .then(setLearning)
      .catch(() => setLearning([]));
  }, [clientId]);

  useEffect(() => {
    fetch(`/api/clients/${encodeURIComponent(clientId)}/runs?limit=50`)
      .then((r) => r.json())
      .then(setRuns)
      .catch(() => setRuns([]));
  }, [clientId, runsReload]);

  useEffect(() => {
    fetch(`/api/clients/${encodeURIComponent(clientId)}/articles?limit=5`)
      .then((r) => r.json())
      .then((rows: ArticleRow[]) => setLatestArticle(rows[0] ?? null))
      .catch(() => setLatestArticle(null));
  }, [clientId]);

  const latest = learning[0];
  const lastRun = runs[0];
  const runHistoryCutoff = useMemo(() => cutoffForRange(runHistoryRange), [runHistoryRange]);
  const filteredRuns = useMemo(
    () => filterRowsByTime(runs, runHistoryCutoff, "finished_at"),
    [runs, runHistoryCutoff],
  );

  return (
    <div>
      <h1>Home</h1>
      <p className="prose-lead">
        See how your last automation run went, browse older runs, and read what the system has learned for
        future articles. Your active workspace is <strong>{clientId}</strong>.
      </p>

      <PageTabs
        idPrefix={tabId}
        tabs={[...DASH_TABS]}
        active={tab}
        onChange={(id) => setTab(id as DashTab)}
        ariaLabel="Home sections"
      />

      <div className="panel page-tab-panel" {...tabPanelAttrs(tabId, "latest", tab)}>
        <h2 className="prose-h3" style={{ marginTop: 0 }}>
          Your last automated run
        </h2>
        {!lastRun ? (
          <p className="prose-muted">
            Nothing has run yet. Open <strong>Write new article</strong> in the sidebar to create your first
            draft, or ask your technical contact to run the command-line tool.
          </p>
        ) : (
          <div>
            <p style={{ marginTop: 0 }}>
              {lastRun.status === "succeeded" ? (
                <span className="pill-ok">{friendlyRunStatus(lastRun.status)}</span>
              ) : (
                <span className="pill-bad">{friendlyRunStatus(lastRun.status)}</span>
              )}{" "}
              <span className="prose-muted">· {formatWhen(lastRun.finished_at)}</span>
            </p>
            {lastRun.status === "succeeded" && latestArticle?.title && (
              <p>
                Latest saved article: <strong>{String(latestArticle.title)}</strong>
              </p>
            )}
            {lastRun.publish_path && lastRun.status === "succeeded" && (
              <p className="prose-muted">
                Draft file name: <strong>{shortPath(lastRun.publish_path)}</strong> (saved on this computer)
              </p>
            )}
            {lastRun.error_message && (
              <p className="prose-muted" style={{ color: "var(--error)" }}>
                {lastRun.error_message}
              </p>
            )}
            {lastRun.gate_failures?.length ? (
              <div className="prose-block">
                <h3 className="prose-h3">What blocked the draft</h3>
                <ul className="prose-list">
                  {lastRun.gate_failures.map((g) => (
                    <li key={g}>{explainGateFailure(g)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <details className="tech-details">
              <summary>Technical details (optional)</summary>
              <dl className="dl-grid" style={{ marginTop: "0.5rem" }}>
                <dt>Internal run ID</dt>
                <dd>{lastRun.loop_id}</dd>
                <dt>Pipeline step reached</dt>
                <dd>{lastRun.stage_reached}</dd>
                {lastRun.publish_path ? (
                  <>
                    <dt>Full file path</dt>
                    <dd>{lastRun.publish_path}</dd>
                  </>
                ) : null}
              </dl>
            </details>
          </div>
        )}
      </div>

      <div className="panel page-tab-panel" {...tabPanelAttrs(tabId, "history", tab)}>
        <div className="page-toolbar">
          <div>
            <h2 className="prose-h3" style={{ marginTop: 0 }}>
              Run history
            </h2>
            <p className="prose-muted" style={{ marginBottom: 0 }}>
              Newest runs first. <strong>Details</strong> shows why a run stopped (error text or draft check summary). Headline,
              topic, slug, and file name appear once a draft was saved for that run.
            </p>
          </div>
          <TimeRangeFilter
            id={runHistoryRangeId}
            className="time-range-filter--toolbar"
            value={runHistoryRange}
            onChange={setRunHistoryRange}
            label="Show runs from"
          />
        </div>
        {!runs.length ? (
          <p className="prose-muted">No runs recorded yet.</p>
        ) : !filteredRuns.length ? (
          <p className="prose-muted">No runs in this time range. Widen the filter or choose All time.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <p className="prose-muted" style={{ marginTop: 0, fontSize: "0.88rem" }}>
              Showing <strong>{filteredRuns.length}</strong> of <strong>{runs.length}</strong> loaded runs.
            </p>
            {runDeleteErr && <p className="status bad">{runDeleteErr}</p>}
            <table className="table-run-history">
              <thead>
                <tr>
                  <th scope="col" className="list-actions-col">
                    <span className="visually-hidden">Mark and delete</span>
                  </th>
                  <th scope="col">When</th>
                  <th scope="col">Result</th>
                  <th scope="col">Details</th>
                  <th scope="col">Headline</th>
                  <th scope="col">Main topic</th>
                  <th scope="col">Slug</th>
                  <th scope="col">Draft file</th>
                </tr>
              </thead>
              <tbody>
                {filteredRuns.map((r) => (
                  <tr key={r.id} className={rowClass(r.id)}>
                    <td className="list-actions-col">
                      <ListRowActions
                        compact
                        marked={isMarked(r.id)}
                        onToggleMark={() => toggleMark(r.id)}
                        busy={deletingRunId === r.id}
                        onDelete={async () => {
                          setRunDeleteErr(null);
                          setDeletingRunId(r.id);
                          try {
                            await deleteJson(
                              `/api/clients/${encodeURIComponent(clientId)}/runs/${encodeURIComponent(String(r.id))}`,
                            );
                            setRunsReload((n) => n + 1);
                          } catch (e) {
                            setRunDeleteErr(e instanceof Error ? e.message : "Delete failed.");
                          } finally {
                            setDeletingRunId(null);
                          }
                        }}
                        deleteConfirm="Remove this row from run history? This cannot be undone."
                      />
                    </td>
                    <td>{formatWhen(r.finished_at)}</td>
                    <td>{friendlyRunStatus(r.status)}</td>
                    <td>
                      <RunHistoryCell
                        text={runHistoryFailureDetail(r)}
                        emptyHint={EMPTY_LABEL}
                        maxLen={200}
                      />
                    </td>
                    <td>
                      <RunHistoryCell text={r.article_title} emptyHint={EMPTY_LABEL} />
                    </td>
                    <td>
                      <RunHistoryCell text={r.article_primary_keyword} emptyHint={EMPTY_LABEL} />
                    </td>
                    <td>
                      <RunHistoryCell text={r.article_slug} emptyHint={EMPTY_LABEL} mono />
                    </td>
                    <td>
                      <RunHistoryCell text={r.publish_path ? shortPath(r.publish_path) : null} emptyHint={EMPTY_LABEL} mono />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel panel--neutral page-tab-panel" {...tabPanelAttrs(tabId, "learning", tab)}>
        <h2 className="prose-h3" style={{ marginTop: 0 }}>
          What the system is learning
        </h2>
        <p className="prose-muted learning-tab-lead">
          After successful runs, the engine remembers a few short lists. Pick one category at a time, or use{" "}
          <strong>View all</strong> to see every list together like before.
        </p>
        {!latest ? (
          <p className="prose-muted">
            After a successful run, this area summarises topics to prefer next and things to avoid repeating.
          </p>
        ) : (
          <LearningCategoriesPanel
            variant="home"
            snapshot={latest}
            keywordSampleLimit={15}
            intro={
              <p className="prose-muted learning-tab-lead">
                After successful runs, the engine remembers a few short lists. Pick one category at a time, or use{" "}
                <strong>View all</strong> to see every list together like before.
              </p>
            }
          />
        )}
      </div>
    </div>
  );
}
