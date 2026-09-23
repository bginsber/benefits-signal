#!/usr/bin/env node
/**
 * Summarise an RSS feed for a human check: item count, date range, items per
 * source, and the newest titles. Reads a local file or an http(s) URL.
 *
 * Usage: node scripts/feed-report.mjs <file-or-url> [--titles N]
 */

import { readFile } from "node:fs/promises";
import { fetchText, parseRss } from "./lib/collectors.mjs";

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--"));
const TITLES = args.includes("--titles") ? Number(args[args.indexOf("--titles") + 1]) : 25;
if (!target) {
  console.error("usage: node scripts/feed-report.mjs <file-or-url> [--titles N]");
  process.exit(2);
}

const xml = /^https?:/.test(target) ? await fetchText(target, { retries: 1 }) : await readFile(target, "utf8");
const built = xml.match(/<lastBuildDate>([^<]+)<\/lastBuildDate>/)?.[1] ?? "(none)";
const items = parseRss(xml, "feed");
const dates = items.map((it) => it.date).filter(Boolean).sort();
const bySource = {};
for (const it of items) {
  const src = (it.categories[0] ?? "(none)").replace(/ — .*/, "");
  bySource[src] = (bySource[src] ?? 0) + 1;
}

console.log(`feed: ${target}`);
console.log(`well-formed rss: ${/<rss[\s>]/.test(xml) && /<\/rss>\s*$/.test(xml)} · lastBuildDate: ${built}`);
console.log(`items: ${items.length} · newest ${dates.at(-1)?.slice(0, 10) ?? "-"} · oldest ${dates[0]?.slice(0, 10) ?? "-"}`);
console.log("per source:");
for (const [k, v] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
console.log(`newest ${Math.min(TITLES, items.length)} titles:`);
for (const it of items.slice(0, TITLES)) console.log(`  ${it.date?.slice(0, 10) ?? "undated   "}  ${it.title.slice(0, 140)}`);
