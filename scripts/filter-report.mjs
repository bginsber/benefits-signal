#!/usr/bin/env node
/**
 * Show what spec/feed-filter.yaml drops from the collated feed, grouped by
 * reason, so a reviewer can spot relevant items the rules are losing.
 * Run after scripts/collect.mjs; reads the document store.
 *
 * Usage: node scripts/filter-report.mjs [--in data/collected] [--kept]
 */

import path from "node:path";
import { ROOT } from "./lib/sources.mjs";
import { readCollected } from "./lib/triage.mjs";
import { keepForFeed, loadFeedRules } from "./lib/feed.mjs";

const args = process.argv.slice(2);
const IN = path.resolve(ROOT, args.includes("--in") ? args[args.indexOf("--in") + 1] : "data/collected");
const rules = await loadFeedRules();
const groups = {};
for (const doc of await readCollected(IN)) {
  const { keep, why } = keepForFeed(doc, rules, doc.source_id);
  if (keep && !args.includes("--kept")) continue;
  const key = `${keep ? "KEPT" : "DROPPED"} · ${why.split(":")[0]}`;
  (groups[key] ??= []).push(`${doc.date?.slice(0, 10) ?? "undated   "}  [${String(doc.source).replace(/ — .*/, "")}] ${doc.title}`.slice(0, 170));
}
for (const [k, list] of Object.entries(groups).sort()) {
  console.log(`\n${k} (${list.length})`);
  for (const line of list.sort().reverse()) console.log(`  ${line}`);
}
