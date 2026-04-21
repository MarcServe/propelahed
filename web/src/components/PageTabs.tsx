export type PageTabSpec = { id: string; label: string; hint?: string };

type Props = {
  /** From `useId()` in the parent. Ties tab buttons to panels. */
  idPrefix: string;
  tabs: PageTabSpec[];
  active: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
};

/**
 * Accessible section tabs (shared pattern across Settings, Home, Research, etc.).
 */
export default function PageTabs({ idPrefix, tabs, active, onChange, ariaLabel = "Sections" }: Props) {
  return (
    <div className="page-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${t.id}`}
          aria-selected={active === t.id}
          aria-controls={`${idPrefix}-panel-${t.id}`}
          className={`page-tabs__btn${active === t.id ? " is-active" : ""}`}
          onClick={() => onChange(t.id)}
        >
          <span className="page-tabs__btn-label">{t.label}</span>
          {t.hint ? <span className="page-tabs__btn-hint">{t.hint}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Spread onto each tab panel so tabs and panels stay linked for screen readers. */
export function tabPanelAttrs(idPrefix: string, tabId: string, activeTab: string) {
  return {
    role: "tabpanel" as const,
    id: `${idPrefix}-panel-${tabId}`,
    hidden: activeTab !== tabId,
    "aria-labelledby": `${idPrefix}-tab-${tabId}`,
  };
}
