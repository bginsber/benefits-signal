# Jev as a first-pass classifier: design and recommendation

Status (2026-09-23): **not built, blocked on access.** No `TYPESAFE_API_KEY` is set in the cloud
session or the repository, and the cloud session's network policy blocks `api.typesafe.ai` and
`docs.typesafe.ai`. (The docs were read through a GitHub Actions run instead.) Nothing below has been
run against Jev, so every number it cites is a target, not a measurement.

## What to add to unblock it

1. Create a key at <https://console.typesafe.ai/keys>.
2. Store it as `TYPESAFE_API_KEY`, the variable name the TypeSafe SDKs read. Put it in the shell
   profile on the Mac that runs `scripts/weekly.sh`, and optionally in a repository secret of the same
   name (Settings → Secrets and variables → Actions).
3. For Claude Code cloud sessions, add `api.typesafe.ai` and `docs.typesafe.ai` to the environment's
   allowed domains (environment settings → Network access).

## API facts (from docs.typesafe.ai, read 2026-09-23)

- `POST https://api.typesafe.ai/v1/systemone`, JSON body, API key in the `Authorization` header. Check
  the exact scheme in <https://docs.typesafe.ai/api.md> before writing the client; the Actions log
  masked the header value.
- Body: `{ "state": <string or JSON>, "model": "jev-latest", "questions": { <name>: <question> } }`.
- Question types:
  - `noul`: a yes/no statement. Returns `{ noul: p }`, the probability of yes.
  - `choice`: `criteria` maps each option to a description. Returns `{ choice, confidence, probabilities }`.
  - `score`: `criteria` is an ordered list of levels. Returns `{ score, confidence, legend, probabilities }`.
- Response: `{ model, answers: { <name>: {...} }, usage: { input_tokens, output_tokens } }`. The
  quick-start example returned `jev-1.13.0`.
- Questions in one request are evaluated independently and in parallel. The docs' parallel-questions
  cookbook reports that one batched call is about 12× cheaper and 10× faster than separate calls.

## Where it fits in this pipeline

Today `scripts/triage.mjs` asks Claude for a summary plus one ScanMatch row per scan for every
collected document, and code applies a 0.6 threshold (`scripts/lib/triage.mjs`). Most collected
documents belong to no scan. Jev would run first and settle the clear cases, and Claude would see only
the uncertain ones:

```
collected doc ──► code rules (feed-filter.yaml, source layer, structured dates)
              ──► Jev: one request, ~12 questions
                    ├─ every scan clearly out, or marketing  ──► omitted (reason: which nouls)
                    ├─ scan(s) clearly in, confidence high   ──► matched (scan_ids from Jev)
                    └─ anything in the middle band           ──► existing Claude triage, unchanged
```

Code keeps everything it can already decide: whether the source is primary or commentary (from the
source layer), comment and effective dates (from the Federal Register fields), the housekeeping rules,
and every threshold. Jev results never trigger an external action. They only choose between
omitting, matching, and sending to Claude, and every omission keeps its reason for the recall sample.

## Question set for one document

The state carries only the fields the questions need:

```json
{
  "document": { "source": "…", "title": "…", "date": "2026-09-17", "categories": ["…"], "text": "…collected summary…" },
  "scans": { "fhw": { "charter": "…", "out_of_scope": ["…"] }, "met": { … }, "ca9": { … }, "cyb": { … }, "atf": { … } }
}
```

Every question below goes in the same request.

| name | type | instructions (abridged) |
|---|---|---|
| `in_fhw`, `in_met`, `in_ca9`, `in_cyb`, `in_atf` | noul | "Is `document` clearly covered by `scans.<id>.charter` and not excluded by `scans.<id>.out_of_scope`?" Criteria have `what` / `not_for` / `examples` taken from scans.yaml. These mirror Claude's ScanMatch rows one for one, which makes the comparison direct. |
| `marketing_or_event` | noul | Is it a webinar, event, award, ranking, or firm-news item? |
| `affects_welfare_plans` | noul | Does it bear on group health or welfare plans, as opposed to retirement plans only? |
| `retirement_only` | noul | Is it limited to 401(k), 403(b), or defined-benefit plans with no welfare-plan angle? |
| `multiemployer` | noul | Does it concern jointly trusteed (Taft-Hartley) plans specifically? |
| `imposes_action` | noul | Does it create a new obligation, deadline, or filing for plan sponsors or trustees? |
| `urgency` | choice | `now` / `next` / `watch`, with the definitions from spec § 6.6 as `what` / `not_for`: NOW means a confirmed deadline within about 60 days that calls for a legal decision, or a change in legal status. NEXT means a confirmed date or obligation with no immediate decision. WATCH is everything unresolved. |

`urgency` is advisory at triage time. The assess stage still sets the tier.

Code then combines the answers, with thresholds tuned on the evaluation below:

```js
const hit  = scans.filter((s) => a[`in_${s}`].noul >= HI);               // e.g. HI = 0.85
const miss = scans.every((s) => a[`in_${s}`].noul <= LO);                 // e.g. LO = 0.15
if (a.marketing_or_event.noul >= 0.9 || miss) return omit(reasonFrom(a));
if (hit.length && !scans.some((s) => a[`in_${s}`].noul > LO && a[`in_${s}`].noul < HI)) return match(hit);
return claudeTriage(doc);                                                 // the middle band
```

## Build plan (about half a day once the key exists)

- `scripts/lib/jev.mjs`: `buildQuestions(scans)`, `buildState(doc, scans)`, `decideFromJev(answers, {LO, HI})`,
  and a small fetch client that uses the same live / fixture / record modes as `scripts/lib/model.mjs`, so
  tests replay recorded answers from `tests/fixtures/jev/`. No new dependencies.
- `scripts/triage.mjs --jev`: off by default. Documents Jev settles are written with
  `decided_by: "jev"` and the probabilities attached. The rest go through the existing Claude path.
- Keep Jev out of `.github/workflows/collate.yml`, which publishes the live feed.

## Evaluation plan

Labels: the Claude triage records from the weekly runs (`data/matches/`, `data/omitted/` on the Mac
that runs `scripts/weekly.sh`, and the `benefits-signal-*` workflow artifacts). The repo itself
holds only 5 recorded triage fixtures, which is too few to tune on. The Mac's `data/` is the real set.

Report:

1. Per-scan agreement between Jev's `in_<scan>` (at 0.5) and Claude's `in_scope`: precision,
   recall, and κ.
2. Confidence against accuracy: for noul bands 0–0.1, 0.1–0.2 … 0.9–1.0, the share that agrees with
   Claude. Pick LO and HI so the documents Jev settles on its own agree with Claude at least 97% of
   the time.
3. The share of documents Jev settles, which is the Claude-call saving, and a list of every
   disagreement for a paralegal to adjudicate. Claude is the reference, not ground truth.

## Emails (EBIA Weekly and others)

The same path works once an email becomes documents. Code splits the newsletter into articles
(heading plus body), then each article goes through the same Jev request. The Gmail connector or the
planned dedicated mailbox (spec/sources.yaml, `ebia`) supplies the messages. Splitting stays in code
because it is deterministic.

## Recommendation

Worth a trial, as a first-pass filter in front of Claude triage and not as a replacement for it.
The fit is good: fixed categories, a large majority of clear "out of scope" documents, and a need for
calibrated confidence to decide what a human or Claude should look at. Jev also matches the repo's
existing rule that code, not the model, applies thresholds. Two caveats:

- Jev cannot write the two-sentence summary or the paralegal-readable reason that triage records
  today. Omissions it decides need a reason built from its noul answers, and matches still need a
  summary later (the assess stage already writes one).
- The value depends on the measured agreement. If fewer than about 60% of documents land outside
  the middle band at 97% agreement, the saving is small, and the simpler move is to keep Claude
  alone and lean on the keyword gates in `spec/feed-filter.yaml`.
