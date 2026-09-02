# Horizon-scanning loop ledger

Companion to `spec/horizon-scanning-goal.md`. The loop appends one entry per iteration. Nothing above the first iteration entry is edited by the loop except the milestone table.

## Milestone status

| Milestone | Status | Last verified |
|---|---|---|
| M1 · Scans and sources become data | done | iteration 1, 2026-09-01 |
| M2 · Close the source gaps | not started | |
| M3 · Normalize and scan-match | not started | |
| M4 · Cluster, verify, assess | not started | |
| M5 · Weekly candidate digest | not started | |
| M6 · Front end reads data | not started | |
| M7 · Obligations and trustee agenda | not started | |

## Baseline · 2026-09-01 · before iteration 1

Recorded by hand before the loop starts, so iteration 1 has a known starting point.

- **Repo state.** Three commits on `main`, working tree clean. `scripts/collect.mjs` (233 lines, zero dependencies) collects four RSS sources (Groom, Trucker Huss, Wagner, Word on Benefits) and the Federal Register API for six agency slugs, stores one JSON per document under `data/collected/` keyed by URL hash, and writes `data/run-log.json` and a collated RSS feed. Source lists are hard-coded arrays in the script; `spec/sources.yaml` is documentation only.
- **Last local run.** `data/run-log.json` from 2026-09-02T04:59Z: 285 items in a 30-day window, 287 documents stored; Wagner returned HTTP 403 (Cloudflare challenge, intermittent); the other four sources were ok.
- **Front end.** `src/App.jsx` (273 lines) renders three hard-coded developments and a ten-row hard-coded source log. `spec/issue-schema.json` defines the JSON contract the front end would consume; nothing produces it yet.
- **Tests.** `tests/sites-worker.test.mjs` only. `npm run build` and `npm run test:sites` are the existing checks.
- **Deploy.** `.github/workflows/collate.yml` runs the collector daily at 12:17 UTC and on any push to `main` touching the collector, and deploys `_site/` to GitHub Pages at `https://bginsber.github.io/benefits-signal/collated.xml`. Pushing deploys; Ben authorized the loop to push after each green iteration.
- **Model calls.** None exist in the repo. No `@anthropic-ai/sdk` dependency yet.
- **Known non-collectable sources.** EBIA Weekly (email only), dol.gov and hhs.gov newsrooms (403 from datacenter IPs). Segal's listing is JavaScript-rendered; the underlying JSON endpoint has not been located.
- **Decisions already taken by default** (spec § 14): none applied yet. The loop applies the recommended defaults as each milestone reaches them and records them here.

## Iteration 1 · 2026-09-01 · Milestone M1
Slice: scans and sources become data; collector reads config; test runner wired.
Done:
- `scripts/lib/yaml.mjs`: zero-dependency YAML subset parser (mappings, sequences, inline arrays, `>`/`|` block scalars, plain multi-line continuations, comments). Verified against the real `spec/sources.yaml`: 7 interpretation + 9 primary entries, multi-line notes joined, URL lists intact.
- `spec/scans.yaml`: five scans (fhw, met, ca9, cyb, atf) with id, name, charter (verbatim from spec § 3), primary_authorities, plan_types, out_of_scope (from spec § 6.3).
- `spec/sources.yaml`: added a stable `id` to every entry; `agencies:` list on the Federal Register entry (the six verified slugs); `collector: none` on the DOL OA/ETA entry because its FR agencies are already in the Federal Register entry.
- `scripts/lib/sources.mjs`: `loadSources()`, `loadScans()`, `resolveCollector()`. Collector chosen by `collector:` override, else by method: rss → rss; api at federalregister.gov with `agencies` → federal-register; email/scrape/scrape-js/other api → skipped with a reason naming the milestone that will add it.
- `scripts/collect.mjs`: hard-coded `RSS_SOURCES` and `FR_AGENCIES` removed; main loop iterates active config sources; skipped sources get a `skipped` row in `data/run-log.json`; feed `<description>` lists the sources actually collected; the fatal check counts attempted sources only.
- `package.json`: `npm test` = `node --test tests/*.test.mjs`. `tests/yaml.test.mjs` (2 tests), `tests/config.test.mjs` (3 tests).
- `.gitignore`: `public/collated.xml`, `dist/client/collated.xml`, `.claude/*.local.md` (runtime and loop-state files).
- Goal file edit (allowed: acceptance command was wrong): `node --test tests/` fails on Node 24 with MODULE_NOT_FOUND because a bare directory is not a test target; replaced with `npm test` in the three places it appeared.
Evidence:
```
$ npm test                       → ℹ tests 9  ℹ pass 9  ℹ fail 0
$ npm run test:sites             → ℹ pass 4  ℹ fail 0
$ npm run build                  → ✓ built in 456ms; Prepared Sites build: dist/server/index.js and dist/.openai/hosting.json; dist/ unchanged in git
$ node scripts/collect.mjs --days 7
ok   Groom Law Group: 5 items / ok Trucker Huss: 1 / FAIL Wagner Law Group Law Alerts: HTTP 403 / ok Word on Benefits: 2 / ok Federal Register API: 70
12 sources skipped with reasons (ebia email; mercer/segal/irs/cms/ca-das/dol/hhs scrape or scrape-js; regulations-gov/courtlistener api; dol-oa-eta collector: none)
78 unique items in window (13 newly stored) → public/collated.xml
data/run-log.json: 16 rows, one per active source, each with ok+items, ok:false+error, or skipped reason
```
Decisions taken by default: none reached yet.
Assumptions: "adding a source requires no code change" is satisfied for rss and Federal Register sources; other methods still need a collector (M2) but are already representable in config and are skipped, not errors. Node 24 is the local runtime; Actions uses Node 20, and nothing added depends on >20 features.
Follow-ups (left alone):
- `spec/README-collector.md` still says the collected subset is "mirrored" in the script; now it is read from config. One-line doc update when M2 changes that section anyway.
- `node_modules` was not installed locally; `npm ci` was needed before `npm run build` worked. Not a repo defect.
- Wagner 403 (Cloudflare challenge) persists locally; retry-and-backoff is scheduled for M2.
Blocked: nothing.
