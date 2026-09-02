import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { parseRss } from "../scripts/lib/collectors.mjs";
import { buildReviewTemplate, issueSummaryLine, needsAttorney, nextIssueDate, renderMarkdown, renderReviewFeed } from "../scripts/lib/digest.mjs";

const run = promisify(execFile);
const ROOT = new URL("..", import.meta.url).pathname;

test("fixture-mode digest writes the Markdown digest, a review template, and a valid review feed", async () => {
  const out = await mkdtemp(path.join(tmpdir(), "digest-"));
  const { stdout } = await run("node", [path.join(ROOT, "scripts/digest.mjs"), "--fixture", "--out", out, "--issue", "2026-09-02"]);
  assert.match(stdout, /3 candidate\(s\) — Three candidate developments for review\./);

  const md = await readFile(path.join(out, "digests", "2026-09-02.md"), "utf8");
  assert.match(md, /^# Benefits Signal — candidate digest for the issue of Wednesday, September 2, 2026/);
  // Newsletter order: lane line, headline, status, summary, then the disclosure fields in App.jsx order.
  const first = md.indexOf("## 1. ");
  const order = ["## 1. WATCH · No action yet", "### ", "**Read briefing and evidence**", "- **Who:**", "- **What:**", "- **By when:**", "- **Matched scan:**", "- **Plan type:**", "- **Confidence:**", "- **Fiduciary duties:**", "- **Merged evidence:**", "- **Confidence rationale:**", "- **Supporting passage:**", "- **Links:**", "- **Suggested next step:**", "#### Reviewer notes", "- **Attorney approval:**", "- **Verification:**", "- **Documents merged (1):**", "- **Rule corrections applied:**"];
  let pos = first;
  for (const marker of order) { const i = md.indexOf(marker, pos); assert.ok(i > -1, `missing "${marker}" after position ${pos}`); pos = i; }
  assert.match(md, /tier lowered from NEXT to WATCH: dates unconfirmed/, "reviewer sees the enforcement corrections");
  assert.match(md, /Nothing is sent or changed automatically/);

  const review = JSON.parse(await readFile(path.join(out, "reviews", "2026-09-02.json"), "utf8"));
  assert.equal(review.issue_date, "2026-09-02");
  assert.equal(review.decisions.length, 3, "three WATCH candidates with no gated tag need only paralegal rows");
  for (const d of review.decisions) assert.deepEqual([d.role, d.decision, d.decided_at], ["paralegal", "", null]);

  const xml = await readFile(path.join(out, "review.xml"), "utf8");
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<rss version="2\.0">/);
  const items = parseRss(xml, "review");
  assert.equal(items.length, 1);
  assert.match(items[0].title, /^\[Review\] Candidate digest — issue of Wednesday, September 2, 2026/);
  assert.match(xml, /Reviewer notes \(not shown to readers\)/, "the full digest HTML is carried in the item description");
  assert.ok((await readdir(path.join(out, "digests", "2026-09-02"))).length === 3, "candidate snapshot saved beside the digest");
});

test("a week with no candidates renders the zero-development message", async () => {
  const out = await mkdtemp(path.join(tmpdir(), "digest-empty-"));
  const empty = await mkdtemp(path.join(tmpdir(), "no-candidates-"));
  const { stdout } = await run("node", [path.join(ROOT, "scripts/digest.mjs"), "--candidates", empty, "--out", out, "--issue", "2026-09-09"]);
  assert.match(stdout, /0 candidate\(s\) — Nothing requires your attention this week\./);
  const md = await readFile(path.join(out, "digests", "2026-09-09.md"), "utf8");
  assert.match(md, /Nothing requires your attention this week/);
  assert.match(md, /zero developments is the correct outcome/);
  const review = JSON.parse(await readFile(path.join(out, "reviews", "2026-09-09.json"), "utf8"));
  assert.deepEqual(review.decisions, []);
});

test("attorney gate rows appear for NOW items and gated tags, and existing decisions survive regeneration", () => {
  const base = { headline: "h", metadata: { "Fiduciary duties": ["Prudence & Process"] } };
  const now = { ...base, id: "a", lane: "NOW" };
  const gated = { ...base, id: "b", lane: "WATCH", metadata: { "Fiduciary duties": ["Loyalty & Exclusive Benefit"] } };
  const plain = { ...base, id: "c", lane: "NEXT" };
  assert.deepEqual(needsAttorney(now), { required: true, why: "NOW item" });
  assert.deepEqual(needsAttorney(gated), { required: true, why: "tagged Loyalty & Exclusive Benefit" });
  assert.equal(needsAttorney(plain).required, false);
  const t = buildReviewTemplate("2026-09-02", [now, gated, plain]);
  assert.deepEqual(t.decisions.map((d) => `${d.development_id}:${d.role}`), ["a:paralegal", "a:attorney", "b:paralegal", "b:attorney", "c:paralegal"]);
  const filled = { decisions: [{ development_id: "a", role: "attorney", reviewer: "attorney", decision: "approve", edits: {}, note: "ok", decided_at: "2026-09-02T10:00:00Z" }] };
  const again = buildReviewTemplate("2026-09-02", [now, gated, plain], filled);
  assert.equal(again.decisions.find((d) => d.development_id === "a" && d.role === "attorney").decision, "approve");
  assert.equal(issueSummaryLine([now, plain]), "Two candidate developments for review. One needs attorney sign-off.");
  assert.equal(nextIssueDate(new Date("2026-09-03T12:00:00Z")), "2026-09-09", "Thursday rolls to the next Wednesday");
  assert.equal(nextIssueDate(new Date("2026-09-02T12:00:00Z")), "2026-09-02", "a Wednesday is its own issue date");
  assert.match(renderMarkdown("2026-09-02", []), /Nothing requires your attention this week/);
  assert.match(renderReviewFeed([]), /<channel>[\s\S]*<\/channel>/);
});
