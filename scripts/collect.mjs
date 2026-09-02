#!/usr/bin/env node
/**
 * Benefits Signal — Phase 0 collector (spec § 6.1)
 *
 * Zero-dependency Node 18+ script. Pulls the verified RSS interpretation
 * sources and the Federal Register API primary channel, stores raw documents
 * idempotently under data/collected/, and emits:
 *
 *   public/collated.xml  — one merged RSS 2.0 feed (Outlook Classic readable)
 *   data/run-log.json    — per-source outcome; carries consecutive_failures
 *                          across runs (previous log read from the Pages URL
 *                          when FEED_URL is set, else from the local file) so
 *                          a source silent for three runs raises a warning
 *
 * The source list is read from spec/sources.yaml (scripts/lib/sources.mjs).
 * Sources whose method has no collector yet are skipped with a logged reason,
 * never silently dropped; every active source gets a row in the run log.
 *
 * Usage: node scripts/collect.mjs [--days 30] [--out public/collated.xml]
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ROOT, loadSources, resolveCollector } from "./lib/sources.mjs";
import { collectSource, fetchText } from "./lib/collectors.mjs";
import { SILENT_AFTER, carryFailureCounts } from "./lib/runlog.mjs";

const DATA_DIR = path.join(ROOT, "data", "collected");
const args = process.argv.slice(2);
const DAYS = Number(args[args.indexOf("--days") + 1]) > 0 && args.includes("--days")
  ? Number(args[args.indexOf("--days") + 1]) : 30;
const OUT = args.includes("--out")
  ? path.resolve(ROOT, args[args.indexOf("--out") + 1])
  : path.join(ROOT, "public", "collated.xml");

const sha1 = (s) => createHash("sha1").update(s).digest("hex");
const esc = (s = "") => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Previous run log: from the published Pages copy when FEED_URL is set, else the local file. */
async function loadPreviousRunLog() {
  const local = path.join(ROOT, "data", "run-log.json");
  try {
    if (process.env.FEED_URL) return JSON.parse(await fetchText(new URL("run-log.json", process.env.FEED_URL).href, { retries: 0 }));
    if (existsSync(local)) return JSON.parse(await readFile(local, "utf8"));
  } catch (e) {
    console.error(`note: previous run log unavailable (${e.message}); failure counts restart at 1`);
  }
  return null;
}

/** Idempotent store: one JSON file per document, keyed by URL hash. */
async function storeItems(items) {
  await mkdir(DATA_DIR, { recursive: true });
  let stored = 0;
  for (const it of items) {
    const file = path.join(DATA_DIR, `${sha1(it.link)}.json`);
    if (!existsSync(file)) {
      await writeFile(file, JSON.stringify({ ...it, collected_at: new Date().toISOString() }, null, 2));
      stored++;
    }
  }
  return stored;
}

function buildRss(items, sourceNames) {
  const now = new Date().toUTCString();
  const entries = items.map((it) => {
    const d = it.date ? new Date(it.date).toUTCString() : now;
    return `    <item>
      <title>${esc(`[${it.source.replace(/ — .*/, "")}] ${it.title}`)}</title>
      <link>${esc(it.link)}</link>
      <guid isPermaLink="true">${esc(it.link)}</guid>
      <pubDate>${d}</pubDate>
      <category>${esc(it.source)}</category>
      <description>${esc(it.summary || it.title)}</description>
      <source url="${esc(it.link)}">${esc(it.source)}</source>
    </item>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Benefits Signal — Collated Sources</title>
    <link>${esc(process.env.FEED_URL || "https://example.invalid/benefits-signal")}</link>
    <description>${esc(`Merged raw intake: ${sourceNames.join(", ")}. Pre-triage material for the Benefits Signal pipeline; not legal advice.`)}</description>
    <language>en-us</language>
    <lastBuildDate>${now}</lastBuildDate>
    <ttl>720</ttl>
${entries}
  </channel>
</rss>
`;
}

// ---------- main ----------

const since = new Date(Date.now() - DAYS * 86400000);
const sinceISO = since.toISOString().slice(0, 10);
const runLog = [];
let all = [];
const previous = new Map(((await loadPreviousRunLog())?.sources ?? []).map((r) => [r.id ?? r.source, r]));

const sources = await loadSources();
const collected = [];
for (const src of sources) {
  if (!src.active) continue;
  const { kind, reason } = resolveCollector(src);
  if (!kind) {
    runLog.push({ source: src.name, id: src.id, skipped: reason });
    console.log(`skip ${src.name}: ${reason}`);
    continue;
  }
  try {
    const items = await collectSource(src, kind, { since, sinceISO });
    all.push(...items);
    collected.push(src);
    runLog.push({ source: src.name, id: src.id, ok: true, items: items.length });
    console.log(`ok   ${src.name}: ${items.length} items`);
  } catch (e) {
    runLog.push({ source: src.name, id: src.id, ok: false, error: String(e.message ?? e) });
    console.error(`FAIL ${src.name}: ${e.message}`);
  }
}

// Dedupe by link, sort newest first.
const seen = new Set();
all = all.filter((it) => (seen.has(it.link) ? false : (seen.add(it.link), true)))
  .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

const stored = await storeItems(all);

// The store keeps everything; the inbox feed omits routine Federal Register
// notices (which dominate ~4:1) unless they carry a comment deadline.
const feedItems = all.filter((it) =>
  !it.source.startsWith("Federal Register") ||
  it.categories?.[0] !== "Notice" ||
  it.structured?.comments_close_on);
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, buildRss(feedItems.slice(0, 100), collected.map((s) => s.name)));
console.log(`\n${all.length} unique items in window (${stored} newly stored) → ${path.relative(ROOT, OUT)}`);
const { attempted, failed } = carryFailureCounts(runLog, previous);
await mkdir(path.join(ROOT, "data"), { recursive: true });
await writeFile(path.join(ROOT, "data", "run-log.json"),
  JSON.stringify({ ran_at: new Date().toISOString(), window_days: DAYS, total_items: all.length, newly_stored: stored, sources: runLog }, null, 2));
for (const r of failed) {
  if (r.consecutive_failures >= SILENT_AFTER) {
    console.error(`::warning title=Source silent::${r.source} has failed ${r.consecutive_failures} consecutive runs (since ${r.silent_since}): ${r.error}`);
  } else {
    console.error(`::warning title=Source failed::${r.source}: ${r.error ?? "unknown error"}`);
  }
}
// Partial source failures are logged (and recorded in data/run-log.json) but do not block publishing.
// Only fail the run when nothing usable was collected.
if (all.length === 0 || failed.length === attempted.length) {
  console.error("FATAL: no items collected — refusing to publish an empty feed");
  process.exitCode = 1;
}
