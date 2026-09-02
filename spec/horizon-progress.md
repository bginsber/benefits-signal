# Horizon-scanning loop ledger

Companion to `spec/horizon-scanning-goal.md`. The loop appends one entry per iteration. Nothing above the first iteration entry is edited by the loop except the milestone table.

## Milestone status

| Milestone | Status | Last verified |
|---|---|---|
| M1 · Scans and sources become data | done | iteration 1, 2026-09-01 |
| M2 · Close the source gaps | done | iteration 2, 2026-09-01 |
| M3 · Normalize and scan-match | built; live run blocked on credentials | iteration 3, 2026-09-01 |
| M4 · Cluster, verify, assess | built; live run blocked on credentials | iteration 4, 2026-09-01 |
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

## Iteration 2 · 2026-09-01 · Milestone M2
Slice: collectors for CourtListener, California DAS/CAC, Mercer, Segal; retry-and-backoff; source-silent notice.
Done:
- `scripts/lib/collectors.mjs` (new): `fetchText` with two retries and 1s/3s backoff on 403/408/425/429/5xx and network errors; `parseRss`, `fetchFederalRegister` moved here from collect.mjs; new pure parsers `parseCourtListener`, `parseSegalInsights`, `parseMercerSearch`, `parseDasPage`; fetchers; `collectSource(source, kind, window)` dispatch.
- Endpoints found without a browser (all verified live 2026-09-01):
  - CourtListener v4: `GET /api/rest/v4/search/?q=<query>&type=o&court=ca9&order_by=dateFiled desc&filed_after=YYYY-MM-DD`, anonymous OK, paginates via `next`; `COURTLISTENER_TOKEN` sent as `Authorization: Token …` when set. Query in config: `ERISA OR "employee benefit plan" OR "Taft-Hartley" OR "Mental Health Parity"`. Structured fields kept: docket_number, date_filed, cluster_id, court, citation, download_url (opinion PDF).
  - Segal: the compliance-news page's own loader calls `GET https://www.segalco.com/Umbraco/Api/getinsights/getInsights?startNode=1192` (1192 = `#grid[data-cat]` on the page) → JSON list of {Name, Teaser, InsightDate "August 18, 2026", InsightUrl, FooterTags, InsightCat}. 66 items live.
  - Mercer: `/insights/law-and-policy/` and `/health/` are JS-rendered; the page embeds an Elastic App Search endpoint (`data-endpoint-url`, `data-engine-name` prd-mercer-dotcom-glb-en, public read-only `data-api-key`). `POST {endpoint}/api/as/v1/engines/{engine}/search` with `{query:"law and policy", page:{size:100}, sort:[{publication_date:"desc"}]}`; each result's `card.raw` JSON carries `uri`; keep English results whose uri contains `/insights/law-and-policy/`. `publication_date.raw` is epoch ms.
  - DAS/DIR: `das.html` "What's New" table rows `<td class="nowrap">DATE</td><td><a href=…>TITLE</a>`; `DAS_CACMeetings.html` meeting tables where a `Date:` row sets the date for following rows; name falls back to the last h2/h3 heading. `publicworks.html` and `cac.html` yield no dated items (reference pages) and stay configured.
- `spec/sources.yaml`: `collector:` plus parameters on mercer (mercer-search), segal (segal-insights), courtlistener (courtlistener, court, query), ca-das (ca-das). The Mercer search key is the public browser key served to every visitor, noted as not a secret.
- `scripts/lib/sources.mjs`: IMPLEMENTED now lists six collector kinds.
- `scripts/lib/runlog.mjs` (new): `carryFailureCounts(runLog, previous, today)` adds `consecutive_failures` and `silent_since`; `SILENT_AFTER = 3`. collect.mjs reads the previous run log from `${FEED_URL dir}/run-log.json` when FEED_URL is set, else local `data/run-log.json`; emits `::warning title=Source silent::` at ≥3, `Source failed` below that. Run log is now written after counts are computed (first draft wrote it before; caught in the live run).
- `.github/workflows/collate.yml`: copies `data/run-log.json` into `_site/` so the next run can read it from Pages.
- `spec/README-collector.md`: "What it does" and "not yet collected" paragraphs rewritten for the config-driven collector.
- Tests: `tests/collectors.test.mjs` (6 tests over fixtures `tests/fixtures/{courtlistener.json, segal-insights.json, mercer-search.json, das-whats-new.html, cac-meetings.html}`), `tests/runlog.test.mjs` (1). Fixtures are trimmed live responses.
Evidence:
```
$ npm test                       → ℹ tests 16  ℹ pass 16  ℹ fail 0
$ npm run test:sites             → ℹ pass 4  ℹ fail 0
$ npm run build                  → ✓ built; Prepared Sites build; dist/ unchanged in git
$ node scripts/collect.mjs --days 30
ok Mercer Law & Policy Group: 12 / ok Segal Compliance News: 3 / ok Groom: 10 / ok Trucker Huss: 3 / FAIL Wagner: HTTP 403 (after 2 retries) / ok Word on Benefits: 9 / ok Federal Register API: 276 / ok CourtListener API: 2 / ok California DAS / DIR / CAC: 8
323 unique items in window (25 newly stored)
$ node scripts/collect.mjs --days 7 → run-log wagner row: {"ok":false,"error":"HTTP 403","consecutive_failures":1,"silent_since":"2026-09-02"}
```
Decisions taken by default: none reached yet.
Assumptions: the CourtListener query terms stand in for the ca9 charter until scan-match (M3) can judge relevance; the search is deliberately broad and the matcher narrows. Future-dated CAC meeting notices pass the window filter on purpose (a notice is timely before the meeting). Wagner's Cloudflare challenge is not worked around; the silent notice will surface it if it persists.
Follow-ups (left alone):
- IRS and CMS newsrooms (`method: scrape`) still have no collector; not in M2's list.
- Mercer's App Search returns some `solutions/` pages with far-future publication dates; the path-prefix filter drops them, but the epoch-date sort means a bad date could bury real items. Watch in M3 counts.
- `data/run-log.json` rows from before this iteration lack `consecutive_failures`, so Wagner's count restarted at 1 today.
Blocked: nothing.

## Iteration 3 · 2026-09-01 · Milestone M3
Slice: triage stage (normalize + scan match) with live / fixture / record model modes; fixture-mode tests; live run attempted.
Done:
- `@anthropic-ai/sdk` 0.123.0 added (first of the two allowed runtime dependencies).
- `prompts/triage.md` (version 1): intake-reader prompt with the § 6.3 scope rules, "marking nothing in scope is normal," one-sentence checkable reasons, no count language. Loaded by `loadPrompt()`; outputs record `prompt_version: "triage@1"`.
- `scripts/lib/model.mjs`: `createModelClient({mode: live|fixture|record})`. Live calls use `client.messages.create` with `model: claude-opus-5`, `output_config: { effort, format: { type: "json_schema", schema } }`, `system` as text blocks with `cache_control: ephemeral` on the last block, and check `stop_reason` before reading content (refusal → recorded, not retried). Usage totals (input, output, cache read, cache creation, refusals) accumulate per run. Fixture mode replays `tests/fixtures/model/<stage>/<key>.json`; record mode writes them.
- `scripts/lib/triage.mjs`: `matchSchema(scanIds)` (scan_id enum, score, in_scope, reason; additionalProperties false), `buildSystem` (prompt body + five charters, stable for caching), `buildUser` (stored fields only), `decide()` applies `IN_SCOPE_THRESHOLD = 0.6` in code: in scope only when the model says so AND score ≥ 0.6; omission reason is the model's sentence for the closest scan, verbatim; missing scan rows are filled with "no row returned for this scan".
- `scripts/triage.mjs` CLI: one call per document, 4-way concurrency, idempotent per prompt version (`--force` to redo), writes `data/matches/<id>.json` and `data/omitted/<id>.json`, adds a `triage` block (counts per scan, omissions, refusals, usage) to `data/run-log.json` without discarding the collector's rows. `scripts/collect.mjs` now spreads the previous log's other top-level blocks when it rewrites the file.
- Fixtures: `tests/fixtures/collected/` holds five real collected documents (IFEBP PBM explainer, Ninth Circuit Liu v. Kaiser opinion, Groom "Best Lawyers" post, IRS information-collection notice, CAC EEO committee notice). `tests/fixtures/model/triage/triage@1-<id>.json` holds their responses. **These five responses are hand-authored in the model's output shape** (marked `recorded: false` with a note); re-record with `node scripts/triage.mjs --record --in tests/fixtures/collected` once credentials exist.
- `tests/triage.test.mjs` (4 tests): fixture-mode CLI end to end (3 matched / 2 omitted, one row per scan in charter order, in-scope rows above threshold, omission reason verbatim, inputs untouched, per-scan counts in the log); `decide()` threshold and closest-scan reason; schema enum and user-message fields; prompt header and the no-fixture skip path.
Evidence:
```
$ npm test                       → ℹ tests 20  ℹ pass 20  ℹ fail 0
$ npm run test:sites             → ℹ pass 4  ℹ fail 0
$ npm run build                  → Prepared Sites build; dist/ unchanged in git
$ node scripts/triage.mjs --fixture --out <scratch>
omit 035840fb / omit 0ebc9b8c / match 4e4028ec atf / match 58a333d5 fhw / match ab1447e3 ca9
assessed 5: 3 matched, 2 omitted (0 refusals), 0 skipped · per scan: fhw=1 met=0 ca9=1 cyb=0 atf=1
$ node scripts/collect.mjs --days 7   → 80 unique items; Wagner HTTP 403 (consecutive_failures now 2)
```
Live run (acceptance, second half): **not possible in this environment.** `ant` is not installed, `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are unset, and `~/.config/anthropic` does not exist. Attempted anyway so the failure mode is on record:
```
$ node scripts/triage.mjs --limit 1
FAIL  007087b4 Could not resolve authentication method. Expected one of apiKey, authToken, credentials, config, or profile to be set. Or for one of the "X-Api-Key" or "Authorization" headers to be explicitly omitted
assessed 0: 0 matched, 0 omitted (0 refusals), 1 skipped
```
Decisions taken by default: none of the § 14 items are reached by triage.
Assumptions:
- Normalize and match are one model call per document (summary + rows together) rather than two passes; halves the calls and the summary is still never shown to readers.
- Matching runs on the fields the collector stored (title, abstract/teaser/snippet ≤ 600 chars, categories, structured fields), not on fetched full text. Full-text extraction (spec § 6.2 HTML/PDF/email) is not in M3's wording; listed as a follow-up.
- Effort `low` and `claude-opus-5` for triage per goal § 5; no second model until measured.
Follow-ups (left alone):
- Full-text normalization (boilerplate stripping, citation and date extraction) per spec § 6.2 before M4's verify stage needs quotable passages; the supporting passage must be verbatim from the original.
- Once credentials exist: run `node scripts/triage.mjs --record --in tests/fixtures/collected --out <scratch>` to replace the hand-authored fixtures, then `node scripts/triage.mjs` over `data/collected/` (~323 docs) and record per-scan counts here; confirm `cache_read_input_tokens` > 0 on the second call.
- Consider a `triage.yml` step in Actions once a key is stored as a repository secret; not added now because the run would fail without it.
Blocked: live model run needs credentials from Ben — either `ANTHROPIC_API_KEY` in the shell (and as a GitHub Actions secret for later milestones) or `ant auth login` on this machine. Everything else in M3 is done; the milestone's acceptance is half met until that run is recorded.

## Iteration 4 · 2026-09-01 · Milestone M4
Slice: cluster → verify → assess into schema-valid Development candidates, rules enforced in code, fixture-mode tests. Credentials re-checked first: still none (no key, no token, no profile, no `ant`), so M3's live half stays blocked and M4 was built in fixture mode.
Done:
- `scripts/lib/schema.mjs`: zero-dependency JSON Schema validator for the subset `spec/issue-schema.json` uses (type, required, properties, additionalProperties, enum, items, min/maxItems, `$ref` to `#/$defs`). `tests/schema.test.mjs` proves it rejects eight distinct contract violations and accepts a zero-development issue.
- Prompts (all `version: 1`): `prompts/cluster.md` (same development, not same topic; attach to open developments; every id in exactly one cluster), `prompts/verify.md` (status/dates/posture from the supplied primary only; "recognizing a rule is not knowing its status"; unconfirmed when the primary does not state it), `prompts/assess.md` (field rules from spec § 6.6, the closed lists, "quote, don't reproduce" with one complete worked example and rationale, no count language, lower when unsure).
- `scripts/lib/assess.mjs`:
  - `clusterDocuments`: one structured call over the window's in-scope documents plus open developments; documents the model leaves out become their own cluster (nothing dropped); cluster id = hash of sorted member ids.
  - `locatePrimary`: primary-layer members first (Federal Register, CourtListener, California DAS); else Federal Register document numbers or `federalregister.gov/documents/...` links found in commentary → `GET /api/v1/documents/<num>.json` for structured fields; skipped when offline (fixture mode).
  - `verifyCluster`: no primary → `unconfirmed` on all three fields **without a model call**; else a structured verify call; overall result computed in code from the three fields.
  - `assessCluster` + `enforce()`: the spec's rules applied to the model's draft, each violation recorded in `pipeline.defects`: NOW/NEXT need dates confirmed (else WATCH + an uncertainty note); NOW additionally needs a confirmed deadline within 60 days or a confirmed status change (else NEXT); confidence capped by verification (confirmed → High; status-only or commentary → Medium; single unverified source → Low; never raised); passage must be a verbatim substring of one member's stored text (misattribution corrected; non-verbatim replaced by the document's own stored text and flagged); fiduciary tags from the taxonomy, each needing a justification, None exclusive; nextStep from the closed list; cue derived from tier and date.
  - Output = issue-schema development fields + `pipeline` block (cluster, members, verification record, justifications, passage document, operative date, tier rationale, model's original tier/confidence, defects, prompt version, usage, `review_state: pending`).
- `scripts/assess.mjs` CLI: joins `matches/` to `collected/`, applies the 30-day window, runs the three stages, validates every candidate against `spec/issue-schema.json`, writes `candidates/<slug>.json`, `clusters.json`, and an `assess` block in `run-log.json`. `--open issue.json` feeds open developments; `--today` pins the clock for tests. Model failures are reported in one line, not a stack trace.
- Fixtures: `tests/fixtures/matches/` (the three triage fixture outputs); `tests/fixtures/model/cluster/cluster@1-97bd9e7493c67248.json` (three single-document clusters); `verify/verify@1-{3e7725bda2682f14, 662b402a69889a7f}.json` (CAC notice partially confirmed; Liu opinion confirmed); `assess/assess@1-{3e7725…, 9eef35b03baaff53, 662b40…}.json`. The PBM assess fixture deliberately overclaims (NEXT, High, paraphrased passage, unjustified second tag) so the test proves enforcement lowers it. All hand-authored and marked `recorded: false`.
- `tests/assess.test.mjs` (4 tests): fixture CLI end to end with every candidate and a whole assembled issue validating against the schema; tier rule with cases that must fail; confidence rule including never-raise; closed-list rules.
Evidence:
```
$ npm test                       → ℹ tests 25  ℹ pass 25  ℹ fail 0
$ npm run test:sites             → ℹ pass 4  ℹ fail 0
$ npm run build                  → Prepared Sites build; dist/ unchanged in git
$ node scripts/assess.mjs --fixture --out <scratch> --today 2026-09-01
WATCH Medium partially_confirmed  California Apprenticeship Council EEO committee met on August 12 …
WATCH Low    unconfirmed          FTC insulin settlement orders bar PBMs … (4 defects: tier NEXT→WATCH; confidence High→Low; passage replaced; unjustified tag dropped)
WATCH High   confirmed            Ninth Circuit issues published opinion in Liu v. Kaiser …
3 candidates from 3 clusters (0 unassessed): NOW 0 · NEXT 0 · WATCH 3; verification confirmed 1 / partial 1 / unconfirmed 1; 4 rule defects; 0 schema errors
$ node scripts/assess.mjs --matches tests/fixtures/matches --collected tests/fixtures/collected   (live)
FATAL: cluster stage could not call the model: Could not resolve authentication method. Expected one of apiKey, authToken, credentials, config, or profile to be set …
```
Decisions taken by default: § 14 item 1 (taxonomy): the two training-fund tags stay separate as the spec recommends; the attorney gate on Contribution Collection items is a review-stage (M5) concern and is noted there. No other § 14 item is reached by assessment.
Assumptions:
- Verification with no primary authority is decided in code (unconfirmed) rather than asked of the model; the spec says commentary never substitutes for primary verification, so there is nothing for the model to judge.
- "Single-source unverified → Low" is applied when the cluster has one member and no primary; two commentary sources with no primary cap at Medium (spec: "the only source is reputable commentary").
- Passage verbatim check runs against the collector's stored text (title + abstract/teaser/snippet), the same limit noted in M3. Full-text normalization remains the follow-up that will let passages come from the body of a rule or opinion.
- Regulations.gov and CourtListener docket lookups (spec § 6.5) are not implemented in `locatePrimary`; CourtListener opinions arrive as primary members already, and regulations.gov needs an API key Ben would have to provision. Federal Register lookup by document number is implemented.
Follow-ups (left alone):
- Full-text extraction (spec § 6.2) before real passages are quotable from primary documents.
- regulations.gov docket lookup (DEMO_KEY works for testing) and CourtListener docket lookup for watch-list cases.
- Re-record the eleven hand-authored model fixtures (triage 5, cluster 1, verify 2, assess 3) once credentials exist, then re-run the fixture tests; hand-authored content may differ from real model output in ways the enforcement layer will surface as defects.
Blocked: live triage (M3) and live assess (M4) both need credentials from Ben: `ANTHROPIC_API_KEY` exported in the shell that runs the loop, or `ant auth login` on this machine. When present, run in order: `node scripts/triage.mjs` (≈323 docs), then `node scripts/assess.mjs --today <date>`, and record per-scan counts, candidate list, tiers, verification results, and `cache_read_input_tokens` here.
