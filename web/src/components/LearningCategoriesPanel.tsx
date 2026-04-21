import { useId, useState, type ReactNode } from "react";
import BulletSection from "./BulletSection";
import PageTabs, { tabPanelAttrs } from "./PageTabs";
import { asStringArray, formatWhen, humanizeLearningCopy, keywordRegistryForDisplay } from "../formatDisplay";

export type LearningSubTab = "topics" | "avoid" | "quality" | "keywords" | "all";

export const LEARNING_SUB_TABS = [
  { id: "topics" as const, label: "Next topics", hint: "Ideas for upcoming drafts" },
  { id: "avoid" as const, label: "Avoid", hint: "Angles or wording to skip" },
  { id: "quality" as const, label: "Quality notes", hint: "From the last review" },
  { id: "keywords" as const, label: "Keyword memory", hint: "Phrases already used" },
  { id: "all" as const, label: "View all", hint: "Every list on one page" },
];

type Snapshot = Record<string, unknown>;

/**
 * Sub-tabs + “View all” for one learning snapshot (same pattern as Home → Learning).
 */
export default function LearningCategoriesPanel({
  snapshot,
  keywordSampleLimit = 15,
  intro,
  showUpdatedPill = true,
  variant = "snapshot",
}: {
  snapshot: Snapshot;
  keywordSampleLimit?: number;
  /** Optional lead paragraph (e.g. Home learning tab). */
  intro?: ReactNode;
  /** When false, omit the “Updated …” pill (caller shows their own heading). */
  showUpdatedPill?: boolean;
  /** `home` matches Home dashboard wording; `snapshot` matches per-card timeline wording. */
  variant?: "home" | "snapshot";
}) {
  const learningPanelId = useId();
  const [learningSub, setLearningSub] = useState<LearningSubTab>("topics");

  const priorities = asStringArray(snapshot.priority_topics).map(humanizeLearningCopy);
  const avoid = asStringArray(snapshot.do_not_repeat).map(humanizeLearningCopy);
  const patterns = asStringArray(snapshot.quality_patterns).map(humanizeLearningCopy);
  const keywords = keywordRegistryForDisplay(
    asStringArray(snapshot.keyword_registry),
    keywordSampleLimit,
  ).map(humanizeLearningCopy);

  const empty =
    variant === "home"
      ? {
          priorities: "No priority list yet. It fills in after more successful runs.",
          avoid: "Nothing flagged to avoid yet.",
          quality: "No written patterns stored yet.",
          keywords: "No keyword history yet.",
        }
      : {
          priorities: "No priority list in this snapshot.",
          avoid: "Nothing flagged to avoid in this snapshot.",
          quality: "No written patterns in this snapshot.",
          keywords: "No keyword list in this snapshot.",
        };

  return (
    <div className="learning-tab-body">
      {intro}
      {showUpdatedPill && (
        <div className="learning-tab-meta">
          <span className="learning-updated-pill">
            Updated {formatWhen(String(snapshot.updated_at ?? ""))}
          </span>
        </div>
      )}
      <div className="learning-subtabs-shell">
        <PageTabs
          idPrefix={learningPanelId}
          tabs={[...LEARNING_SUB_TABS]}
          active={learningSub}
          onChange={(id) => setLearningSub(id as LearningSubTab)}
          ariaLabel="Learning categories"
        />
      </div>
      <div
        className="page-tab-panel learning-subcategory-panel"
        {...tabPanelAttrs(learningPanelId, "topics", learningSub)}
      >
        <BulletSection title="Suggested next topics" items={priorities} emptyNote={empty.priorities} />
      </div>
      <div
        className="page-tab-panel learning-subcategory-panel"
        {...tabPanelAttrs(learningPanelId, "avoid", learningSub)}
      >
        <BulletSection title="Angles or wording to avoid" items={avoid} emptyNote={empty.avoid} />
      </div>
      <div
        className="page-tab-panel learning-subcategory-panel"
        {...tabPanelAttrs(learningPanelId, "quality", learningSub)}
      >
        <BulletSection title="Quality notes from the last review" items={patterns} emptyNote={empty.quality} />
      </div>
      <div
        className="page-tab-panel learning-subcategory-panel"
        {...tabPanelAttrs(learningPanelId, "keywords", learningSub)}
      >
        <BulletSection
          title="Keywords we have already used (sample)"
          items={keywords}
          emptyNote={empty.keywords}
        />
      </div>
      <div className="page-tab-panel learning-view-all" {...tabPanelAttrs(learningPanelId, "all", learningSub)}>
        <div className="learning-subcategory-panel learning-view-all__chunk">
          <BulletSection title="Suggested next topics" items={priorities} emptyNote={empty.priorities} />
        </div>
        <div className="learning-subcategory-panel learning-view-all__chunk">
          <BulletSection title="Angles or wording to avoid" items={avoid} emptyNote={empty.avoid} />
        </div>
        <div className="learning-subcategory-panel learning-view-all__chunk">
          <BulletSection title="Quality notes from the last review" items={patterns} emptyNote={empty.quality} />
        </div>
        <div className="learning-subcategory-panel learning-view-all__chunk">
          <BulletSection
            title="Keywords we have already used (sample)"
            items={keywords}
            emptyNote={empty.keywords}
          />
        </div>
      </div>
    </div>
  );
}
