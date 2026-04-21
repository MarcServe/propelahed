# Example output from one complete loop

These files show what a **successful** run of `run_loop()` produces: a published Markdown draft, one **evaluation** row (scores + findings), and one **learning_store** snapshot after **learn** merges into SQLite.

They are **fixed samples** checked into the repo so reviewers can inspect output **without** running the engine. Your own runs write to `seo_engine/output/{client_id}/` and `data/{client_id}.db` (gitignored).

| File | What it is |
|------|----------------|
| [`article-sample.md`](article-sample.md) | Generated blog post (YAML front matter + body). Same shape as `stage3_publish` output. |
| [`evaluation-sample.json`](evaluation-sample.json) | Proxy rubric scores and reviewer-style findings (matches `evaluations` table + API shape). |
| [`learning-store-sample.json`](learning-store-sample.json) | One merged learning snapshot: priorities, avoid lines, quality patterns, keyword registry (matches `learning_store` columns). |

**How to reproduce locally:** configure `seo_engine/config/<client>.yaml`, set `ANTHROPIC_API_KEY` in `.env`, then:

```bash
export PYTHONPATH=.
python main.py --config seo_engine/config/talkweb.yaml
```

Then inspect `seo_engine/output/talkweb/*.md`, TablePlus or `sqlite3` on `data/talkweb.db` (`evaluations`, `learning_store`).
