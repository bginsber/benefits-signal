# Benefits Signal — Phase 0 collector

`scripts/collect.mjs` is the spec § 6.1 collector: zero dependencies, Node 18+.

```
node scripts/collect.mjs            # 30-day window
node scripts/collect.mjs --days 7   # narrower window
```

What it does each run: fetches the four verified RSS interpretation sources (Groom, Trucker Huss, Wagner, Word on Benefits) and the Federal Register API for EBSA, IRS, ETA, WHD, HHS, and CMS (with structured comment-deadline and effective-date fields); stores one JSON document per item under `data/collected/` keyed by URL hash, so re-runs never duplicate; writes `data/run-log.json` with per-source outcomes (this feeds the "source silent for N days" notice); and emits `public/collated.xml`, a merged RSS 2.0 feed sorted newest-first, capped at 100 items. The store keeps every Federal Register document; the collated feed omits routine FR notices unless they carry a comment deadline, because notices outnumber rules roughly 4:1 and would swamp an inbox.

Not yet collected (Phase 0 follow-ups per `spec/sources.yaml`): EBIA Weekly (email-only — needs the dedicated mailbox), Mercer (scrape), Segal (JS-rendered listing), dol.gov / hhs.gov newsrooms (bot-protected; the Federal Register API covers their regulatory documents), and the California DAS/CAC pages (plain-HTML scrape, straightforward to add).

## Reading it in Outlook Classic

Outlook Classic subscribes to RSS by URL (right-click **RSS Feeds** in the folder pane → **Add a New RSS Feed…**), but the URL must be reachable from the machine — a local file path is not reliable. Two options:

**Option A — no infrastructure (works today).** Import `benefits-signal.opml` (File → Open & Export → Import/Export → Import RSS Feeds from an OPML file). Outlook subscribes directly to each source feed, including per-agency Federal Register feeds (the FR API's `.rss` variant is verified working). You get one Outlook folder per source rather than one collated feed, and no collation script needs to run anywhere.

**Option B — one collated feed via GitHub Pages (set up; needs one push).** Everything is staged in this repo: `.github/workflows/collate.yml` runs the collector daily at ~5:17am Pacific (plus on demand via workflow_dispatch) and deploys `collated.xml` to GitHub Pages; the collector reads `FEED_URL` from the environment so the channel link self-configures to the Pages URL. To go live from this folder:

```
git init -b main && git add -A && git commit -m "Benefits Signal prototype + Phase 0 collector"
gh repo create benefits-signal --private --source . --push
gh api repos/bginsber/benefits-signal/pages -X POST -f build_type=workflow
gh workflow run collate.yml
```

(The Pages API call can also be done in the repo's Settings → Pages → Source: GitHub Actions. A private repo needs GitHub Pro for Pages; on a free plan make the repo public — the feed contains only public regulatory material.)

The feed lands at `https://bginsber.github.io/benefits-signal/collated.xml` — add that one URL in Outlook (right-click **RSS Feeds** → **Add a New RSS Feed…**). Pages serves a proper XML content type; do not use raw.githubusercontent.com, which serves `text/plain` and Outlook sometimes rejects. Note the Actions runner starts fresh each run, so `data/` is per-run scratch there; the durable document store arrives with the pipeline's Postgres in Phase 1.

A sample `public/collated.xml` from a live 2026-09-01 run is committed for inspection; `data/` is runtime output and should not be committed (add `data/` to `.gitignore` when the pipeline repo is initialized).
