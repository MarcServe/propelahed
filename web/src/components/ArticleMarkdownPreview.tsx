import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

type PreviewProps = {
  clientId: string;
  articleId: number;
  /** Omit title/lead when nested under a collapsible summary. */
  embedded?: boolean;
};

function ArticleMarkdownPreview({ clientId, articleId, embedded }: PreviewProps) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setMarkdown(null);
    fetch(`/api/clients/${encodeURIComponent(clientId)}/articles/${articleId}/content`)
      .then(async (r) => {
        if (!r.ok) {
          let msg = r.statusText;
          try {
            const j = (await r.json()) as { detail?: unknown };
            if (typeof j.detail === "string") msg = j.detail;
          } catch {
            /* use statusText */
          }
          throw new Error(msg);
        }
        return r.json() as Promise<{ markdown: string }>;
      })
      .then((d) => {
        if (!cancelled) setMarkdown(d.markdown);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Could not load preview");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, articleId]);

  return (
    <div className={embedded ? "article-md-preview article-md-preview--embedded" : "article-md-preview"}>
      {!embedded && (
        <>
          <h3 className="prose-h3 article-md-preview__title">Draft preview</h3>
          <p className="prose-muted article-md-preview__lead">
            Rendered Markdown from the saved file (same as Download .md).
          </p>
        </>
      )}
      {loading && <p className="prose-muted">{embedded ? "Loading preview…" : "Loading…"}</p>}
      {err && <p className="status bad">{err}</p>}
      {!loading && !err && markdown !== null && (
        <div className="article-md-preview__body">
          <ReactMarkdown>{markdown}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

/**
 * Draft preview collapsed by default; fetches and renders Markdown only after the user expands.
 */
export default function ArticleDraftPreviewCollapsible({ clientId, articleId }: { clientId: string; articleId: number }) {
  const [open, setOpen] = useState(false);

  return (
    <details
      className="article-md-preview-details"
      onToggle={(e) => {
        e.stopPropagation();
        setOpen((e.currentTarget as HTMLDetailsElement).open);
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <summary className="article-md-preview__summary">
        <span className="article-md-preview__summary-main">Draft preview</span>
        <span className="prose-muted article-md-preview__summary-hint">
          {" "}
          — expand to load rendered Markdown (same as Download .md).
        </span>
      </summary>
      <div className="article-md-preview-details__panel">
        {open ? <ArticleMarkdownPreview clientId={clientId} articleId={articleId} embedded /> : null}
      </div>
    </details>
  );
}
