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
 *   data/first-seen.json — link → first collected time, carried across runs
 *                          the same way, so future-dated notices keep the
 *                          date they first appeared instead of "now"
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
import { collectSource, displayDate, fetchText } from "./lib/collectors.mjs";
import { keepForFeed, loadFeedRules, renderItemHtml } from "./lib/feed.mjs";
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

/** A previous run's JSON file: from the published Pages copy when FEED_URL is set, else the local file. */
async function loadPrevious(name, why) {
  const local = path.join(ROOT, "data", name);
  try {
    if (process.env.FEED_URL) return JSON.parse(await fetchText(new URL(name, process.env.FEED_URL).href, { retries: 0 }));
    if (existsSync(local)) return JSON.parse(await readFile(local, "utf8"));
  } catch (e) {
    console.error(`note: previous ${name} unavailable (${e.message}); ${why}`);
  }
  return null;
}
const loadPreviousRunLog = () => loadPrevious("run-log.json", "failure counts restart at 1");
const loadPreviousFirstSeen = () => loadPrevious("first-seen.json", "first-seen dates restart today");

/** Idempotent store: one JSON file per document, keyed by URL hash. Returns the count stored and each link's first-seen time. */
async function storeItems(items) {
  await mkdir(DATA_DIR, { recursive: true });
  let stored = 0;
  const firstSeen = new Map();
  for (const it of items) {
    const file = path.join(DATA_DIR, `${sha1(it.link)}.json`);
    if (existsSync(file)) {
      try { firstSeen.set(it.link, JSON.parse(await readFile(file, "utf8")).collected_at ?? null); } catch { /* unreadable; treat as new */ }
      continue;
    }
    const collected_at = new Date().toISOString();
    await writeFile(file, JSON.stringify({ ...it, collected_at }, null, 2));
    firstSeen.set(it.link, collected_at);
    stored++;
  }
  return { stored, firstSeen };
}

function buildRss(items, sourceNames) {
  const now = new Date().toUTCString();
  const entries = items.map((it) => {
    const d = new Date(it.displayDate).toUTCString();
    return `    <item>
      <title>${esc(`[${it.source.replace(/ — .*/, "")}] ${it.title}`)}</title>
      <link>${esc(it.link)}</link>
      <guid isPermaLink="true">${esc(it.link)}</guid>
      <pubDate>${d}</pubDate>
      <category>${esc(it.source)}</category>
      <description>${esc(renderItemHtml(it))}</description>
      <source url="${esc(it.link)}">${esc(it.source)}</source>
    </item>`;
  }).join("\n");
  const feedUrl = process.env.FEED_URL || "https://example.invalid/benefits-signal/collated.xml";
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Benefits Signal — Collated Sources</title>
    <link>${esc(feedUrl)}</link>
    <atom:link href="${esc(feedUrl)}" rel="self" type="application/rss+xml"/>
    <docs>https://www.rssboard.org/rss-specification</docs>
    <generator>Benefits Signal collector</generator>
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
const previousLog = await loadPreviousRunLog();
const previous = new Map((previousLog?.sources ?? []).map((r) => [r.id ?? r.source, r]));

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
    for (const it of items) it.source_id = src.id;
    all.push(...items);
    collected.push(src);
    runLog.push({ source: src.name, id: src.id, ok: true, items: items.length });
    console.log(`ok   ${src.name}: ${items.length} items`);
  } catch (e) {
    runLog.push({ source: src.name, id: src.id, ok: false, error: String(e.message ?? e) });
    console.error(`FAIL ${src.name}: ${e.message}`);
  }
}

// Dedupe by link, store, then sort newest first by the date each item became news
// (its own date, or the first-seen time for future-dated items such as meeting notices).
const seen = new Set();
all = all.filter((it) => (seen.has(it.link) ? false : (seen.add(it.link), true)));
const { stored, firstSeen } = await storeItems(all);
// Earlier runs' first-seen times win over this run's store (which is empty on a fresh Actions runner).
for (const [link, at] of Object.entries((await loadPreviousFirstSeen()) ?? {})) if (at && (!firstSeen.get(link) || at < firstSeen.get(link))) firstSeen.set(link, at);
const now = new Date();
for (const it of all) it.displayDate = displayDate(it, firstSeen, now);
all.sort((a, b) => b.displayDate.localeCompare(a.displayDate));
await mkdir(path.join(ROOT, "data"), { recursive: true });
await writeFile(path.join(ROOT, "data", "first-seen.json"), JSON.stringify(Object.fromEntries([...firstSeen].filter(([, at]) => at).sort()), null, 0));

// The store keeps everything; the inbox feed applies spec/feed-filter.yaml
// (rules and benefits-related notices from the Federal Register; no firm news or events).
const feedRules = await loadFeedRules();
const feedItems = [];
const dropped = {};
for (const it of all) {
  const { keep, why } = keepForFeed(it, feedRules, it.source_id);
  if (keep) feedItems.push(it);
  else dropped[why.split(":")[0]] = (dropped[why.split(":")[0]] ?? 0) + 1;
}
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, buildRss(feedItems.slice(0, 100), collected.map((s) => s.name)));
console.log(`\n${all.length} unique items in window (${stored} newly stored); ${feedItems.length} in the feed, ${all.length - feedItems.length} filtered (${Object.entries(dropped).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}) → ${path.relative(ROOT, OUT)}`);
const { attempted, failed } = carryFailureCounts(runLog, previous);
await mkdir(path.join(ROOT, "data"), { recursive: true });
await writeFile(path.join(ROOT, "data", "run-log.json"),
  JSON.stringify({ ...(previousLog ?? {}), ran_at: new Date().toISOString(), window_days: DAYS, total_items: all.length, newly_stored: stored, sources: runLog }, null, 2));
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
