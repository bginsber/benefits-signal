#!/usr/bin/env node
/**
 * Benefits Signal — triage (spec § 6.2 normalize + § 6.3 scan match)
 *
 * Reads collected documents, asks the model for a neutral summary and one
 * ScanMatch row per saved scan, and writes:
 *
 *   data/matches/<id>.json  — documents in scope for at least one scan
 *   data/omitted/<id>.json  — documents in no scan, with the model's reason verbatim
 *   data/run-log.json       — `triage` block: counts per scan, omissions, token usage
 *
 * Idempotent: a document already triaged under the current prompt version is
 * skipped unless --force. Nothing is ever deleted.
 *
 * Usage:
 *   node scripts/triage.mjs                       # live, data/collected → data/
 *   node scripts/triage.mjs --fixture             # replay tests/fixtures/model, tests/fixtures/collected → data/
 *   node scripts/triage.mjs --record --in tests/fixtures/collected   # live, and save responses as fixtures
 *   options: --in <dir> --out <dir> --limit N --concurrency N --force
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, loadScans } from "./lib/sources.mjs";
import { createModelClient, loadPrompt } from "./lib/model.mjs";
import { buildSystem, readCollected, triageDocument } from "./lib/triage.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);

const FIXTURE_MODEL_DIR = path.join(ROOT, "tests", "fixtures", "model", "triage");
const mode = flag("--fixture") ? "fixture" : flag("--record") ? "record" : "live";
const IN = path.resolve(ROOT, opt("--in", mode === "fixture" ? "tests/fixtures/collected" : "data/collected"));
const OUT = path.resolve(ROOT, opt("--out", "data"));
const LIMIT = Number(opt("--limit", 0)) || Infinity;
const CONCURRENCY = Math.max(1, Number(opt("--concurrency", 4)) || 4);
const FORCE = flag("--force");

const prompt = await loadPrompt(path.join(ROOT, "prompts", "triage.md"));
const scans = await loadScans();
const system = buildSystem(prompt, scans);
const client = createModelClient({ mode, fixtureDir: FIXTURE_MODEL_DIR });

const dirs = { matches: path.join(OUT, "matches"), omitted: path.join(OUT, "omitted") };
for (const d of Object.values(dirs)) await mkdir(d, { recursive: true });

const alreadyDone = (id) => {
  for (const d of Object.values(dirs)) {
    const f = path.join(d, `${id}.json`);
    if (existsSync(f)) return f;
  }
  return null;
};

let docs = await readCollected(IN);
const total = docs.length;
if (!FORCE) {
  docs = docs.filter((doc) => {
    const f = alreadyDone(doc.id);
    if (!f) return true;
    try { return JSON.parse(readFileSync(f, "utf8")).prompt_version !== prompt.version; } catch { return true; }
  });
}
docs = docs.slice(0, LIMIT);

console.log(`triage ${mode}: ${docs.length} of ${total} documents to assess (prompt ${prompt.version}, model ${client.model})`);

const counts = { assessed: 0, matched: 0, omitted: 0, skipped: 0, refusals: 0, per_scan: Object.fromEntries(scans.map((s) => [s.id, 0])) };
let i = 0;
async function worker() {
  while (i < docs.length) {
    const doc = docs[i++];
    try {
      const { bucket, record } = await triageDocument(doc, { client, prompt, system, scans });
      if (bucket === "skipped") { counts.skipped++; console.log(`skip  ${doc.id.slice(0, 8)} ${record.skipped}`); continue; }
      await writeFile(path.join(dirs[bucket], `${doc.id}.json`), JSON.stringify(record, null, 2));
      counts.assessed++;
      if (bucket === "matches") { counts.matched++; for (const s of record.scan_ids) counts.per_scan[s]++; }
      else { counts.omitted++; if (record.defect === "refusal") counts.refusals++; }
      console.log(`${bucket === "matches" ? "match" : "omit "} ${doc.id.slice(0, 8)} ${bucket === "matches" ? record.scan_ids.join(",") : "—"} | ${doc.title.slice(0, 70)}`);
    } catch (e) {
      counts.skipped++;
      console.error(`FAIL  ${doc.id.slice(0, 8)} ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, docs.length || 1) }, worker));

// Record the run beside the collector's log without discarding its rows.
const logFile = path.join(OUT, "run-log.json");
let log = {};
try { log = JSON.parse(await readFile(logFile, "utf8")); } catch { /* first run */ }
log.triage = { ran_at: new Date().toISOString(), mode, model: client.model, prompt_version: prompt.version, input_dir: path.relative(ROOT, IN), ...counts, usage: client.usage };
await mkdir(OUT, { recursive: true });
await writeFile(logFile, JSON.stringify(log, null, 2));

console.log(`\nassessed ${counts.assessed}: ${counts.matched} matched, ${counts.omitted} omitted (${counts.refusals} refusals), ${counts.skipped} skipped`);
console.log(`per scan: ${Object.entries(counts.per_scan).map(([k, v]) => `${k}=${v}`).join(" ")}`);
if (mode !== "fixture") console.log(`usage: ${client.usage.calls} calls, ${client.usage.input_tokens} in / ${client.usage.output_tokens} out, cache read ${client.usage.cache_read_input_tokens}`);
if (counts.refusals) console.error(`::warning title=Model refusal::${counts.refusals} document(s) refused; see data/omitted entries with defect: refusal`);
