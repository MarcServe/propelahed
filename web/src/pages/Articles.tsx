import { Fragment, useEffect, useId, useMemo, useState } from "react";
import { deleteJson } from "../apiDelete";
import ListRowActions from "../components/ListRowActions";
import PageTabs, { tabPanelAttrs } from "../components/PageTabs";
import TimeRangeFilter from "../components/TimeRangeFilter";
import { EMPTY_LABEL, formatWhen, shortPath } from "../formatDisplay";
import type { TimeRangeId } from "../timeRange";
import { cutoffForRange, filterRowsByTime } from "../timeRange";
import { useListMarks } from "../useListMarks";
import ArticleDraftPreviewCollapsible from "../components/ArticleMarkdownPreview";

type ArticleRow = {
  id?: number;
  loop_id?: string;
  slug?: string;
  title?: string;
  primary_keyword?: string;
  secondary_keywords?: unknown;
  word_count?: number | null;
  publish_path?: string | null;
  published_at?: string | null;
  gate_result?: string | null;
  gate_failures?: unknown;
  underperforming?: number | null;
};

type ArtTab = "list" | "guide";

const ART_TABS = [
  { id: "list", label: "Article list", hint: "Saved drafts" },
  { id: "guide", label: "Column guide", hint: "What each column means" },
] as const;

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter(Boolean);
}

export default function Articles({ clientId }: { clientId: string }) {
  const baseId = useId();
  const timeRangeId = `${baseId}-time-range`;
  const [tab, setTab] = useState<ArtTab>("list");
  const [rows, setRows] = useState<ArticleRow[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [timeRange, setTimeRange] = useState<TimeRangeId>("all");
  const [reload, setReload] = useState(0);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const { isMarked, toggleMark, rowClass } = useListMarks(clientId, "articles");

  useEffect(() => {
    fetch(`/api/clients/${encodeURIComponent(clientId)}/articles`)
      .then((r) => r.json())
      .then((data: ArticleRow[]) => setRows(data));
  }, [clientId, reload]);

  const cutoff = useMemo(() => cutoffForRange(timeRange), [timeRange]);
  const visibleRows = useMemo(() => filterRowsByTime(rows, cutoff, "published_at"), [rows, cutoff]);

  function toggleRow(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <h1>Published articles</h1>
      <p className="prose-lead">
        Every row is one article the system finished and saved (usually as a Markdown draft on this computer).{" "}
        <strong>Click a row</strong> to expand and see paths, supporting phrases, a rendered draft preview, and download.
      </p>

      <PageTabs
        idPrefix={baseId}
        tabs={[...ART_TABS]}
        active={tab}
        onChange={(id) => setTab(id as ArtTab)}
        ariaLabel="Published articles sections"
      />

      <div className="panel page-tab-panel" {...tabPanelAttrs(baseId, "list", tab)} style={{ overflowX: "auto" }}>
        <div className="page-toolbar">
          <div>
            <h2 className="prose-h3" style={{ marginTop: 0 }}>
              All saved articles
            </h2>
            <p className="prose-muted" style={{ marginBottom: 0 }}>
              Rows without a recorded publish time are hidden when a time window other than All time is selected.
            </p>
          </div>
          <TimeRangeFilter
            id={timeRangeId}
            className="time-range-filter--toolbar"
            value={timeRange}
            onChange={setTimeRange}
            label="Show articles from"
          />
        </div>
        {rows.length > 0 && !visibleRows.length ? (
          <p className="prose-muted">No articles in this time range. Widen the filter or choose All time.</p>
        ) : null}
        {rows.length > 0 && visibleRows.length < rows.length ? (
          <p className="prose-muted" style={{ fontSize: "0.88rem" }}>
            Showing <strong>{visibleRows.length}</strong> of <strong>{rows.length}</strong> loaded articles.
          </p>
        ) : null}
        {deleteErr && <p className="status bad">{deleteErr}</p>}
        <table className="article-table">
          <thead>
            <tr>
              <th scope="col" className="list-actions-col article-table__narrow" aria-label="Mark and delete">
                <span className="visually-hidden">Mark and delete</span>
              </th>
              <th scope="col" className="article-table__narrow" aria-label="Expand">
                <span className="visually-hidden">Expand</span>
              </th>
              <th scope="col">Article title</th>
              <th scope="col">Main topic phrase</th>
              <th scope="col">Approx. length</th>
              <th scope="col">Saved on</th>
              <th scope="col">Draft file</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r, idx) => {
              const rawId = r.id;
              const id = typeof rawId === "number" ? rawId : Number(rawId);
              const rowKey = Number.isFinite(id) ? id : idx;
              const open = expanded.has(rowKey);
              const secondaries = asStringList(r.secondary_keywords);
              const gateFails = asStringList(r.gate_failures);
              const label = `${String(r.title || "Article")}. ${open ? "Collapse" : "Expand"} details.`;

              return (
                <Fragment key={rowKey}>
                  <tr
                    className={`article-table__row${open ? " article-table__row--open" : ""} ${rowClass(rowKey)}`}
                    onClick={() => toggleRow(rowKey)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleRow(rowKey);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-expanded={open}
                    aria-label={label}
                  >
                    <td className="list-actions-col">
                      {Number.isFinite(id) ? (
                        <ListRowActions
                          compact
                          marked={isMarked(id)}
                          onToggleMark={() => toggleMark(id)}
                          busy={deletingId === id}
                          onDelete={async () => {
                            setDeleteErr(null);
                            setDeletingId(id);
                            try {
                              await deleteJson(
                                `/api/clients/${encodeURIComponent(clientId)}/articles/${encodeURIComponent(String(id))}`,
                              );
                              setReload((n) => n + 1);
                              setExpanded((prev) => {
                                const next = new Set(prev);
                                next.delete(rowKey);
                                return next;
                              });
                            } catch (e) {
                              setDeleteErr(e instanceof Error ? e.message : "Delete failed.");
                            } finally {
                              setDeletingId(null);
                            }
                          }}
                          deleteConfirm="Remove this article from the database and delete the draft file if it is still on disk? This cannot be undone."
                        />
                      ) : null}
                    </td>
                    <td className="article-table__chevron" aria-hidden>
                      <span className="article-table__chevron-icon">{open ? "▼" : "▶"}</span>
                    </td>
                    <td>
                      <strong>{String(r.title)}</strong>
                      <div className="prose-muted" style={{ fontSize: "0.82rem", marginTop: "0.2rem" }}>
                        Web slug: {String(r.slug)}
                      </div>
                    </td>
                    <td>{String(r.primary_keyword)}</td>
                    <td>{r.word_count != null ? `${r.word_count} words` : EMPTY_LABEL}</td>
                    <td>{formatWhen(String(r.published_at ?? ""))}</td>
                    <td>{r.publish_path ? shortPath(String(r.publish_path)) : EMPTY_LABEL}</td>
                  </tr>
                  {open ? (
                    <tr className="article-table__detail-wrap">
                      <td colSpan={7}>
                        <div className="article-table__detail">
                          <p className="prose-muted" style={{ marginTop: 0 }}>
                            Full details for this saved draft.
                          </p>
                          <dl className="article-table__detail-dl">
                            <dt>Full file path</dt>
                            <dd>
                              {r.publish_path ? (
                                <code className="article-table__path">{String(r.publish_path)}</code>
                              ) : (
                                <span className="prose-muted">{EMPTY_LABEL}</span>
                              )}
                            </dd>
                            {r.loop_id ? (
                              <>
                                <dt>Run reference</dt>
                                <dd>
                                  <code>{r.loop_id}</code>
                                </dd>
                              </>
                            ) : null}
                            {secondaries.length > 0 ? (
                              <>
                                <dt>Supporting phrases</dt>
                                <dd>{secondaries.join(" · ")}</dd>
                              </>
                            ) : null}
                            {r.gate_result ? (
                              <>
                                <dt>Quality check (summary)</dt>
                                <dd>
                                  <code className="article-table__mono">{String(r.gate_result)}</code>
                                </dd>
                              </>
                            ) : null}
                            {gateFails.length > 0 ? (
                              <>
                                <dt>Gate notes</dt>
                                <dd>
                                  <ul className="prose-list" style={{ margin: 0 }}>
                                    {gateFails.map((g) => (
                                      <li key={g}>{g}</li>
                                    ))}
                                  </ul>
                                </dd>
                              </>
                            ) : null}
                            {r.underperforming ? (
                              <>
                                <dt>Review flag</dt>
                                <dd>
                                  <span className="pill-bad">Flagged as underperforming</span> (from scoring)
                                </dd>
                              </>
                            ) : null}
                          </dl>
                          {r.publish_path && Number.isFinite(id) ? (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                              role="presentation"
                            >
                              <ArticleDraftPreviewCollapsible clientId={clientId} articleId={id} />
                            </div>
                          ) : null}
                          {r.publish_path && r.id != null ? (
                            <dl className="article-table__detail-dl" style={{ marginTop: "0.75rem" }}>
                              <dt>Download</dt>
                              <dd>
                                  <a
                                    className="button secondary"
                                    href={`/api/clients/${encodeURIComponent(clientId)}/articles/${String(r.id)}/download`}
                                    download
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => e.stopPropagation()}
                                  >
                                    Download .md
                                  </a>
                                  <span className="prose-muted" style={{ display: "block", marginTop: "0.35rem", fontSize: "0.86rem" }}>
                                    Saves the Markdown file to your browser’s usual Downloads folder.
                                  </span>
                                </dd>
                            </dl>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <p className="prose-muted">No articles yet.</p>}
      </div>

      <div className="panel panel--neutral page-tab-panel" {...tabPanelAttrs(baseId, "guide", tab)}>
        <h2 className="prose-h3" style={{ marginTop: 0 }}>
          What each column means
        </h2>
        <dl className="info-grid">
          <dt>Article title</dt>
          <dd>The headline stored for the page. The slug line under it is the short URL-style name.</dd>
          <dt>Main topic phrase</dt>
          <dd>The primary keyword or phrase the brief targeted (what the piece should rank for).</dd>
          <dt>Approx. length</dt>
          <dd>Word count of the body text after generation (rough guide for length).</dd>
          <dt>Saved on</dt>
          <dd>When the draft was written to disk or otherwise recorded for this workspace.</dd>
          <dt>Draft file</dt>
          <dd>
            File name only in the row. Expand a row for the full path, a <strong>Draft preview</strong> of the Markdown,
            and <strong>Download .md</strong> to save a copy through your browser.
          </dd>
        </dl>
      </div>
    </div>
  );
}
