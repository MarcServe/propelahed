import { type ReactNode, useEffect, useState } from "react";
import yaml from "js-yaml";
import ReactMarkdown from "react-markdown";

/** Split leading YAML front matter (--- … ---) from body; body unchanged if parse fails. */
export function splitYamlFrontMatter(raw: string): { meta: Record<string, unknown> | null; body: string } {
  const t = raw.replace(/^\uFEFF/, "");
  if (!t.startsWith("---")) {
    return { meta: null, body: raw };
  }
  let p = 3;
  if (t[p] === "\r") p++;
  if (t[p] !== "\n") {
    return { meta: null, body: raw };
  }
  p++;
  const sub = t.slice(p);
  const re = /\r?\n---\r?\n/;
  const match = re.exec(sub);
  if (!match) {
    return { meta: null, body: raw };
  }
  const yamlStr = sub.slice(0, match.index);
  const body = sub.slice(match.index + match[0].length);
  try {
    const loaded = yaml.load(yamlStr);
    if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
      return { meta: loaded as Record<string, unknown>, body };
    }
  } catch {
    /* use full markdown */
  }
  return { meta: null, body: raw };
}

const FRONT_KEYS: { key: string; label: string }[] = [
  { key: "title", label: "title" },
  { key: "description", label: "description" },
  { key: "date", label: "date" },
  { key: "keywords", label: "keywords" },
  { key: "slug", label: "slug" },
];

function FrontMatterRows({ meta }: { meta: Record<string, unknown> }) {
  const rows = FRONT_KEYS.filter(({ key }) => meta[key] !== undefined && meta[key] !== null);
  if (!rows.length) return null;
  return (
    <div className="article-md-frontmatter">
      {rows.map(({ key, label }) => (
        <div key={key} className="article-md-frontmatter__row">
          <strong className="article-md-frontmatter__key">{label}:</strong>
          <div className="article-md-frontmatter__value">{formatMetaValue(meta[key])}</div>
        </div>
      ))}
    </div>
  );
}

function formatMetaValue(v: unknown): ReactNode {
  if (v == null) return "";
  if (Array.isArray(v)) {
    return (
      <ul className="article-md-frontmatter__kw">
        {v.map((x, i) => (
          <li key={i}>{String(x)}</li>
        ))}
      </ul>
    );
  }
  if (typeof v === "object") {
    return <pre className="article-md-frontmatter__json">{JSON.stringify(v, null, 2)}</pre>;
  }
  return String(v);
}

function ArticlePreviewContent({ markdown }: { markdown: string }) {
  const { meta, body } = splitYamlFrontMatter(markdown);
  return (
    <div className="article-md-preview-sheet">
      {meta ? <FrontMatterRows meta={meta} /> : null}
      <div className="article-md-preview__body article-md-preview__body--main">
        <ReactMarkdown>{body.trimStart()}</ReactMarkdown>
      </div>
    </div>
  );
}

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
      {!loading && !err && markdown !== null && <ArticlePreviewContent markdown={markdown} />}
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
