import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useState } from "react";
import { deleteJson } from "../apiDelete";
import ListRowActions from "../components/ListRowActions";
import PageTabs, { tabPanelAttrs } from "../components/PageTabs";
import TimeRangeFilter from "../components/TimeRangeFilter";

const EvaluationsCharts = lazy(() => import("../components/EvaluationsCharts"));
import { asStringArray, formatWhen, scoreOutOf } from "../formatDisplay";
import type { TimeRangeId } from "../timeRange";
import { cutoffForRange, filterRowsByTime } from "../timeRange";
import { useListMarks } from "../useListMarks";

type Row = Record<string, unknown>;

type EvalTab = "scores" | "guide";

const EVAL_TABS = [
  { id: "scores", label: "Quality scores", hint: "Per article" },
  { id: "guide", label: "How to read scores", hint: "What the numbers mean" },
] as const;

export default function Evaluations({ clientId }: { clientId: string }) {
  const baseId = useId();
  const timeFieldId = `${baseId}-time-range`;
  const [tab, setTab] = useState<EvalTab>("scores");
  const [rows, setRows] = useState<Row[]>([]);
  const [timeRange, setTimeRange] = useState<TimeRangeId>("all");
  const [reload, setReload] = useState(0);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { isMarked, toggleMark, rowClass } = useListMarks(clientId, "evaluations");

  useEffect(() => {
    fetch(`/api/clients/${encodeURIComponent(clientId)}/evaluations?limit=300`)
      .then((r) => r.json())
      .then(setRows);
  }, [clientId, reload]);

  const cutoff = useMemo(() => cutoffForRange(timeRange), [timeRange]);
  const visibleRows = useMemo(() => filterRowsByTime(rows, cutoff, "evaluated_at"), [rows, cutoff]);

  const scrollToEvalArticle = useCallback((articleId: string) => {
    if (!articleId) return;
    const el = document.getElementById(`eval-article-${articleId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  return (
    <div>
      <h1>Quality scores</h1>
      <p className="prose-lead">
        After each article is saved, the system scores coverage, keywords, readability, structure, and
        internal links. Open <strong>How to read scores</strong> for a plain-language guide to each column.
      </p>

      <PageTabs
        idPrefix={baseId}
        tabs={[...EVAL_TABS]}
        active={tab}
        onChange={(id) => setTab(id as EvalTab)}
        ariaLabel="Quality score sections"
      />

      <div className="panel page-tab-panel" {...tabPanelAttrs(baseId, "scores", tab)} style={{ overflowX: "auto" }}>
        <div className="page-toolbar">
          <p className="prose-muted page-toolbar__lead" style={{ marginTop: 0 }}>
            Charts and the table respect the time window (by review time). Widen to <strong>All time</strong> for
            the full stored history (up to the last 300 reviews).
          </p>
          <TimeRangeFilter id={timeFieldId} value={timeRange} onChange={setTimeRange} label="Show scores from" />
        </div>

        <h2 className="prose-h3 eval-visual-summary-heading" style={{ marginTop: 0 }}>
          Visual summary
        </h2>
        <p className="prose-muted eval-visual-summary-lead">
          Expand a section below. The radar shows the newest score in range; the line and bar charts include all reviews in
          range (by time).
        </p>
        <Suspense fallback={<p className="prose-muted">Loading charts…</p>}>
          <EvaluationsCharts rows={visibleRows} onArticleNavigate={scrollToEvalArticle} />
        </Suspense>

        <h2 className="prose-h3 eval-scores-by-article-heading" style={{ marginTop: "0.85rem" }}>
          Scores by article
        </h2>
        <p className="prose-muted">
          Higher is generally better. Overall under 60 is treated as weak.
          {rows.length > 0 && visibleRows.length !== rows.length ? (
            <>
              {" "}
              Showing <strong>{visibleRows.length}</strong> of <strong>{rows.length}</strong> loaded scores in this
              range.
            </>
          ) : rows.length > 0 ? (
            <>
              {" "}
              <strong>{visibleRows.length}</strong> score{visibleRows.length === 1 ? "" : "s"} in view.
            </>
          ) : null}
        </p>
        {deleteErr && <p className="status bad">{deleteErr}</p>}
        <table>
          <thead>
            <tr>
              <th scope="col" className="list-actions-col">
                <span className="visually-hidden">Mark and delete</span>
              </th>
              <th scope="col">Article</th>
              <th scope="col">Overall (out of 100)</th>
              <th scope="col">Topic depth (25)</th>
              <th scope="col">Keywords (25)</th>
              <th scope="col">Readability (20)</th>
              <th scope="col">Structure (20)</th>
              <th scope="col">Internal links (10)</th>
              <th scope="col">Reviewed</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => {
              const findings = asStringArray(r.findings);
              const eid = String(r.id ?? "");
              return (
                <tr key={eid} id={`eval-article-${eid}`} className={rowClass(eid)}>
                  <td className="list-actions-col">
                    {eid ? (
                      <ListRowActions
                        compact
                        marked={isMarked(eid)}
                        onToggleMark={() => toggleMark(eid)}
                        busy={deletingId === eid}
                        onDelete={async () => {
                          setDeleteErr(null);
                          setDeletingId(eid);
                          try {
                            await deleteJson(
                              `/api/clients/${encodeURIComponent(clientId)}/evaluations/${encodeURIComponent(eid)}`,
                            );
                            setReload((n) => n + 1);
                          } catch (e) {
                            setDeleteErr(e instanceof Error ? e.message : "Delete failed.");
                          } finally {
                            setDeletingId(null);
                          }
                        }}
                        deleteConfirm="Remove this score row from the database? The article record stays; only this review is deleted."
                      />
                    ) : null}
                  </td>
                  <td>
                    <strong>{String(r.title)}</strong>
                    {findings.length ? (
                      <ul className="prose-list" style={{ marginTop: "0.35rem", fontSize: "0.85rem" }}>
                        {findings.slice(0, 3).map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td>{scoreOutOf(r.overall_score, 100)}</td>
                  <td>{scoreOutOf(r.semantic_coverage, 25)}</td>
                  <td>{scoreOutOf(r.keyword_usage, 25)}</td>
                  <td>{scoreOutOf(r.readability, 20)}</td>
                  <td>{scoreOutOf(r.structural_completeness, 20)}</td>
                  <td>{scoreOutOf(r.internal_linking, 10)}</td>
                  <td>{formatWhen(String(r.evaluated_at ?? ""))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <p className="prose-muted">No scores yet.</p>}
        {rows.length > 0 && !visibleRows.length ? (
          <p className="prose-muted">No scores in this time range. Choose a wider window or All time.</p>
        ) : null}
      </div>

      <div className="panel panel--neutral page-tab-panel" {...tabPanelAttrs(baseId, "guide", tab)}>
        <h2 className="prose-h3" style={{ marginTop: 0 }}>
          How to read the score columns
        </h2>
        <dl className="info-grid">
          <dt>Overall (out of 100)</dt>
          <dd>Combined view of how well the draft meets your brief and quality bar. Treat as a summary, not the only signal.</dd>
          <dt>Topic depth (out of 25)</dt>
          <dd>How well the content covers the intended subject compared to the brief, not just keyword repetition.</dd>
          <dt>Keywords (out of 25)</dt>
          <dd>Use of the main and supporting phrases in a natural way.</dd>
          <dt>Readability (out of 20)</dt>
          <dd>Clarity and appropriate reading level for your audience.</dd>
          <dt>Structure (out of 20)</dt>
          <dd>Headings, sections, and flow (for example enough ## sections).</dd>
          <dt>Internal links (out of 10)</dt>
          <dd>Whether the draft links to other pages you care about, using the project’s linking rules.</dd>
          <dt>Reviewed</dt>
          <dd>When this score row was recorded.</dd>
        </dl>
        <p className="prose-muted" style={{ marginBottom: 0 }}>
          Short bullet notes under a title are reviewer “findings” when the system recorded them.
        </p>
      </div>
    </div>
  );
}
