import type { ReactNode } from "react";

type Props = {
  marked: boolean;
  onToggleMark: () => void;
  onDelete?: () => void | Promise<void>;
  deleteConfirm?: string;
  busy?: boolean;
  /** Optional compact layout for table cells */
  compact?: boolean;
  extra?: ReactNode;
};

export default function ListRowActions({
  marked,
  onToggleMark,
  onDelete,
  deleteConfirm = "Delete this row from the database? This cannot be undone.",
  busy,
  compact,
  extra,
}: Props) {
  return (
    <div
      className={`list-row-actions${compact ? " list-row-actions--compact" : ""}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={`list-row-actions__mark${marked ? " list-row-actions__mark--on" : ""}`}
        aria-label={marked ? "Unmark row" : "Mark row"}
        aria-pressed={marked}
        title={marked ? "Marked locally (not synced)" : "Mark for your attention"}
        onClick={onToggleMark}
        disabled={busy}
      >
        ★
      </button>
      {onDelete ? (
        <button
          type="button"
          className="list-row-actions__delete secondary"
          aria-label="Delete row"
          title="Remove from this workspace database"
          disabled={busy}
          onClick={async () => {
            if (!window.confirm(deleteConfirm)) return;
            await onDelete();
          }}
        >
          {busy ? "…" : "Delete"}
        </button>
      ) : null}
      {extra}
    </div>
  );
}
