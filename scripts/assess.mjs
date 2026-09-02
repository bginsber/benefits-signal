#!/usr/bin/env node
/**
 * Benefits Signal — cluster, verify, assess (spec § 6.4–6.6)
 *
 * Reads in-scope documents (data/matches + data/collected), groups them by
 * underlying development, verifies each against primary authority, and
 * writes one Development candidate per cluster:
 *
 *   data/clusters.json            — this run's clusters with members and verification
 *   data/candidates/<id>.json     — issue-schema-shaped development + `pipeline` block
 *   data/run-log.json             — `assess` block: counts, defects, usage
 *
 * Usage:
 *   node scripts/assess.mjs                  # live: data/matches, data/collected → data/
 *   node scripts/assess.mjs --fixture        # replay: tests/fixtures/{matches,collected} → data/
 *   node scripts/assess.mjs --record --matches tests/fixtures/matches --collected tests/fixtures/collected
 *   --claude-code (or BENEFITS_SIGNAL_MODEL=claude-code): call the model through the Claude Code CLI on the user's subscription
 *   options: --matches <dir> --collected <dir> --out <dir> --window-days 30 --open <issue.json> --today YYYY-MM-DD
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT, loadScans } from "./lib/sources.mjs";
import { createModelClient, loadPrompt } from "./lib/model.mjs";
import { readCollected } from "./lib/triage.mjs";
import { assessCluster, buildAssessSystem, clusterDocuments, loadTaxonomyText, verifyCluster } from "./lib/assess.mjs";
import { validate } from "./lib/schema.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);

const mode = flag("--fixture") ? "fixture" : flag("--record") ? "record" : "live";
const backend = flag("--claude-code") || process.env.BENEFITS_SIGNAL_MODEL === "claude-code" ? "claude-code" : "sdk";
const fx = (stage) => path.join(ROOT, "tests", "fixtures", "model", stage);
const MATCHES = path.resolve(ROOT, opt("--matches", mode === "fixture" ? "tests/fixtures/matches" : "data/matches"));
const COLLECTED = path.resolve(ROOT, opt("--collected", mode === "fixture" ? "tests/fixtures/collected" : "data/collected"));
const OUT = path.resolve(ROOT, opt("--out", "data"));
const WINDOW_DAYS = Number(opt("--window-days", 30)) || 30;
const today = opt("--today") ? new Date(`${opt("--today")}T12:00:00Z`) : new Date();
const openDevelopments = opt("--open") ? (JSON.parse(await readFile(path.resolve(ROOT, opt("--open")), "utf8")).developments ?? []) : [];

const [scans, taxonomy, clusterPrompt, verifyPrompt, assessPrompt] = await Promise.all([
  loadScans(), loadTaxonomyText(),
  loadPrompt(path.join(ROOT, "prompts", "cluster.md")), loadPrompt(path.join(ROOT, "prompts", "verify.md")), loadPrompt(path.join(ROOT, "prompts", "assess.md")),
]);
const clients = {
  cluster: createModelClient({ mode, backend, fixtureDir: fx("cluster") }),
  verify: createModelClient({ mode, backend, fixtureDir: fx("verify") }),
  assess: createModelClient({ mode, backend, fixtureDir: fx("assess") }),
};
const schema = JSON.parse(await readFile(path.join(ROOT, "spec", "issue-schema.json"), "utf8"));

// In-scope documents: match records joined to their collected documents, within the window.
const since = new Date(today.getTime() - WINDOW_DAYS * 86400000);
const collected = new Map((await readCollected(COLLECTED)).map((d) => [d.id, d]));
const matches = await readCollected(MATCHES);
const docs = [];
for (const m of matches) {
  const d = collected.get(m.document_id ?? m.id);
  if (!d) { console.error(`note: match ${m.id.slice(0, 8)} has no collected document; skipped`); continue; }
  if (d.date && new Date(d.date) < since) continue;
  docs.push({ ...d, scan_ids: m.scan_ids ?? [], triage_summary: m.summary ?? "" });
}
const docsById = new Map(docs.map((d) => [d.id, d]));
console.log(`assess ${mode} via ${backend}: ${docs.length} in-scope documents in the ${WINDOW_DAYS}-day window (${matches.length} match records)`);

let clusters;
try {
  clusters = await clusterDocuments(docs, { client: clients.cluster, prompt: clusterPrompt, openDevelopments });
} catch (e) {
  console.error(`FATAL: cluster stage could not call the model: ${e.message}`);
  process.exit(1);
}
console.log(`${clusters.length} clusters`);

const system = buildAssessSystem(assessPrompt, scans, taxonomy);
await mkdir(path.join(OUT, "candidates"), { recursive: true });
const counts = { clusters: clusters.length, candidates: 0, unassessed: 0, verified: { confirmed: 0, partially_confirmed: 0, unconfirmed: 0 }, tiers: { NOW: 0, NEXT: 0, WATCH: 0 }, defects: 0, schema_errors: 0 };
const summary = [];
for (const c of clusters) {
  let verification, candidate, stop_reason, stop_details;
  try {
    verification = await verifyCluster(c, docsById, { client: clients.verify, prompt: verifyPrompt, offline: mode === "fixture" });
    counts.verified[verification.result]++;
    c.verification = { ...verification, primary: undefined };
    ({ candidate, stop_reason, stop_details } = await assessCluster(c, docsById, verification, { client: clients.assess, prompt: assessPrompt, system, today }));
  } catch (e) {
    candidate = null; stop_reason = "error"; stop_details = { message: e.message };
    if (!verification) counts.verified.unconfirmed++;
  }
  if (!candidate) {
    counts.unassessed++;
    c.unassessed = { stop_reason, stop_details };
    console.log(`----  ${c.id} ${c.label.slice(0, 60)} | not assessed (${stop_reason}${stop_details?.message ? `: ${stop_details.message.slice(0, 120)}` : ""})`);
    continue;
  }
  const { pipeline, ...dev } = candidate;
  const errors = validate(dev, schema.$defs.development, schema);
  if (errors.length) { counts.schema_errors++; pipeline.defects.push(...errors.map((e) => `schema: ${e}`)); }
  counts.candidates++;
  counts.tiers[dev.lane]++;
  counts.defects += pipeline.defects.length;
  await writeFile(path.join(OUT, "candidates", `${dev.id}.json`), JSON.stringify(candidate, null, 2));
  summary.push({ id: dev.id, headline: dev.headline, tier: dev.lane, confidence: dev.metadata.Confidence[0], verification: verification.result, defects: pipeline.defects.length });
  console.log(`${dev.lane.padEnd(5)} ${dev.metadata.Confidence[0].padEnd(6)} ${verification.result.padEnd(19)} ${dev.headline.slice(0, 70)}${pipeline.defects.length ? ` (${pipeline.defects.length} defect${pipeline.defects.length > 1 ? "s" : ""})` : ""}`);
}

await writeFile(path.join(OUT, "clusters.json"), JSON.stringify({ ran_at: new Date().toISOString(), mode, window_days: WINDOW_DAYS, clusters }, null, 2));
const logFile = path.join(OUT, "run-log.json");
let log = {};
try { log = JSON.parse(await readFile(logFile, "utf8")); } catch { /* first run */ }
const usage = Object.fromEntries(Object.entries(clients).map(([k, v]) => [k, v.usage]));
log.assess = { ran_at: new Date().toISOString(), mode, model: clients.assess.model, prompts: { cluster: clusterPrompt.version, verify: verifyPrompt.version, assess: assessPrompt.version }, ...counts, candidates_list: summary, usage };
await writeFile(logFile, JSON.stringify(log, null, 2));

console.log(`\n${counts.candidates} candidates from ${counts.clusters} clusters (${counts.unassessed} unassessed): NOW ${counts.tiers.NOW} · NEXT ${counts.tiers.NEXT} · WATCH ${counts.tiers.WATCH}; verification confirmed ${counts.verified.confirmed} / partial ${counts.verified.partially_confirmed} / unconfirmed ${counts.verified.unconfirmed}; ${counts.defects} rule defects; ${counts.schema_errors} schema errors`);
if (counts.schema_errors) process.exitCode = 1;
