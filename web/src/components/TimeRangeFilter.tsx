import type { TimeRangeId } from "../timeRange";
import { TIME_RANGE_OPTIONS } from "../timeRange";

export default function TimeRangeFilter({
  id,
  value,
  onChange,
  label = "Time range",
  className,
}: {
  id: string;
  value: TimeRangeId;
  onChange: (v: TimeRangeId) => void;
  label?: string;
  className?: string;
}) {
  return (
    <div className={className ? `time-range-filter ${className}` : "time-range-filter"}>
      <label htmlFor={id} className="time-range-filter__label">
        {label}
      </label>
      <select
        id={id}
        className="time-range-filter__select"
        value={value}
        onChange={(e) => onChange(e.target.value as TimeRangeId)}
      >
        {TIME_RANGE_OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
