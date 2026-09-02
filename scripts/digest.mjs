#!/usr/bin/env node
/**
 * Benefits Signal — weekly candidate digest (spec § 6.7, Phase 1)
 *
 * Renders the assessed candidates for the paralegal and writes:
 *
 *   data/digests/<issue>.md      — the digest, Markdown, for the record
 *   data/digests/<issue>.html    — the same digest as HTML (feed body)
 *   data/reviews/<issue>.json    — ReviewDecision template to fill by hand (existing decisions kept)
 *   _site/review.xml             — RSS 2.0 review feed, one item per digest, for Outlook
 *
 * Usage:
 *   node scripts/digest.mjs                        # data/candidates → data/digests, _site/review.xml
 *   node scripts/digest.mjs --fixture              # tests/fixtures/candidates → same outputs under --out
 *   options: --candidates <dir> --collected <dir> --out <dir> --feed <file> --issue YYYY-MM-DD --trustee-agenda
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/sources.mjs";
import { readCollected } from "./lib/triage.mjs";
import { buildReviewTemplate, issueSummaryLine, nextIssueDate, readCandidates, renderHtml, renderMarkdown, renderReviewFeed } from "./lib/digest.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);

const fixture = flag("--fixture");
const CANDIDATES = path.resolve(ROOT, opt("--candidates", fixture ? "tests/fixtures/candidates" : "data/candidates"));
const COLLECTED = path.resolve(ROOT, opt("--collected", fixture ? "tests/fixtures/collected" : "data/collected"));
const OUT = path.resolve(ROOT, opt("--out", "data"));
const FEED = path.resolve(ROOT, opt("--feed", path.join(path.relative(ROOT, OUT) === "data" ? "_site" : path.relative(ROOT, OUT), "review.xml")));
const ISSUE = opt("--issue", nextIssueDate());
const FEED_URL = process.env.FEED_URL ? new URL("review.xml", process.env.FEED_URL).href : undefined;
const DIGEST_URL = process.env.FEED_URL ? new URL(`digests/${ISSUE}.html`, process.env.FEED_URL).href : `file://${path.join(OUT, "digests", `${ISSUE}.html`)}`;

let candidates = await readCandidates(CANDIDATES);
if (flag("--trustee-agenda")) candidates = candidates.filter((c) => (c.metadata?.["Fiduciary duties"] ?? []).some((t) => t !== "None — Settlor or Administrative"));
let docsById = new Map();
try { docsById = new Map((await readCollected(COLLECTED)).map((d) => [d.id, d])); } catch { /* no collected docs available */ }
let omittedCount = null;
try { omittedCount = (await readdir(path.join(OUT, "omitted"))).filter((f) => f.endsWith(".json")).length; } catch { /* none */ }

const digestsDir = path.join(OUT, "digests");
const reviewsDir = path.join(OUT, "reviews");
await mkdir(digestsDir, { recursive: true });
await mkdir(reviewsDir, { recursive: true });

const opts = { docsById, omittedCount };
const md = renderMarkdown(ISSUE, candidates, opts);
const html = renderHtml(ISSUE, candidates, opts);
await writeFile(path.join(digestsDir, `${ISSUE}.md`), md);
await writeFile(path.join(digestsDir, `${ISSUE}.html`), `<!doctype html><meta charset="utf-8"><title>Benefits Signal review — ${ISSUE}</title>\n${html}\n`);

const reviewFile = path.join(reviewsDir, `${ISSUE}.json`);
const existing = existsSync(reviewFile) ? JSON.parse(await readFile(reviewFile, "utf8")) : null;
await writeFile(reviewFile, JSON.stringify(buildReviewTemplate(ISSUE, candidates, existing), null, 2));

// Review feed: every digest on disk, newest first (Actions runners hold only this run's; locally they accumulate).
const digests = [];
for (const f of (await readdir(digestsDir)).filter((x) => x.endsWith(".md")).sort()) {
  const issueDate = f.replace(/\.md$/, "");
  const cands = issueDate === ISSUE ? candidates : await readCandidates(path.join(digestsDir, issueDate)).catch(() => []);
  digests.push({ issueDate, candidates: issueDate === ISSUE ? cands : cands, opts: issueDate === ISSUE ? opts : {}, link: issueDate === ISSUE ? DIGEST_URL : DIGEST_URL.replace(ISSUE, issueDate), generatedAt: issueDate === ISSUE ? Date.now() : undefined });
}
// Older digests are re-rendered from a candidate snapshot saved beside them so the feed stays complete.
await mkdir(path.join(digestsDir, ISSUE), { recursive: true });
for (const c of candidates) await writeFile(path.join(digestsDir, ISSUE, `${c.id}.json`), JSON.stringify(c, null, 2));
await mkdir(path.dirname(FEED), { recursive: true });
await writeFile(FEED, renderReviewFeed(digests, { feedUrl: FEED_URL }));

console.log(`digest for the issue of ${ISSUE}: ${candidates.length} candidate(s) — ${issueSummaryLine(candidates)}`);
const show = (f) => (f.startsWith(ROOT) ? path.relative(ROOT, f) : f);
console.log(`  ${show(path.join(digestsDir, `${ISSUE}.md`))}\n  ${show(reviewFile)} (${candidates.filter((c) => c.lane === "NOW").length} NOW; attorney rows where gated)\n  ${show(FEED)} (${digests.length} item${digests.length === 1 ? "" : "s"})`);
