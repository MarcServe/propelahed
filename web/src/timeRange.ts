export type TimeRangeId = "all" | "24h" | "7d" | "30d" | "90d" | "365d";

export const TIME_RANGE_OPTIONS: { id: TimeRangeId; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "24h", label: "Last 24 hours" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "365d", label: "Last year" },
];

export function cutoffForRange(id: TimeRangeId): Date | null {
  if (id === "all") return null;
  const now = Date.now();
  const msMap: Record<Exclude<TimeRangeId, "all">, number> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
    "365d": 365 * 24 * 60 * 60 * 1000,
  };
  return new Date(now - msMap[id as Exclude<TimeRangeId, "all">]);
}

/** Row is included if ISO timestamp is on/after cutoff, or if there is no cutoff. Missing/invalid dates fail the filter when a cutoff is set. */
export function isoInRange(iso: string | undefined | null, cutoff: Date | null): boolean {
  if (cutoff === null) return true;
  const s = iso != null ? String(iso).trim() : "";
  if (!s) return false;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return false;
  return t >= cutoff.getTime();
}

export function filterRowsByTime<T>(
  rows: T[],
  cutoff: Date | null,
  timeKey: keyof T,
): T[] {
  if (cutoff === null) return rows;
  return rows.filter((r) => isoInRange(String((r as Record<string, unknown>)[String(timeKey)] ?? ""), cutoff));
}
