/** DELETE helper: throws Error with server detail when not ok. */
export async function deleteJson(path: string): Promise<void> {
  const r = await fetch(path, { method: "DELETE" });
  if (!r.ok) {
    let msg = r.statusText;
    try {
      const b = (await r.json()) as { detail?: unknown };
      if (typeof b.detail === "string") msg = b.detail;
      else if (Array.isArray(b.detail)) msg = b.detail.map(String).join("; ");
    } catch {
      /* use statusText */
    }
    throw new Error(msg);
  }
}
