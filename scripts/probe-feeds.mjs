#!/usr/bin/env node
/**
 * Probe candidate RSS feeds before adding them to spec/sources.yaml: HTTP
 * outcome, item count, newest date, and the first few titles. Nothing is
 * stored; this is the verification step behind a "verified" note.
 *
 * Usage: node scripts/probe-feeds.mjs <url> [<url> ...]
 */

import { fetchText, parseRss } from "./lib/collectors.mjs";

const urls = process.argv.slice(2);
if (!urls.length) {
  console.error("usage: node scripts/probe-feeds.mjs <url> [<url> ...]");
  process.exit(2);
}

for (const url of urls) {
  try {
    const xml = await fetchText(url, { retries: 0 });
    const items = parseRss(xml, "probe");
    const newest = items.map((it) => it.date).filter(Boolean).sort().at(-1)?.slice(0, 10) ?? "-";
    const cats = [...new Set(items.flatMap((it) => it.categories))].slice(0, 12).join(" | ");
    console.log(`OK    ${url}\n      ${items.length} items · newest ${newest}${cats ? ` · categories: ${cats}` : ""}`);
    for (const it of items.slice(0, 4)) console.log(`      ${it.date?.slice(0, 10) ?? "undated   "}  ${it.title.slice(0, 120)}`);
  } catch (e) {
    console.log(`FAIL  ${url}\n      ${e.message}`);
  }
}
