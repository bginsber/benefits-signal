#!/usr/bin/env node
/**
 * Benefits Signal — Phase 0 collector (spec § 6.1)
 *
 * Zero-dependency Node 18+ script. Pulls the verified RSS interpretation
 * sources and the Federal Register API primary channel, stores raw documents
 * idempotently under data/collected/, and emits:
 *
 *   public/collated.xml  — one merged RSS 2.0 feed (Outlook Classic readable)
 *   data/run-log.json    — per-source outcome for the "source silent" notice
 *
 * Source of truth for the source list is spec/sources.yaml; the subset
 * collected here (rss + federal-register methods) is mirrored below.
 * Scrape/JS/email sources (Mercer, Segal, EBIA, dol.gov, hhs.gov) are
 * Phase 0 follow-ups and are intentionally absent.
 *
 * Usage: node scripts/collect.mjs [--days 30] [--out public/collated.xml]
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DATA_DIR = path.join(ROOT, "data", "collected");
const args = process.argv.slice(2);
const DAYS = Number(args[args.indexOf("--days") + 1]) > 0 && args.includes("--days")
  ? Number(args[args.indexOf("--days") + 1]) : 30;
const OUT = args.includes("--out")
  ? path.resolve(ROOT, args[args.indexOf("--out") + 1])
  : path.join(ROOT, "public", "collated.xml");

const UA = "BenefitsSignalCollector/0.1 (internal legal newsletter pilot)";

const RSS_SOURCES = [
  { id: "groom",       name: "Groom Law Group",              url: "https://www.groom.com/feed/" },
  { id: "truckerhuss", name: "Trucker Huss Benefits Report", url: "https://www.truckerhuss.com/feed/" },
  { id: "wagner",      name: "Wagner Law Group",             url: "https://www.wagnerlawgroup.com/feed/" },
  { id: "ifebp",       name: "Word on Benefits (IFEBP)",     url: "https://blog.ifebp.org/feed/" },
];

// Verified agency slugs (spec § 4). One API call covers them all.
const FR_AGENCIES = [
  "employee-benefits-security-administration",
  "internal-revenue-service",
  "employment-and-training-administration",
  "wage-and-hour-division",
  "health-and-human-services-department",
  "centers-for-medicare-medicaid-services",
];

// ---------- helpers ----------

const sha1 = (s) => createHash("sha1").update(s).digest("hex");
const esc = (s = "") => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function decodeEntities(s = "") {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8220;|&ldquo;/g, "“").replace(/&#8221;|&rdquo;/g, "”")
    .replace(/&nbsp;/g, " ");
}

const stripTags = (s = "") => decodeEntities(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1].trim() : "";
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "*/*" }, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Parse a WordPress-style RSS 2.0 feed into items. */
function parseRss(xml, sourceName) {
  const items = [];
  for (const m of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)) {
    const block = m[1];
    const link = decodeEntities(tag(block, "link")) || (block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1] ?? "").trim();
    const title = stripTags(tag(block, "title"));
    const pub = tag(block, "pubDate");
    const date = pub ? new Date(pub) : null;
    const desc = stripTags(tag(block, "description")).slice(0, 600);
    const cats = [...block.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)].map((c) => stripTags(c[1]));
    if (!title || !link) continue;
    items.push({ source: sourceName, title, link, date: date && !isNaN(date) ? date.toISOString() : null, summary: desc, categories: cats });
  }
  return items;
}

async function fetchFederalRegister(sinceISO) {
  const fields = ["title", "html_url", "publication_date", "agency_names", "type", "abstract", "comment_url", "comments_close_on", "effective_on", "document_number"];
  const params = new URLSearchParams();
  for (const a of FR_AGENCIES) params.append("conditions[agencies][]", a);
  params.append("conditions[publication_date][gte]", sinceISO);
  params.append("per_page", "100");
  params.append("order", "newest");
  for (const f of fields) params.append("fields[]", f);
  let url = `https://www.federalregister.gov/api/v1/documents.json?${params}`;
  const items = [];
  for (let page = 0; url && page < 5; page++) {
    const json = JSON.parse(await fetchText(url));
    for (const d of json.results ?? []) {
      const extras = [
        d.type,
        d.comments_close_on ? `Comments close ${d.comments_close_on}` : null,
        d.effective_on ? `Effective ${d.effective_on}` : null,
      ].filter(Boolean).join(" · ");
      items.push({
        source: `Federal Register — ${(d.agency_names ?? []).join(", ")}`,
        title: d.title,
        link: d.html_url,
        date: d.publication_date ? new Date(`${d.publication_date}T12:00:00Z`).toISOString() : null,
        summary: [extras, d.abstract ?? ""].filter(Boolean).join(" — ").slice(0, 600),
        categories: [d.type].filter(Boolean),
        structured: { document_number: d.document_number, comments_close_on: d.comments_close_on, effective_on: d.effective_on },
      });
    }
    url = json.next_page_url ? `${json.next_page_url}&${fields.map((f) => `fields[]=${f}`).join("&")}` : null;
  }
  return items;
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

function buildRss(items) {
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
    <description>Merged raw intake: Groom, Trucker Huss, Wagner Law Group, Word on Benefits, and Federal Register (EBSA, IRS, ETA, WHD, HHS, CMS). Pre-triage material for the Benefits Signal pipeline; not legal advice.</description>
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

for (const src of RSS_SOURCES) {
  try {
    const xml = await fetchText(src.url);
    const items = parseRss(xml, src.name).filter((it) => !it.date || new Date(it.date) >= since);
    all.push(...items);
    runLog.push({ source: src.name, ok: true, items: items.length });
    console.log(`ok   ${src.name}: ${items.length} items`);
  } catch (e) {
    runLog.push({ source: src.name, ok: false, error: String(e.message ?? e) });
    console.error(`FAIL ${src.name}: ${e.message}`);
  }
}

try {
  const fr = await fetchFederalRegister(sinceISO);
  all.push(...fr);
  runLog.push({ source: "Federal Register API", ok: true, items: fr.length });
  console.log(`ok   Federal Register API: ${fr.length} documents`);
} catch (e) {
  runLog.push({ source: "Federal Register API", ok: false, error: String(e.message ?? e) });
  console.error(`FAIL Federal Register API: ${e.message}`);
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
await writeFile(OUT, buildRss(feedItems.slice(0, 100)));
await mkdir(path.join(ROOT, "data"), { recursive: true });
await writeFile(path.join(ROOT, "data", "run-log.json"),
  JSON.stringify({ ran_at: new Date().toISOString(), window_days: DAYS, total_items: all.length, newly_stored: stored, sources: runLog }, null, 2));

console.log(`\n${all.length} unique items in window (${stored} newly stored) → ${path.relative(ROOT, OUT)}`);
if (runLog.some((r) => !r.ok)) process.exitCode = 1;
