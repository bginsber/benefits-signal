#!/usr/bin/env node
/**
 * Probe candidate sources before adding them to spec/sources.yaml. Nothing is
 * stored; this is the verification step behind a "verified" note.
 *
 * For an RSS or Atom feed: item count, newest date, items in the last 30 days
 * and how many of those name a benefits keyword (the Federal Register keyword
 * list in spec/feed-filter.yaml), and the first few titles. For JSON: the top-
 * level shape and the start of the body. For an HTML page: its title and any
 * feed links it advertises, so one probe can discover a feed URL.
 *
 * Usage: node scripts/probe-feeds.mjs <url> [--dump <url> [--at <regex>] [--len <n>]] ...
 *   --dump prints --len characters (default 6,000) of the raw body, from the first
 *   match of --at when given, for writing a parser fixture from the Actions log.
 *   --grep <url> --pattern <regex> prints every match (up to 60) with the text that follows it.
 */

import { FEED_ACCEPT, decodeEntities, fetchText, parseRss } from "./lib/collectors.mjs";
import { findKeyword, loadFeedRules } from "./lib/feed.mjs";

const args = process.argv.slice(2);
if (!args.length) {
  console.error("usage: node scripts/probe-feeds.mjs <url> [--dump <url> [--at <regex>] [--len <n>]] ...");
  process.exit(2);
}

const rules = await loadFeedRules();
const keywords = rules.federal_register?.keywords ?? [];
const since = new Date(Date.now() - 30 * 86400000).toISOString();

const jobs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dump" || args[i] === "--grep") {
    const job = { url: args[i + 1], [args[i].slice(2)]: true };
    i++;
    while (["--at", "--len", "--pattern"].includes(args[i + 1])) { job[args[i + 1].slice(2)] = args[i + 2]; i += 2; }
    jobs.push(job);
  } else jobs.push({ url: args[i] });
}

function describeHtml(url, body) {
  const title = decodeEntities(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const feeds = [...body.matchAll(/<link\b[^>]*type=["']application\/(?:rss|atom)\+xml["'][^>]*>/gi)]
    .map((m) => m[0].match(/href=["']([^"']+)["']/i)?.[1]).filter(Boolean);
  const hrefs = [...body.matchAll(/href=["']([^"']*(?:rss|feed|atom)[^"']*)["']/gi)].map((m) => m[1]);
  const found = [...new Set([...feeds, ...hrefs])].slice(0, 15).map((h) => { try { return new URL(decodeEntities(h), url).href; } catch { return h; } });
  console.log(`      HTML "${title.slice(0, 100)}" · ${body.length} bytes${found.length ? `\n      feed links: ${found.join(" ")}` : " · no feed links"}`);
}

function describeJson(body) {
  let j;
  try { j = JSON.parse(body); } catch { return false; }
  const shape = Array.isArray(j) ? `array[${j.length}]` : `object {${Object.keys(j).slice(0, 12).join(", ")}}`;
  console.log(`      JSON ${shape}\n      ${body.slice(0, 700).replace(/\s+/g, " ")}`);
  return true;
}

for (const { url, dump, grep, at, pattern, len = 6000 } of jobs) {
  try {
    const body = await fetchText(url, { retries: 0, headers: { Accept: FEED_ACCEPT } });
    if (grep) {
      const hits = [...body.matchAll(new RegExp(pattern, "gi"))].slice(0, 60);
      console.log(`GREP  ${url} (${body.length} bytes, ${hits.length} matches of /${pattern}/)`);
      for (const h of hits) console.log(`      ${decodeEntities(body.slice(h.index, h.index + Number(len === 6000 ? 220 : len))).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")}`);
      continue;
    }
    if (dump) {
      const start = at ? Math.max(0, body.search(new RegExp(at, "i"))) : 0;
      console.log(`DUMP  ${url} (${body.length} bytes, from ${start})\n${body.slice(start, start + Number(len))}\nEND DUMP`);
      continue;
    }
    const items = parseRss(body, "probe");
    if (!items.length && describeJson(body)) { console.log(`OK    ${url} (JSON above)`); continue; }
    const newest = items.map((it) => it.date).filter(Boolean).sort().at(-1)?.slice(0, 10) ?? "-";
    const recent = items.filter((it) => it.date && it.date >= since);
    const onTopic = recent.filter((it) => findKeyword(`${it.title} ${it.summary}`, keywords));
    const cats = [...new Set(items.flatMap((it) => it.categories))].slice(0, 12).join(" | ");
    console.log(`OK    ${url}\n      ${items.length} items · newest ${newest} · ${recent.length} in 30 days, ${onTopic.length} name a benefits keyword${cats ? ` · categories: ${cats}` : ""}`);
    if (!items.length) {
      if (/<html|<!doctype html/i.test(body.slice(0, 2000))) describeHtml(url, body);
      else console.log(`      body starts: ${body.slice(0, 300).replace(/\s+/g, " ")}`);
    }
    for (const it of items.slice(0, 6)) console.log(`      ${it.date?.slice(0, 10) ?? "undated   "}  ${findKeyword(`${it.title} ${it.summary}`, keywords) ? "+" : " "} ${it.title.slice(0, 120)}`);
  } catch (e) {
    console.log(`FAIL  ${url}\n      ${e.message}`);
  }
}
