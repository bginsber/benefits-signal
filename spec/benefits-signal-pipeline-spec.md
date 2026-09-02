# Benefits Signal — Horizon-Scanning Pipeline Specification

**Version:** 0.1 draft · **Date:** September 1, 2026 · **Author:** Ben Ginsberg (with Claude)
**Status:** For attorney and paralegal review before build begins

---

## 1. Purpose and boundary

This document specifies the backend that replaces the hard-coded developments in the Benefits Signal prototype with a live horizon-scanning pipeline. It does not change the newsletter's reading experience, visual system, or field set. The front end is the contract: every stage below exists to populate a field the prototype already displays, and nothing the pipeline produces should require a new screen.

Two things are added to the prototype's data model, because they are what make the product useful to fund trustees rather than to a general benefits reader:

- A **fiduciary-duty tag** on every development, answering the trustee's actual question — *does this change what I am responsible for, and how?*
- A fifth saved scan, **Apprenticeship & Training Funds**, covering the training-trust and apprenticeship side of the practice that health-and-welfare commentary sources do not cover.

The operating model is unchanged: AI monitoring managed by a paralegal, legal judgment and consequential action controlled by attorneys. The pipeline never sends external messages, edits documents, or creates assignments outside the firm's review queue.

Design constraints inherited from the firm: public sources only, no client or participant data enters the system; software-subscription budget only, no capital spend; the supervising paralegal's time comes from existing duties, so the weekly review burden is capped by design; the firm's mail and files live in Outlook and on-premises storage, so delivery is email plus the hosted newsletter page, not a new system to log into.

---

## 2. Pipeline overview

The pipeline runs as a small scheduled job with eight stages. Each stage writes to a document store and leaves a record the source log can display.

| # | Stage | Input | Output | Human role |
|---|---|---|---|---|
| 1 | Collect | Configured sources (feeds, mailbox, agency APIs) | `SourceDocument` rows | None (paralegal maintains source list) |
| 2 | Normalize | Raw documents | Clean text, extracted dates, citations, links | None |
| 3 | Scan match | Normalized documents | Per-document scan scores, in-scope / out-of-scope decision | None; omissions logged for sampling |
| 4 | Cluster | In-scope documents | `Development` candidates grouping coverage of one underlying event | None |
| 5 | Verify | Candidate + primary-authority documents | Confirmed status, dates, procedural posture, verification record | None |
| 6 | Assess | Verified candidate | Who / What / By when, Now/Next/Watch, tags (plan type, jurisdiction, topic, fiduciary duty), confidence + rationale, supporting passage, suggested next step | None |
| 7 | Review | Assessed candidates | Approved / edited / rejected candidates | **Paralegal** reviews every candidate; **attorney** approves every NOW item and any item with a fiduciary-duty tag of Prohibited Transactions or Loyalty |
| 8 | Publish | Approved candidates | Issue JSON consumed by the front end; email digest; source log | Paralegal releases the issue |

Cadence: collection runs daily; an issue is assembled weekly (Wednesday, matching the prototype). An urgent path exists for a NOW item whose deadline falls within fourteen days of the next scheduled issue — it goes to the reviewer immediately rather than waiting for the weekly assembly. An issue with zero developments is a legitimate output and is published as such ("Nothing requires your attention this week"). The model is never asked to fill a page.

---

## 3. Saved scans

Scans are the organizing system. Each scan has a plain-language charter that the model reads at match time, a list of sources weighted toward it, and the plan types it primarily serves. The four prototype scans are retained; one is added.

### 3.1 Federal Health & Welfare
Federal statutes, regulations, sub-regulatory guidance, reporting and disclosure obligations, and agency developments affecting group health and welfare plans: ERISA Title I, ACA, MHPAEA, COBRA, HIPAA, transparency and No Surprises Act requirements, RxDC and gag-clause attestations, Form 5500, IRS welfare-plan guidance. Primary authorities: DOL/EBSA, IRS, HHS/CMS, Federal Register.

### 3.2 Multiemployer & Taft-Hartley
Issues particular to jointly administered plans: trustee governance and board composition under LMRA § 302, withdrawal-liability-adjacent developments that touch welfare funds, § 515 collection and delinquency law, reciprocity, plan-document and trust-agreement conformity, DOL enforcement priorities for multiemployer plans, PBGC where relevant. Primary authorities: DOL/EBSA, Federal Register, NLRB where governance intersects, federal courts.

### 3.3 California & Ninth Circuit
California statutes, DMHC/CDI action affecting fund arrangements, California Labor Code developments that reach fund operations, and Ninth Circuit and California federal district court litigation on ERISA, MHPAEA, § 515, and fiduciary claims. Primary authorities: Ninth Circuit opinions (via CourtListener), California Legislative Information, DIR/DAS.

### 3.4 Cybersecurity & Privacy
Plan cybersecurity, participant-data privacy, incident-response obligations, service-provider oversight, and the fiduciary framing of all of it: DOL cybersecurity guidance and any rulemaking, HIPAA Security Rule changes as applied to group health plans, state breach-notification law reaching fund administrators, vendor-contract expectations. Primary authorities: DOL/EBSA, HHS OCR, Federal Register, California AG / CPPA where applicable.

### 3.5 Apprenticeship & Training Funds (new)
The training-trust side of the practice: jointly administered training trusts and apprenticeship funds as ERISA welfare plans, and the regulatory web that governs their funding and program operation. Coverage includes DOL Office of Apprenticeship standards and any rulemaking on 29 CFR Parts 29 and 30 (registration, EEO); California Division of Apprenticeship Standards and California Apprenticeship Council actions, including training-contribution rules under the Labor Code; Davis-Bacon and California prevailing-wage treatment of training-fund contributions as fringe benefits; project labor agreement developments that flow into contributions; the ERISA reporting posture of apprenticeship plans (the 29 CFR 2520.104-22 alternative-compliance notice and what it does and does not exempt); IRS treatment of training-fund expenditures; and DOL/ETA funding and WIOA developments that change program economics. Primary authorities: DOL Office of Apprenticeship / ETA, Federal Register, California DAS / DIR / CAC, DOL Wage and Hour Division.

Interpretation-layer sources for this scan are thinner than for health and welfare, which is exactly why the scan is needed. Candidates to configure at launch: IFEBP Word on Benefits (apprenticeship and training-fund posts), the DOL Office of Apprenticeship newsroom, California DAS bulletins, and firm-selected construction-industry counsel blogs. Ben should confirm the final list with the attorneys; the spec deliberately does not assert which outside firms currently publish reliably on this subject.

---

## 4. Source configuration

Sources are stored as records, not hard-coded. Each carries a name, layer (interpretation or primary), collection method, cadence, scan weights, and an active flag. The paralegal can add or retire a source without a code change.

| Source | Layer | Collection method | Notes |
|---|---|---|---|
| EBIA Weekly | Interpretation | Dedicated mailbox (subscription email) | Parse email body; store original for audit |
| Mercer Law & Policy Group | Interpretation | RSS / page fetch | |
| Segal Compliance News | Interpretation | RSS / page fetch | |
| Groom | Interpretation | RSS / page fetch | |
| Trucker Huss Benefits Report | Interpretation | RSS / page fetch or mailbox | |
| Wagner Law Group Law Alerts | Interpretation | RSS / page fetch | Ben already has a study library built from this source |
| Word on Benefits (IFEBP) | Interpretation | RSS | Weighted toward Multiemployer and Apprenticeship scans |
| DOL/EBSA | Primary | Newsroom feed + Federal Register API (agency filter) | Federal Register API supplies comment deadlines and effective dates as structured fields |
| IRS | Primary | Newsroom feed + guidance pages + Federal Register API | |
| HHS / CMS / OCR | Primary | Federal Register API + newsroom | Added for HIPAA, transparency, MHPAEA tri-agency items |
| Ninth Circuit | Primary | CourtListener API (opinion search + docket alerts) | Docket alerts for cases already on the watch list |
| DOL Office of Apprenticeship / ETA | Primary | Federal Register API + newsroom | Apprenticeship scan |
| California DAS / DIR / CAC | Primary | Page fetch (bulletins, meeting notices) | Apprenticeship and California scans |
| regulations.gov | Primary | API, docket lookup on demand | Used at verification time to confirm comment deadlines and docket status |

**Feed verification (2026-09-01).** Every source above was checked against its live surface; the machine-readable configuration lives in `sources.yaml` beside this spec. Findings that change the collection plan: EBIA Weekly has no usable public surface (its public blog went stale in mid-2023) — the subscription email into the dedicated mailbox is the only channel. Mercer has no RSS and is a scrapeable index page; Segal's listing is JavaScript-rendered and needs headless fetching or its underlying JSON endpoint. Groom, Trucker Huss, Wagner, and Word on Benefits all have working RSS feeds (verified fresh). On the primary side, the Federal Register API is confirmed working with structured comment/effective dates and verified agency slugs for EBSA, IRS, ETA, WHD, HHS, and CMS — it is the dependable channel; dol.gov and hhs.gov block plain HTTP clients from datacenter IPs (403), so their newsrooms need a browser-grade fetch path and are treated as best-effort for sub-regulatory announcements. CourtListener's v4 search is confirmed for Ninth Circuit opinions, with docket alerts available behind a free account token. apprenticeship.gov has no newsroom page at all — OA rulemaking is caught via the Federal Register ETA filter, and funding announcements via its investments page. California DAS/DIR/CAC pages are plain HTML and curl-friendly (use the 2026 CAC meetings page, not the stale DASMeetings.html).

Collection is idempotent: a document is keyed by canonical URL (or message ID for email) plus a content hash, so re-runs never duplicate. Every stored document keeps its original form (HTML, email, PDF) alongside extracted text, because the supporting passage shown in the newsletter must be quotable back to the original.

---

## 5. Data model

The model is deliberately small. Field names match the prototype where the prototype has an equivalent, so `App.jsx` can consume the publisher's output without renaming.

**Source** — id, name, layer, method, cadence, scan_weights, active, added_by, added_on.

**SourceDocument** — id, source_id, url, message_id, content_hash, title, published_at, collected_at, raw_blob_ref, text, extracted_dates[], extracted_citations[], extracted_links[].

**ScanMatch** — document_id, scan_id, score, in_scope (bool), reason. One row per document per scan; a document with no in-scope row is an omission and is logged as such.

**Development** — id, headline, tier (`now` | `next` | `watch`), cue, status_line, summary, implication, scan_ids[], plan_types[], jurisdiction, topics[], fiduciary_duties[], confidence (`high` | `medium` | `low`), confidence_rationale, uncertainty_note (nullable; surfaced in the collapsed view only when non-null), who, what, by_when, supporting_passage, supporting_passage_document_id, commentary_link, primary_link, suggested_next_step, member_document_ids[], verification_record_id, review_state, issue_id.

**VerificationRecord** — development_id, primary_document_id, checked_fields (status, dates, posture), result (`confirmed` | `partially_confirmed` | `unconfirmed`), notes, checked_at.

**ReviewDecision** — development_id, reviewer, role (`paralegal` | `attorney`), decision (`approve` | `edit` | `reject` | `defer`), edits (diff of fields changed), note, decided_at.

**Issue** — id, issue_date, summary_line, development_ids[], published_at, released_by.

**SourceLogEntry** — issue_id, source_id, outcome (`verified` | `kept` | `merged` | `omitted`), development_id (nullable), explanation. This is what the "View source log" control renders.

**OmissionSample** — issue_id, document_id, sampled_by, verdict (`correctly_omitted` | `should_have_been_kept`), note. Feeds the recall metric in § 10.

---

## 6. Stage specifications

### 6.1 Collect
A scheduled job (daily, early morning Pacific) pulls each active source by its method. Email sources are read from a dedicated firm mailbox that receives only newsletter subscriptions; nothing else is ever read from Outlook. Fetch failures are logged per source and surface to the paralegal as a "source silent for N days" notice rather than failing the run. Federal Register and CourtListener results are pulled as structured JSON and stored with their native fields (comment_date, effective_date, docket number, date_filed) so verification can use them without re-extraction.

### 6.2 Normalize
Text is extracted from HTML, email, and PDF; boilerplate (navigation, footers, subscription blurbs) is stripped; dates are parsed with the source's timezone; citations (CFR, U.S.C., Federal Register, case citations) and outbound links are extracted. A model pass produces a two-sentence neutral summary of each document, used by the matcher and never shown to readers.

### 6.3 Scan match
For each document, the model reads the five scan charters and returns, per scan, a score and a one-line reason. The threshold for in-scope is conservative; a document that matches nothing is marked omitted with the model's reason recorded verbatim. Omitted documents are never deleted — they are the pool for recall sampling. Scope rules that the charters make explicit: single-employer 401(k)-only developments are out unless a fiduciary principle transfers; pension-only multiemployer items (withdrawal liability, PBGC funding) are out unless the welfare or training fund is affected; marketing content from any source is out.

### 6.4 Cluster
In-scope documents from the current window plus the trailing thirty days are grouped by underlying event. The model is asked whether two documents describe the same legal development (same rule, same case, same deadline), not merely the same topic. A cluster may attach to an existing open `Development` (a WATCH item that just moved) instead of creating a new one. This is how a development's tier changes over time without the newsletter republishing it as new.

### 6.5 Verify
For each cluster, the pipeline locates primary authority: first among already-collected primary documents in the cluster, then by targeted lookup (Federal Register document number, regulations.gov docket, CourtListener docket or opinion, IRS guidance number). The model compares the commentary's stated status and dates to the primary text and records `confirmed`, `partially_confirmed`, or `unconfirmed` per field. A development with an unconfirmed deadline cannot be assigned to NEXT; it stays in WATCH with an uncertainty note until the deadline is confirmed or the reviewer overrides. Commentary never substitutes for primary verification where primary material exists; where it does not (a firm's report of an informal agency statement, for example), the confidence rationale must say so.

### 6.6 Assess
The model produces the full `Development` record from the cluster and verification record, using a structured output schema. Rules embedded in the prompt:

- **Who / What / By when** are written for a trustee reader, in plain language, and each must be traceable to the supporting passage or primary text.
- **Tier**: NOW requires either a confirmed deadline within roughly 60 days that calls for a legal decision, or a change in legal status that requires attorney review regardless of date. NEXT requires a confirmed date or obligation and no immediate attorney decision. WATCH is everything unresolved. When uncertain between tiers, choose the lower one and explain; the reviewer can raise it.
- **Fiduciary-duty tags** (§ 7) are assigned from the taxonomy with a one-line justification each; "None — settlor or administrative" is a valid and expected answer.
- **Confidence** reflects verification, not the model's fluency: High requires a confirmed primary source for status and dates; Medium means primary confirms status but not dates, or the only source is reputable commentary; Low is reserved for single-source, unverified items and normally keeps an item out of the issue.
- **Uncertainty note** is populated only when the uncertainty changes how the reader should act (an unset briefing schedule, a stayed rule, a split in authority).
- **Suggested next step** is chosen from a closed list (§ 8) — the model does not invent actions.
- **Supporting passage** is a verbatim quotation with its document reference, at most a short paragraph.

### 6.7 Review
The review queue is a simple page in the same design system as the newsletter (or, in Phase 1, a generated markdown or email digest). The paralegal sees each candidate exactly as it will render in the newsletter, plus the assessment's justifications, the verification record, and the cluster members. Actions: approve, edit any field (edits are stored as a diff and used for prompt tuning), reject with reason, or defer to next issue. Attorney gate: every NOW item, and any item tagged Prohibited Transactions & Expense Reasonableness or Loyalty & Exclusive Benefit, requires an attorney approval before publication. Attorneys receive only the items gated to them, with a one-click approve/return, so the gate costs minutes, not a meeting.

### 6.8 Publish
Approved developments are assembled into an `Issue`. The publisher writes an issue JSON file in the exact shape the front end consumes today, regenerates the source log, and produces an email digest in the same Now/Next/Watch order with the collapsed-view fields only and a link to the hosted issue. The email goes to the four readers from the firm's own domain via the mail system the firm already uses; the pipeline never emails outside the firm. Past issues remain browsable; developments carried forward from a previous issue are marked as such in the expanded view rather than presented as new.

---

## 7. Fiduciary-duty tag taxonomy

Each development carries zero or more of the following tags. The tag appears in the expanded article's metadata alongside plan type, jurisdiction, and topics, and is the primary filter for a future "trustee agenda" view. Definitions are written so the model and the reviewer apply them the same way.

| Tag | ERISA / trust-law anchor | Assign when the development… |
|---|---|---|
| Prudence & Process | § 404(a)(1)(B) | Changes what a prudent trustee must do, document, or ask — vendor selection and monitoring, cybersecurity program adequacy, use of experts, meeting-minute expectations, investment-adjacent process for reserves |
| Loyalty & Exclusive Benefit | § 404(a)(1)(A); LMRA § 302 | Bears on whose interest a decision serves — conflicts of interest, union or employer-side pressures on fund decisions, structural-benefit questions |
| Plan Document & Trust Conformity | § 404(a)(1)(D); § 402 | Requires or invites amendment of the plan document, trust agreement, SPD, or written procedures; changes what "following the documents" means |
| Reporting & Disclosure | Title I Part 1; ACA § 6055/6056; MHPAEA comparative analysis; transparency and gag-clause rules | Creates, changes, or sets a deadline for a filing, notice, attestation, or participant disclosure |
| Prohibited Transactions & Expense Reasonableness | §§ 406, 408; 408(b)(2) | Affects service-provider compensation, party-in-interest dealings, fee disclosure, or the reasonableness standard for plan expenses |
| Co-Fiduciary, Delegation & Bonding | §§ 405, 412; trust agreement allocation clauses | Affects how trustees allocate duties, appoint and oversee delegates, or satisfy bonding and insurance expectations |
| Claims & Appeals Procedure | § 503; MHPAEA; No Surprises Act IDR | Changes claims-handling, appeal, external-review, or benefit-determination standards and the litigation standard of review that follows |
| Contribution Collection & Delinquency | § 515; § 502(g); trust-agreement collection policies | Affects trustees' duty to collect contributions — audit rights, delinquency remedies, PLA and prevailing-wage contribution flows, covered-work disputes |
| Program & Funding Compliance (training funds) | 29 CFR Parts 29–30; Cal. Labor Code apprenticeship provisions; Davis-Bacon / state prevailing-wage fringe rules | Affects registered-program standards, training-contribution obligations, or the regulatory status of the training fund itself |
| None — Settlor or Administrative | — | Is a plan-design (settlor) choice or a pure administrative mechanic with no change to trustee responsibility. Recorded so the absence of a tag is a decision, not an omission |

Application notes for the model and reviewer: a development can and often should carry two tags (the DOL cybersecurity proposal is Prudence & Process plus Plan Document & Trust Conformity if it implies written-program changes). Tags describe what the development does to the duty, not the topic; MHPAEA litigation about the standard of review is Claims & Appeals, not Reporting & Disclosure. When the model cannot articulate a one-line justification, it assigns "None" and the reviewer decides.

Plan-type values remain those the prototype uses, extended for the new scan: Multiemployer health & welfare; Single-employer health & welfare; Training trust / apprenticeship fund; Service providers; All welfare plans.

---

## 8. Suggested next steps (closed list)

The model selects from this list; selecting a step in the newsletter changes the button to "Prepared" and creates an internal review-queue entry only.

- Prepare an internal research assignment (attorney review of scope and question)
- Add the deadline to the review queue (paralegal calendar entry with owner to be confirmed)
- Create a monitoring follow-up (re-check on a date or on a docket event)
- Flag for the next trustees' meeting agenda (attorney decides whether and how to present)
- Request service-provider confirmation (draft internal note for attorney to send or not)
- No action — informational

---

## 9. Model and prompt architecture

One model family is used throughout, with stage-specific prompts and strict structured output. Each prompt receives the relevant scan charters, the fiduciary-duty taxonomy, the closed next-step list, and — for assessment — the verification record. Prompts are versioned in the repository; every `Development` records the prompt version that produced it so reviewer edits can be compared across versions.

Cost is bounded by volume: at roughly 100–200 documents per week across all sources, the normalize, match, cluster, verify, and assess passes together fit comfortably in a modest monthly API budget. The pipeline uses a cheaper model for normalization and matching and the strongest available model for verification and assessment, where the reasoning matters.

The model never has tools that reach outside the document store and the public primary-authority APIs. It cannot send email, write to the firm's file system, or read anything but the configured sources.

---

## 10. Quality control and evaluation

Precision is the primary metric; the newsletter's credibility with two attorneys depends on it. Targets and mechanics:

- **Precision.** Share of published developments the reviewers accepted without substantive edit. Tracked per issue from `ReviewDecision`. A rejected NOW item is investigated the same week.
- **Recall sampling.** Each week the paralegal samples ten omitted documents (stratified: some from each scan's near-threshold band, some random) and records a verdict. A "should have been kept" verdict adjusts the scan charter or threshold, and the finding is noted in the next source log.
- **Verification rate.** Share of published developments with a `confirmed` primary record. Anything below full confirmation for NEXT items is a defect.
- **Calibration.** Confidence labels are compared against reviewer outcomes quarterly; if Medium items are being accepted at the same rate as High, the rubric is tightened.
- **Edit capture.** Every reviewer edit is a labeled example. After the first month, a small held-out set of past clusters is re-run against any prompt change before it ships.
- **Noise budget.** An issue targets three to five developments. The paralegal may publish fewer, including zero. The model is never prompted toward a count.

---

## 11. Governance, ethics, and data handling

The system processes public regulatory and commentary material only. No participant, employer, or client data is ingested, and the dedicated collection mailbox receives subscriptions only. Model outputs are labeled as AI-generated within the review queue; the published newsletter states that developments are AI-assisted and reviewed by the firm. Attorney sign-off on NOW items and on the two gated fiduciary tags is recorded, satisfying the supervision expectations in the firm's draft AI governance policy and the professional-responsibility guidance Ben has been tracking. Source documents are retained for the life of the development plus a fixed period (proposed: two years) so that any published statement can be traced to its evidence.

---

## 12. Technical approach and stack

Kept minimal and within a subscription-only budget. The prototype already includes a static-site worker and hosting configuration; the pipeline is added beside it, not under it.

- **Runtime:** a single scheduled job (GitHub Actions on a cron, or an equivalent hosted scheduler) running a Node or Python script. No always-on server is required.
- **Store:** a hosted Postgres free/low tier (or SQLite committed to a private repository for Phase 0). Raw documents in object storage or the same repository.
- **Model access:** Claude API with structured outputs; prompts versioned in-repo.
- **Primary-authority access:** Federal Register API, regulations.gov API, CourtListener API (opinion search and docket alerts for the Ninth Circuit), agency RSS/newsroom feeds.
- **Review queue:** Phase 1 as a generated markdown or email digest with reply-by-form; Phase 2 as a small page in the newsletter's design system, auth-gated to the four readers.
- **Publish target:** the existing front end reads an issue JSON; email digest sent through the firm's existing mail.

---

## 13. Phasing

**Phase 0 — Collect and store (two to three weeks).** Configure all sources, run daily collection, confirm every source is actually reachable and parseable, and build the omitted-document pool. No model calls yet beyond normalization. Exit criterion: two consecutive weeks of clean collection across all sources.

**Phase 1 — Triage with manual review (three to four weeks).** Enable scan match, cluster, verify, and assess. The paralegal receives a weekly candidate digest and reviews it by hand; nothing is published to the front end. Exit criterion: reviewer acceptance of candidates at a rate the attorneys are comfortable with, and the first recall-sampling results recorded.

**Phase 2 — Publish to Benefits Signal (two weeks).** The publisher writes issue JSON into the front end and generates the source log from real records. The first live issue replaces the illustrative August 26 issue. Exit criterion: one live issue released by the paralegal with attorney sign-off on any NOW item.

**Phase 3 — Email digest, open-development tracking, trustee-agenda view (ongoing).** Weekly email delivery; developments that carry across issues are tracked rather than republished; a filter on the fiduciary-duty tag produces a trustees'-meeting handout the attorneys can choose to use.

Deferred, deliberately: natural-language questions against stored sources (useful, but only after the store is trustworthy); any automated drafting of external communications; any integration with the firm's document storage.

---

## 14. Decisions for the attorneys — recommended positions

Items 1, 4, and 5 are presented as defaults the attorneys may veto; meeting time should go to 2 and 3, which need their reading habits and their explicit buy-in respectively.

**1. Taxonomy (recommended default: keep two tags; gate § 515 items).** Contribution Collection & Delinquency and Program & Funding Compliance stay separate — collection is the duty to pursue money owed, program compliance is the training fund's own regulatory standing; merging them would ruin the tag as a trustees'-agenda filter. The attorney gate extends to Contribution Collection items: with covered-work disputes in active litigation, a published development in that area is effectively a statement about live matters, and the gate costs one click.

**2. Apprenticeship sources (discuss — needs the attorneys' judgment).** Recommended launch set: Word on Benefits filtered to apprenticeship/training posts, DOL Office of Apprenticeship / ETA (via the Federal Register API — see § 4 note), California DAS/CAC bulletins and meeting notices, plus one or two construction-industry counsel blogs the attorneys already trust. Do not pad the list to make the scan feel covered; the recall-sampling loop (§ 10) is the principled way to discover missing sources.

**3. NOW gating (discuss — needs the attorneys' buy-in).** Recommended: attorney approval on every NOW item, at least through the first quarter. The notify-only variant saves almost nothing (zero to one NOW items expected per issue) and spends the trust the pilot most needs; the gate also creates the supervision record the firm's AI governance policy contemplates. If the gate delays urgent items, fix the urgent path's timing, not the gate.

**4. Cadence (recommended default: Wednesday issue; urgent path with a runway rule).** Wednesday keeps the prototype's convention and captures early-week agency activity. The urgent threshold is measured from when the reviewer would otherwise see the item, not from the deadline alone: any item where waiting for Wednesday consumes more than a third of the remaining runway goes to the reviewer immediately (fourteen days remains the outer trigger).

**5. Retention (recommended default: three years, with an open-development exception).** Three years aligns with DOL audit lookbacks and ERISA § 413's three-year actual-knowledge limitations period; storage cost at this volume is trivial. A source document tied to a still-open development is never purged regardless of age.
