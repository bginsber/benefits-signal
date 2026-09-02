#!/usr/bin/env node
/**
 * Benefits Signal — publish (spec § 6.8)
 *
 * Assembles the issue the front end renders from approved candidates and the
 * paralegal's review file, validates it against spec/issue-schema.json, and
 * writes it where the app reads it. Nothing is emailed; the paralegal releases
 * the issue by running this and pushing the result.
 *
 * Usage:
 *   node scripts/publish.mjs --issue 2026-09-02                  # data/candidates + data/reviews/2026-09-02.json → public/issue.json
 *   node scripts/publish.mjs --fixture --issue 2026-09-02 --out <file>
 *   options: --candidates <dir> --review <file> --previous <issue.json> --collected <dir> --omitted <dir> --matches <dir> --out <file> --archive <dir>
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/sources.mjs";
import { readCollected } from "./lib/triage.mjs";
import { readCandidates } from "./lib/digest.mjs";
import { buildIssue } from "./lib/publish.mjs";
import { validate } from "./lib/schema.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);

const fixture = flag("--fixture");
const ISSUE = opt("--issue");
if (!ISSUE || !/^\d{4}-\d{2}-\d{2}$/.test(ISSUE)) { console.error("usage: node scripts/publish.mjs --issue YYYY-MM-DD [--fixture] [...]"); process.exit(2); }
const CANDIDATES = path.resolve(ROOT, opt("--candidates", fixture ? "tests/fixtures/candidates" : "data/candidates"));
const REVIEW = path.resolve(ROOT, opt("--review", fixture ? "tests/fixtures/reviews/2026-09-02.json" : `data/reviews/${ISSUE}.json`));
const PREVIOUS = opt("--previous", fixture ? null : "public/issue.json");
const COLLECTED = path.resolve(ROOT, opt("--collected", fixture ? "tests/fixtures/collected" : "data/collected"));
const OMITTED = path.resolve(ROOT, opt("--omitted", "data/omitted"));
const MATCHES = path.resolve(ROOT, opt("--matches", fixture ? "tests/fixtures/matches" : "data/matches"));
const OUT = path.resolve(ROOT, opt("--out", "public/issue.json"));
const ARCHIVE = opt("--archive", fixture ? null : "data/issues");

const readJson = async (f) => JSON.parse(await readFile(f, "utf8"));
const candidates = await readCandidates(CANDIDATES);
const review = existsSync(REVIEW) ? await readJson(REVIEW) : null;
if (!review) console.error(`note: no review file at ${path.relative(ROOT, REVIEW)}; nothing can be released without decisions`);
const previous = PREVIOUS && existsSync(path.resolve(ROOT, PREVIOUS)) ? await readJson(path.resolve(ROOT, PREVIOUS)) : null;
let docsById = new Map();
try { docsById = new Map((await readCollected(COLLECTED)).map((d) => [d.id, d])); } catch { /* none */ }
let omitted = [];
try { omitted = await readCollected(OMITTED); } catch { /* none */ }
let matches = [];
try { matches = await readCollected(MATCHES); } catch { /* none */ }

const { issue, released, rejected } = buildIssue({ issueDate: ISSUE, candidates, review, previous, docsById, omitted, matches });
const schema = await readJson(path.join(ROOT, "spec", "issue-schema.json"));
const errors = validate(issue, schema);
if (errors.length) {
  console.error(`issue.json does not match spec/issue-schema.json:\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(issue, null, 2) + "\n");
if (ARCHIVE) {
  const dir = path.resolve(ROOT, ARCHIVE);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${ISSUE}.json`), JSON.stringify(issue, null, 2) + "\n");
}

const show = (f) => (f.startsWith(ROOT) ? path.relative(ROOT, f) : f);
console.log(`issue of ${issue.issueDate}: ${issue.issueSummary}`);
for (const d of issue.developments) console.log(`  ${d.lane.padEnd(5)} ${d.headline}${d.carriedForward ? " (carried forward)" : ""}`);
for (const r of rejected) console.log(`  ----  not released: ${r.candidate.headline} (${r.why})`);
console.log(`  obligations: ${issue.obligations.length} dated item(s)`);
console.log(`  source log: ${issue.sourceLog.length} rows → ${show(OUT)}${ARCHIVE ? ` (archived under ${ARCHIVE}/${ISSUE}.json)` : ""}`);
