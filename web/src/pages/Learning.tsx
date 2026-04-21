import { useEffect, useId, useMemo, useState } from "react";
import { deleteJson } from "../apiDelete";
import ListRowActions from "../components/ListRowActions";
import LearningCategoriesPanel from "../components/LearningCategoriesPanel";
import PageTabs, { tabPanelAttrs } from "../components/PageTabs";
import TimeRangeFilter from "../components/TimeRangeFilter";
import { formatWhen } from "../formatDisplay";
import type { TimeRangeId } from "../timeRange";
import { cutoffForRange, filterRowsByTime } from "../timeRange";
import { useListMarks } from "../useListMarks";

type Row = Record<string, unknown>;

type LearnTab = "timeline" | "about";

const LEARN_TABS = [
  { id: "timeline", label: "History", hint: "Snapshots over time" },
  { id: "about", label: "About learning", hint: "How this feeds the next run" },
] as const;

export default function Learning({ clientId }: { clientId: string }) {
  const baseId = useId();
  const timeRangeId = `${baseId}-time-range`;
  const [tab, setTab] = useState<LearnTab>("timeline");
  const [rows, setRows] = useState<Row[]>([]);
  const [timeRange, setTimeRange] = useState<TimeRangeId>("all");
  const [reload, setReload] = useState(0);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const { isMarked, toggleMark, rowClass } = useListMarks(clientId, "learning");

  useEffect(() => {
    fetch(`/api/clients/${encodeURIComponent(clientId)}/learning?limit=50`)
      .then((r) => r.json())
      .then(setRows);
  }, [clientId, reload]);

  const cutoff = useMemo(() => cutoffForRange(timeRange), [timeRange]);
  const visibleRows = useMemo(() => filterRowsByTime(rows, cutoff, "updated_at"), [rows, cutoff]);

  return (
    <div>
      <h1>What we learned over time</h1>
      <p className="prose-lead">
        Each card is one saved snapshot after a run. The lists use the same layout as <strong>Home → Learning</strong>{" "}
        (category tabs, View all, and keywords sample).
      </p>

      <PageTabs
        idPrefix={baseId}
        tabs={[...LEARN_TABS]}
        active={tab}
        onChange={(id) => setTab(id as LearnTab)}
        ariaLabel="Learning sections"
      />

      <div className="page-tab-panel" {...tabPanelAttrs(baseId, "timeline", tab)}>
        <div className="page-toolbar">
          <p className="prose-muted learning-tab-lead page-toolbar__lead" style={{ marginBottom: 0 }}>
            Newest snapshots are listed first. Open <strong>Next topics</strong>, <strong>Avoid</strong>, and the other
            tabs, or <strong>View all</strong>, for each point in time. History loads the latest 50 snapshots; narrow the
            time range to focus.
          </p>
          <TimeRangeFilter id={timeRangeId} value={timeRange} onChange={setTimeRange} label="Show snapshots from" />
        </div>
        {!rows.length && <p className="prose-muted">No history yet.</p>}
        {rows.length > 0 && !visibleRows.length ? (
          <p className="prose-muted">No learning snapshots in this time range. Choose a wider window or All time.</p>
        ) : null}
        {deleteErr && <p className="status bad">{deleteErr}</p>}
        {visibleRows.map((r) => {
          const lid = r.id;
          const idNum = typeof lid === "number" ? lid : Number(lid);
          const hasId = Number.isFinite(idNum);
          return (
          <div
            key={String(r.id)}
            className={`panel panel--neutral${hasId ? ` ${rowClass(idNum)}` : ""}`}
            style={{ marginBottom: "1rem" }}
          >
            <div className="learning-card-head">
              <h2 className="prose-h3 learning-card-head__title" style={{ fontSize: "1.05rem", marginTop: 0 }}>
                Update on {formatWhen(String(r.updated_at ?? ""))}
              </h2>
              {hasId ? (
                <ListRowActions
                  compact
                  marked={isMarked(idNum)}
                  onToggleMark={() => toggleMark(idNum)}
                  busy={deletingId === idNum}
                  onDelete={async () => {
                    setDeleteErr(null);
                    setDeletingId(idNum);
                    try {
                      await deleteJson(
                        `/api/clients/${encodeURIComponent(clientId)}/learning/${encodeURIComponent(String(idNum))}`,
                      );
                      setReload((n) => n + 1);
                    } catch (e) {
                      setDeleteErr(e instanceof Error ? e.message : "Delete failed.");
                    } finally {
                      setDeletingId(null);
                    }
                  }}
                  deleteConfirm="Remove this learning snapshot? Newer snapshots are unchanged; this only deletes this history row."
                />
              ) : null}
            </div>
            <LearningCategoriesPanel snapshot={r} keywordSampleLimit={25} showUpdatedPill={false} />
            <details className="tech-details">
              <summary>Technical reference</summary>
              <p className="prose-muted">Internal loop reference: {String(r.loop_id)}</p>
            </details>
          </div>
        );
        })}
      </div>

      <div className="panel panel--neutral page-tab-panel" {...tabPanelAttrs(baseId, "about", tab)}>
        <h2 className="prose-h3" style={{ marginTop: 0 }}>
          How learning snapshots work
        </h2>
        <dl className="info-grid">
          <dt>What this page stores</dt>
          <dd>
            After certain successful runs, the engine saves lists of priorities, things to avoid, quality notes,
            and a sample of keywords it has seen. That is <strong>not</strong> raw debug output. It is the same
            kind of information the next pipeline uses when planning a brief.
          </dd>
          <dt>Why there are several cards</dt>
          <dd>
            Each card is a point in time (newest first in the list). Comparing them shows how focus shifts as
            you publish more.
          </dd>
          <dt>Where it shows up elsewhere</dt>
          <dd>
            The <strong>Home</strong> page surfaces the latest snapshot briefly; <strong>Research notes</strong>{" "}
            shows how priorities interact with your operator instructions. After each successful run, the engine also
            merges <strong>numeric scores</strong>, <strong>gate advisory warnings</strong> (e.g. keyword density), and
            evaluator findings into quality patterns. Those feed the next <strong>Research</strong> and{" "}
            <strong>Write new article</strong> steps together with the latest evaluation row from the database.
          </dd>
          <dt>What is not captured here</dt>
          <dd>
            Runs that fail before publish (quality gate, errors) do not produce a new evaluation row, so there is nothing
            new to learn from that attempt beyond loop history. Full score history stays under{" "}
            <strong>Quality scores</strong>.
          </dd>
        </dl>
      </div>
    </div>
  );
}
