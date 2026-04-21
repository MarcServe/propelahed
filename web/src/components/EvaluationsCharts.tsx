import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Row = Record<string, unknown>;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function rowId(r: Row): string {
  return String(r.id ?? "");
}

/** 0–100 scale per component max for radar. */
function rowToRadarParts(r: Row) {
  return [
    { name: "Topic depth", score: (num(r.semantic_coverage) / 25) * 100 },
    { name: "Keywords", score: (num(r.keyword_usage) / 25) * 100 },
    { name: "Readability", score: (num(r.readability) / 20) * 100 },
    { name: "Structure", score: (num(r.structural_completeness) / 20) * 100 },
    { name: "Internal links", score: (num(r.internal_linking) / 10) * 100 },
  ];
}

type TrendPoint = {
  id: string;
  label: string;
  overall: number;
  time: string;
};

type BarRow = {
  id: string;
  name: string;
  overall: number;
};

export default function EvaluationsCharts({
  rows,
  onArticleNavigate,
}: {
  rows: Row[];
  onArticleNavigate?: (articleId: string) => void;
}) {
  if (!rows.length) return null;

  const primary = rows[0];
  const primaryId = rowId(primary);
  const radarData = rowToRadarParts(primary);

  const trendData: TrendPoint[] = [...rows]
    .map((r) => ({
      id: rowId(r),
      label: String(r.title ?? "Article").slice(0, 28) + (String(r.title ?? "").length > 28 ? "…" : ""),
      overall: num(r.overall_score),
      time: String(r.evaluated_at ?? ""),
    }))
    .sort((a, b) => a.time.localeCompare(b.time));

  const compareData: BarRow[] = rows.map((r) => ({
    id: rowId(r),
    name: String(r.title ?? "Untitled").slice(0, 42) + (String(r.title ?? "").length > 42 ? "…" : ""),
    overall: num(r.overall_score),
  }));

  const goRadar = () => {
    if (primaryId && onArticleNavigate) onArticleNavigate(primaryId);
  };

  const handleLineChartClick = (state: { activeTooltipIndex?: number }) => {
    const i = state?.activeTooltipIndex;
    if (i == null || !onArticleNavigate) return;
    const id = trendData[i]?.id;
    if (id) onArticleNavigate(id);
  };

  const handleBarClick = (data: { payload?: BarRow }) => {
    const id = data?.payload?.id;
    if (id && onArticleNavigate) onArticleNavigate(id);
  };

  const navigate = Boolean(onArticleNavigate);

  return (
    <div className="eval-charts eval-charts--compact">
      <details className="eval-charts-card">
        <summary className="eval-charts-card__summary">
          <span className="eval-charts-card__summary-title">Latest article: score shape (normalized to 100)</span>
        </summary>
        <div className="eval-charts-card__body">
          <p className="prose-muted" style={{ marginTop: 0 }}>
            <strong>{String(primary.title ?? "Untitled")}</strong>. Each axis is the score as a percentage of its column maximum.
            {navigate && primaryId ? (
              <span className="eval-charts-card__click-hint"> Click the chart to scroll to this article in the table.</span>
            ) : null}
          </p>
          <div
            className={`eval-charts-radar${navigate && primaryId ? " eval-charts-radar--clickable" : ""}`}
            style={{ width: "100%", height: 210 }}
            role={navigate && primaryId ? "button" : undefined}
            tabIndex={navigate && primaryId ? 0 : undefined}
            aria-label={navigate && primaryId ? "Scroll to latest article in the scores table" : undefined}
            onKeyDown={(e) => {
              if (!navigate || !primaryId) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                goRadar();
              }
            }}
            onClick={goRadar}
          >
            <ResponsiveContainer>
              <RadarChart data={radarData} cx="50%" cy="52%" outerRadius="68%">
                <PolarGrid />
                <PolarAngleAxis dataKey="name" tick={{ fontSize: 11 }} />
                <Radar
                  name="Score % of max"
                  dataKey="score"
                  stroke="var(--accent-teal)"
                  fill="var(--accent-teal)"
                  fillOpacity={0.35}
                />
                <Tooltip formatter={(v: number) => [`${v.toFixed(1)}% of max`, ""]} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </details>

      <details className="eval-charts-card">
        <summary className="eval-charts-card__summary">
          <span className="eval-charts-card__summary-title">Overall score trend (by review time)</span>
        </summary>
        <div className="eval-charts-card__body">
          <p className="prose-muted" style={{ marginTop: 0 }}>
            Line shows overall score (out of 100) in chronological order.
            {navigate ? <span className="eval-charts-card__click-hint"> Click a point or the chart strip for a row.</span> : null}
          </p>
          <div
            className={navigate ? "eval-charts-line-wrap eval-charts-line-wrap--clickable" : "eval-charts-line-wrap"}
            style={{ width: "100%", height: 185 }}
          >
            <ResponsiveContainer>
              <LineChart
                data={trendData}
                margin={{ top: 4, right: 8, left: 0, bottom: 2 }}
                onClick={handleLineChartClick}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9 }}
                  interval="preserveStartEnd"
                  angle={-20}
                  textAnchor="end"
                  height={52}
                />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => [`${v.toFixed(1)} / 100`, "Overall"]} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                <Line
                  type="monotone"
                  dataKey="overall"
                  name="Overall"
                  stroke="var(--brand)"
                  strokeWidth={2}
                  dot={
                    navigate
                      ? (dotProps: { cx?: number; cy?: number; payload?: TrendPoint }) => {
                          const { cx, cy, payload } = dotProps;
                          return (
                            <circle
                              cx={cx}
                              cy={cy}
                              r={4}
                              fill="var(--brand)"
                              stroke="#fff"
                              strokeWidth={2}
                              className="recharts-dot eval-charts-line-dot"
                              style={{ cursor: payload?.id ? "pointer" : undefined }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (payload?.id && onArticleNavigate) onArticleNavigate(payload.id);
                              }}
                            />
                          );
                        }
                      : true
                  }
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </details>

      {rows.length > 1 ? (
        <details className="eval-charts-card eval-charts-card--bar">
          <summary className="eval-charts-card__summary">
            <span className="eval-charts-card__summary-title">Compare overall scores</span>
          </summary>
          <div className="eval-charts-card__body">
            {navigate ? (
              <p className="prose-muted eval-charts-bar-hint" style={{ marginTop: 0 }}>
                <span className="eval-charts-card__click-hint">Click a bar to scroll to that article.</span>
              </p>
            ) : null}
            <div
              className={navigate ? "eval-charts-bar-wrap eval-charts-bar-wrap--clickable" : "eval-charts-bar-wrap"}
              style={{ width: "100%", height: Math.min(260, 52 + rows.length * 28) }}
            >
              <ResponsiveContainer>
                <BarChart
                  layout="vertical"
                  data={compareData}
                  margin={{ top: 4, right: 10, left: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={168} tick={{ fontSize: 9 }} />
                  <Tooltip formatter={(v: number) => [`${v.toFixed(1)}`, "Overall / 100"]} />
                  <Bar
                    dataKey="overall"
                    name="Overall"
                    fill="var(--accent-teal)"
                    radius={[0, 4, 4, 0]}
                    cursor={navigate ? "pointer" : undefined}
                    onClick={handleBarClick}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}
