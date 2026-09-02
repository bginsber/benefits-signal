# Horizon-scanning loop ledger

Companion to `spec/horizon-scanning-goal.md`. The loop appends one entry per iteration. Nothing above the first iteration entry is edited by the loop except the milestone table.

## Milestone status

| Milestone | Status | Last verified |
|---|---|---|
| M1 · Scans and sources become data | done | iteration 1, 2026-09-01 |
| M2 · Close the source gaps | done | iteration 2, 2026-09-01 |
| M3 · Normalize and scan-match | built; live run blocked on credentials | iteration 3, 2026-09-01 |
| M4 · Cluster, verify, assess | built; live run blocked on credentials | iteration 4, 2026-09-01 |
| M5 · Weekly candidate digest | done (fixture); workflow disabled pending secret | iteration 5, 2026-09-01 |
| M6 · Front end reads data | done | iteration 6, 2026-09-01 |
| M7 · Obligations and trustee agenda | done | iteration 7, 2026-09-01 |

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

## Iteration 5 · 2026-09-01 · Milestone M5
Slice: weekly candidate digest, review template, review feed, weekly workflow (disabled). Credentials re-checked: still none.
Done:
- `scripts/lib/digest.mjs`: `renderMarkdown` / `renderHtml` render each candidate in the newsletter's own order (lane · cue, headline, status, summary, uncertainty, then the disclosure: Who / What / By when, Matched scan, metadata pills, Merged evidence, Confidence rationale, Supporting passage, Links, Suggested next step with the "Nothing is sent or changed automatically" line), followed by reviewer notes never shown to readers: attorney-gate status and reason, tier with the model's original tier when a rule lowered it, confidence likewise, fiduciary-duty justifications, the verification record with primary link and notes, cluster label and why-same, every merged document with link and the passage source marked, every rule correction, prompt version. `needsAttorney()`: NOW items, plus Prohibited Transactions, Loyalty, and (spec § 14 item 1 default) Contribution Collection tags. `buildReviewTemplate()`: one paralegal row per candidate and an attorney row where gated, in the `ReviewDecision` shape (development_id, reviewer, role, decision, edits, note, decided_at), keeping decisions already filled in. `renderReviewFeed()`: RSS 2.0, one item per digest, full HTML digest in the description. `nextIssueDate()`: next Wednesday. Zero candidates renders "Nothing requires your attention this week."
- `scripts/digest.mjs` CLI: `--fixture` reads `tests/fixtures/candidates/` (the three M4 fixture outputs, now committed); writes `data/digests/<issue>.md` and `.html`, `data/reviews/<issue>.json`, a candidate snapshot under `data/digests/<issue>/` so older digests re-render, and `_site/review.xml`. `--trustee-agenda` filters to candidates with a fiduciary tag other than None (M7 will build on it). `FEED_URL` makes the feed and digest links absolute on Pages.
- `.github/workflows/triage.yml` (new, **disabled**: `workflow_dispatch` only, schedule commented with instructions): npm ci → collect → triage → assess → digest → copy digests → deploy `_site/` (collated.xml, run-log.json, review.xml, digests/) → also uploads matches/omitted/candidates/digests/reviews as a 90-day workflow artifact. Needs the `ANTHROPIC_API_KEY` repository secret; `COURTLISTENER_TOKEN` optional.
- `.github/workflows/collate.yml`: the daily deploy now fetches the current `review.xml` and the digests it links from Pages before deploying, so the weekly review feed survives the daily site replacement. Index page lists both feeds.
- `tests/digest.test.mjs` (3 tests): fixture CLI end to end (field order asserted marker by marker; corrections visible to the reviewer; review template rows; feed parses as RSS with one item carrying the full HTML); zero-candidate week; attorney-gate rows, decision preservation, summary line, next-Wednesday rule.
Evidence:
```
$ npm test                       → ℹ tests 28  ℹ pass 28  ℹ fail 0
$ npm run test:sites             → ℹ pass 4  ℹ fail 0
$ npm run build                  → Prepared Sites build; dist/ unchanged in git
$ node scripts/digest.mjs --fixture --out <scratch> --issue 2026-09-02
digest for the issue of 2026-09-02: 3 candidate(s) — Three candidate developments for review.
  digests/2026-09-02.md · reviews/2026-09-02.json (0 NOW; attorney rows where gated) · review.xml (1 item)
$ node scripts/collect.mjs --days 7
::warning title=Source silent::Wagner Law Group Law Alerts has failed 3 consecutive runs (since 2026-09-02): HTTP 403   ← first firing of the M2 notice
```
Sample review file (fixture run, `data/reviews/2026-09-02.json`): three rows, all `role: paralegal`, `decision: ""`, `decided_at: null`; no attorney rows because none of the three fixture candidates is NOW or carries a gated tag. The unit test covers the gated shape (`a:paralegal, a:attorney, b:paralegal, b:attorney, c:paralegal`).
Decisions taken by default: § 14 item 1's second half applied — Contribution Collection & Delinquency items require attorney approval alongside the two tags spec § 6.7 names. § 14 item 3 (attorney approval on every NOW item) applied as the spec recommends. § 14 item 4 (Wednesday issue): `nextIssueDate()` follows it; the urgent path (runway rule) is not built.
Assumptions:
- Phase 1 delivery is the review feed in Outlook plus the Markdown file; the Phase 2 auth-gated review page is not built.
- The weekly workflow deploys to Pages itself rather than handing off to the daily job, because both use the same Pages concurrency group and the daily job now carries the review feed forward.
- Recall sampling (spec § 10: ten omitted documents per week) is not part of M5's wording and is left as a follow-up; the digest reports the omitted count so the pool is visible.
Follow-ups (left alone):
- Recall-sampling section in the digest with `OmissionSample` rows in the review file.
- Urgent path (spec § 2 / § 14 item 4): a NOW item whose runway would be consumed by waiting for Wednesday should reach the reviewer immediately.
- A test fixture failure taught that `parseRss` truncates descriptions at 600 characters; fine for the collated feed, but the review feed relies on Outlook reading the full description, which it does.
Blocked: live triage/assess still need credentials (M3, M4). The weekly workflow additionally needs the `ANTHROPIC_API_KEY` repository secret before Ben uncomments its schedule.

## Iteration 6 · 2026-09-01 · Milestone M6
Slice: front end reads issue.json; publisher builds it from approved candidates and the review file; source log from records; empty and carried-forward issues render. Credentials re-checked: still none.
Done:
- `public/issue.json`: the illustrative August 26 issue extracted verbatim from `src/App.jsx` (three developments, ten source-log rows) into the `spec/issue-schema.json` shape, validated with zero errors. Each development gained the schema-required `Fiduciary duties` metadata (cybersecurity → Prudence & Process, Plan Document & Trust Conformity; ACA reporting → Reporting & Disclosure; MHPAEA en banc → Claims & Appeals Procedure).
- `src/Issue.jsx`: the existing markup moved unchanged into a pure `Issue({ issue })` component; masthead date and summary, the development list, and the source-log table now read from the prop. One addition inside the opened briefing only: a "Status" row reading "Carried forward from a previous issue; updated here rather than presented as new." rendered when `carriedForward` is true.
- `src/App.jsx`: fetches `${BASE_URL}issue.json`, renders `Issue` when it arrives, nothing while loading, and a quiet masthead-only message if the fetch fails.
- `scripts/lib/publish.mjs` + `scripts/publish.mjs`: `releaseDecision` (paralegal approve/edit releases; NOW items and gated tags also need an attorney approve/edit row; reject/defer/blank exclude), `applyEdits` (schema fields only, metadata merged key by key), `carriedForward` when the id appeared in `--previous`, `readerSummaryLine` ("Two developments worth your time. One needs a legal read." / "Nothing requires your attention this week."), and `buildSourceLog` from records: Verified (primary + verification result), Kept (lead document), Merged (other cluster members), Omitted (rejected candidates with the reviewer's note; the omitted pool summarised one row per source with the closest reason). The CLI validates against the schema, refuses to write on errors, writes `public/issue.json`, and archives to `data/issues/<date>.json`.
- Fixtures: `tests/fixtures/reviews/2026-09-02.json` (approve Liu, edit CAC's timing and Topics, reject PBM with a note) and `tests/fixtures/issues/2026-08-26.json` (a prior issue containing Liu, so it carries forward).
- `tests/publish.test.mjs` (2 tests): bundles `src/Issue.jsx` with esbuild (already a Vite dependency) and renders with `react-dom/server`: the empty issue shows "Nothing requires your attention this week." with no `<article>`, and the carried-forward development is labeled exactly once; edits applied, rejected excluded, `pipeline` never reaches the front end, source-log results in order; release rules and edit merging unit-tested.
- Visual check (vite preview + browser): the scan view is pixel-for-pixel the committed reference `qa-implementation-top.png` (masthead, date, summary line, NOW item). Inside the opened briefing the only difference is the Fiduciary duties pill row, in the existing pill style. CSS bundle hash unchanged (`index-BzS8h8ew.css`); JS bundle and `index.html` changed as expected; `dist/client/issue.json` now ships with the app.
Evidence:
```
$ npm test                       → ℹ tests 30  ℹ pass 30  ℹ fail 0
$ npm run test:sites             → ℹ pass 4  ℹ fail 0
$ npm run build                  → ✓ built; Prepared Sites build; dist/client has assets/, index.html, issue.json
$ node scripts/publish.mjs --fixture --issue 2026-09-02 --previous tests/fixtures/issues/2026-08-26.json
issue of Wednesday, September 2, 2026: Two developments worth your time.
  WATCH California Apprenticeship Council EEO committee met … (edit applied)
  WATCH Ninth Circuit issues published opinion in Liu v. Kaiser … (carried forward)
  ----  not released: FTC insulin settlement orders … (paralegal reject)
  source log: 5 rows (Verified, Kept, Verified, Kept, Omitted)
$ node scripts/publish.mjs --fixture --issue 2026-09-09 --review <missing>   → "Nothing requires your attention this week." · 0 developments · 3 Omitted rows
```
Decisions taken by default: none new. (Attorney gate on NOW items and the three gated tags, from M5, is now enforced at release time as well.)
Assumptions:
- "No visual change to any existing screen" is read as: the scan view and every existing element are unchanged; the schema-required Fiduciary duties row appears inside the opened briefing because the schema states that is the intended, front-end-free path for the tag. If Ben would rather hide it until Phase 3, delete the key from `public/issue.json`'s three developments and the row disappears (the schema would then need the key made optional).
- The reader-facing summary line is generated ("N developments worth your time. One needs a legal read.") rather than written by the model, so the count is never something the model is prompted toward.
- The paralegal "releases" by running `node scripts/publish.mjs --issue <date>` and pushing `public/issue.json`; no auth-gated page exists (Phase 2 in the spec).
Follow-ups (left alone):
- `spec/README-collector.md` and `AGENTS.md` do not yet describe the publish step; a short "how an issue is released" paragraph belongs in the README when the loop finishes.
- The source log's omitted-pool rows depend on `data/omitted/` from a live triage run; until credentials exist those rows come only from rejected candidates.
Blocked: live triage/assess (M3, M4) still need credentials; the weekly workflow needs the repository secret.

## Iteration 7 · 2026-09-01 · Milestone M7
Slice: upcoming-obligations list in issue.json and one disclosure on the page; trustee-agenda handout. Credentials re-checked: still none.
Done:
- `spec/issue-schema.json`: optional top-level `obligations` array with a new `$defs.obligation` (date, kind ∈ comment_deadline | effective_date | deadline | meeting | filing, label, source, url, optional developmentId, confirmed).
- `scripts/lib/publish.mjs` `buildObligations()`: released developments contribute their `operative_date` only when the verification record has `dates: confirmed` (kind inferred from the primary document's structured field); scan-matched Federal Register documents contribute `comments_close_on` and `effective_on`; dates before the issue date are dropped; deduped by date+url+kind (the development row wins); ascending. `buildIssue` now takes `matches`; the CLI reads `--matches` (default `data/matches`, fixture `tests/fixtures/matches`).
- `src/Issue.jsx`: one `<details class="briefing-disclosure obligations-disclosure">` at the foot of the reading column, before the footer, rendered only when there is at least one obligation; inside, a `<dl>` of long-form date → linked label → source. `src/styles.css`: five small rules reusing the existing rule colour, tabular numerals, and the same summary styling; no new colours, buttons, or panels.
- `public/issue.json`: two obligations the illustrative developments imply (September 30, 2026: cybersecurity comment deadline; ACA Forms 1094/1095 filing) so the disclosure is visible on the prototype.
- `scripts/lib/digest.mjs` `trusteeAgendaItems()` / `renderTrusteeAgenda()`; `scripts/digest.mjs --trustee-agenda` now writes `data/digests/<issue>-trustee-agenda.md` only (no reviewer notes, no review template, no feed change) instead of filtering the main digest in place, which the M5 draft did.
- Fixtures: `tests/fixtures/obligations/{collected,matches}/` = the M3/M4 fixtures plus one real IRS proposed rule (document 2026-16314, comments close 2026-09-25) with a hand-written fhw match record.
- `tests/obligations.test.mjs` (3 tests): publisher output validates and carries exactly the one future obligation (the two released developments' dates precede the issue date); the page renders exactly one disclosure with the dated list before the footer and none when empty; `buildObligations` rule cases (confirmed vs unconfirmed, past dates, dedupe, sort); trustee-agenda filter and handout content via both the library and the CLI.
- Screenshots (vite preview, 1568×783): `design-qa/obligations-closed.jpg` and `design-qa/obligations-open.jpg`. Closed: a single underlined "Upcoming obligations" summary between the last development and the footer rule, in the same style as "Read briefing and evidence". Open: two dated rows in the reading column, links in the existing link style, source in muted text. **Nothing appears outside the reading column; no dashboard chrome, counts, or charts.**
Evidence:
```
$ npm test                       → ℹ tests 33  ℹ pass 33  ℹ fail 0
$ npm run test:sites             → ℹ pass 4  ℹ fail 0
$ npm run build                  → ✓ built; Prepared Sites build (CSS and JS bundle hashes changed as expected)
$ node scripts/publish.mjs --fixture --issue 2026-09-02 --collected tests/fixtures/obligations/collected --matches tests/fixtures/obligations/matches …
  obligations: 1 dated item(s)  → 2026-09-25 comment_deadline "Comments due: Employer Contributions to Trump Accounts … (Proposed Rule, Federal Health & Welfare)"
$ node scripts/digest.mjs --fixture --issue 2026-09-02 --trustee-agenda
trustee agenda for the issue of 2026-09-02: 3 of 3 candidate(s) touch a fiduciary duty → digests/2026-09-02-trustee-agenda.md
```
Decisions taken by default: none new.
Assumptions:
- "Open developments" for the obligations list means the developments released in this issue; developments from earlier issues that are not carried forward are not tracked separately (spec Phase 3 "open-development tracking" is beyond M7's wording).
- The illustrative issue's two obligations are hand-written to match its hard-coded developments; a published issue derives them from records.
Follow-ups (left alone):
- Open-development tracking across issues (a development that leaves the issue but still has a future date).
- The handout is Markdown only; an HTML or DOCX version for the attorneys would be a small addition once they say how they want it.
Blocked: nothing for M7. **Loop status:** M1, M2, M5, M6, M7 are complete. M3 and M4 are built and tested but each has an acceptance half that requires a live model run, which needs credentials this machine does not have. The completion promise is therefore not true. Until `ANTHROPIC_API_KEY` is exported (or `ant auth login` is run) in the environment running this loop, each further iteration can only re-check credentials and end; when credentials appear, the next iteration runs `node scripts/triage.mjs` over `data/collected/`, then `node scripts/assess.mjs`, records the counts here, re-records the eleven hand-authored fixtures with `--record`, and re-runs the suite.

## Iteration 8 · 2026-09-01 · waiting on credentials
Slice: credential re-check only. `ANTHROPIC_API_KEY` unset, `ANTHROPIC_AUTH_TOKEN` unset, no `~/.config/anthropic`, no `ant` binary. No milestone can advance: M1, M2, M5, M6, M7 are done; M3 and M4 need a live model run. Nothing changed in the repo this iteration.
Blocked: credentials from Ben. To unblock, in the shell that runs this loop: `export ANTHROPIC_API_KEY=...` (or install the `ant` CLI and run `ant auth login`), then let the next iteration run. For the weekly workflow, add the same key as the `ANTHROPIC_API_KEY` repository secret and uncomment the schedule in `.github/workflows/triage.yml`.

## Iteration 9 · 2026-09-01 · waiting on credentials
Same check as iteration 8; no key, token, profile, or `ant`. No change. Blocked on credentials from Ben (see iteration 8 for the exact steps).

## Iteration 10 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 11 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 12 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 13 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 14 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 15 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 16 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 17 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 18 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 19 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 20 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 21 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 22 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 23 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 24 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 25 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 26 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 27 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 28 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 29 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 30 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 31 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 32 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 33 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.

## Iteration 34 · 2026-09-01 · waiting on credentials
Same check; nothing present. No change. Blocked on credentials from Ben.
