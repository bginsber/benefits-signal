/**
 * Source collectors (spec § 6.1). Zero dependencies, Node 18+.
 *
 * Every collector produces the same document shape that data/collected/
 * stores: { source, title, link, date, summary, categories, structured? }.
 * Parsers are pure functions over fetched text so they can be tested against
 * saved fixtures; fetchers are thin and retry only on transient failures.
 */

export const UA = "BenefitsSignalCollector/0.1 (internal legal newsletter pilot)";
/** Some feed hosts (GovDelivery) answer 406 unless the client asks for a feed type. */
export const FEED_ACCEPT = "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8";
const RETRYABLE = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

/** Fetch text with a per-attempt timeout and bounded retry-and-backoff on transient statuses and network errors. */
export async function fetchText(url, { headers = {}, method = "GET", body, retries = 2, timeoutMs = 45000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1000 * 3 ** (attempt - 1)));
    try {
      // The timeout covers the body too: a host that stalls mid-response must not hang the run.
      const signal = AbortSignal.timeout(timeoutMs);
      const res = await fetch(url, { method, body, headers: { "User-Agent": UA, Accept: "*/*", ...headers }, redirect: "follow", signal });
      if (res.ok) return await res.text();
      lastErr = new Error(`HTTP ${res.status}`);
      if (!RETRYABLE.has(res.status)) throw lastErr;
    } catch (e) {
      if (e === lastErr) throw e;
      lastErr = e; // network-level failure: retry
    }
  }
  throw lastErr;
}

// ---------- text helpers ----------

export function decodeEntities(s = "") {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8220;|&ldquo;/g, "“").replace(/&#8221;|&rdquo;/g, "”")
    .replace(/&nbsp;/g, " ");
}

export const stripTags = (s = "") => decodeEntities(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1].trim() : "";
}

/** "August 18, 2026", "Sept. 18, 2026", or "2026-08-18" → ISO at noon UTC, or null. */
export function toISODate(s) {
  if (!s) return null;
  const t = decodeEntities(String(s)).replace(/\bSept\b\.?/i, "Sep").replace(/\s+/g, " ").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t}T12:00:00.000Z`;
  const d = new Date(t.replace(/,/g, "") + " 12:00:00 UTC");
  return isNaN(d) ? null : d.toISOString();
}

// ---------- RSS and Atom feeds ----------

/** RSS 2.0 / RSS 1.0 (RDF) items, or Atom entries when the document has no <item>. */
export function parseRss(xml, sourceName) {
  if (!/<item[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml)) return parseAtom(xml, sourceName);
  const items = [];
  for (const m of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)) {
    const block = m[1];
    const link = decodeEntities(tag(block, "link")) || (block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1] ?? "").trim();
    const title = stripTags(tag(block, "title"));
    const pub = tag(block, "pubDate") || tag(block, "dc:date");
    const date = pub ? new Date(pub) : null;
    const desc = stripTags(tag(block, "description")).slice(0, 600);
    const cats = [...block.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)].map((c) => stripTags(c[1]));
    if (!title || !link) continue;
    items.push({ source: sourceName, title, link, date: date && !isNaN(date) ? date.toISOString() : null, summary: desc, categories: cats });
  }
  return items;
}

const attr = (el, name) => decodeEntities(el.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"))?.slice(2).find((v) => v != null) ?? "");

/** Text of an Atom text construct; type="html" content is escaped HTML, so it is unescaped once more before tags are stripped. */
function atomText(block, name) {
  const m = block.match(new RegExp(`<${name}(\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return "";
  return stripTags(/type\s*=\s*["']html["']/i.test(m[1] ?? "") ? decodeEntities(m[2]) : m[2]);
}

/** Atom 1.0 entries: alternate link href, published (else updated) date, summary (else content), category terms. */
export function parseAtom(xml, sourceName) {
  const items = [];
  for (const m of xml.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/gi)) {
    const block = m[1];
    const links = [...block.matchAll(/<link\b[^>]*>/gi)].map((l) => l[0]);
    const alt = links.find((l) => !/\srel\s*=/i.test(l) || /\srel\s*=\s*["']alternate["']/i.test(l)) ?? links[0];
    const link = alt ? attr(alt, "href") : "";
    const title = atomText(block, "title");
    const pub = tag(block, "published") || tag(block, "updated");
    const date = pub ? new Date(pub) : null;
    const desc = (atomText(block, "summary") || atomText(block, "content")).slice(0, 600);
    const cats = [...block.matchAll(/<category\b[^>]*>/gi)].map((c) => attr(c[0], "label") || attr(c[0], "term")).filter(Boolean);
    if (!title || !link) continue;
    items.push({ source: sourceName, title, link, date: date && !isNaN(date) ? date.toISOString() : null, summary: desc, categories: cats });
  }
  return items;
}

// ---------- Federal Register API (primary) ----------

export async function fetchFederalRegister(sinceISO, agencies) {
  const fields = ["title", "html_url", "publication_date", "agency_names", "type", "abstract", "comment_url", "comments_close_on", "effective_on", "document_number"];
  const params = new URLSearchParams();
  for (const a of agencies) params.append("conditions[agencies][]", a);
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

// ---------- CourtListener v4 opinion search (primary, Ninth Circuit) ----------

/**
 * Some clusters carry a truncated short name ("E.") and an empty full name;
 * the opinion's first page then gives the caption on the line after the docket number.
 */
function caseTitle(r, op) {
  const name = String(r.caseName ?? "").trim();
  if (name.length > 4) return name;
  const fromSnippet = String(op.snippet ?? "").split("\n").map((l) => l.trim()).find((l) => / v\. /.test(l));
  return r.caseNameFull || fromSnippet || name;
}

export function parseCourtListener(json, sourceName) {
  return (json.results ?? []).map((r) => {
    const op = r.opinions?.[0] ?? {};
    const snippet = (op.snippet ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
    const head = [r.court_citation_string, r.docketNumber ? `No. ${r.docketNumber}` : null, r.dateFiled ? `filed ${r.dateFiled}` : null]
      .filter(Boolean).join(" · ");
    return {
      source: sourceName,
      title: caseTitle(r, op),
      link: `https://www.courtlistener.com${r.absolute_url}`,
      date: toISODate(r.dateFiled),
      summary: [head, snippet].filter(Boolean).join(" — ").slice(0, 600),
      categories: ["Opinion"],
      structured: {
        docket_number: r.docketNumber, date_filed: r.dateFiled, cluster_id: r.cluster_id,
        court: r.court_id, citation: r.citation ?? [], download_url: op.download_url ?? null,
      },
    };
  });
}

/** Rulings, not filings: the docket entries a reader would want to open. */
const DECISIONAL = /\b(order|judgment|findings|opinion|recommendation)/i;
const PROCEDURAL = /\b(protective|stipulat|proposed|scheduling|pretrial|writ|pro hac|seal|continu|extend|extension|reassign|refer|transfer|mediation|settlement conference|minute order setting|notice)/i;
const ERISA_DOCKET = /E\.?R\.?I\.?S\.?A|Employee Retirement Income Security/i;

/**
 * CourtListener RECAP search (type=r): district-court dockets with their matching documents.
 * CourtListener's opinion collection for district courts is sparse, so rulings are read from
 * RECAP instead: one item per main (non-attachment) document that is an order, judgment, or
 * findings, on a docket whose nature of suit or cause is ERISA.
 */
export function parseCourtListenerRecap(json, sourceName) {
  const items = [];
  for (const r of json.results ?? []) {
    if (!ERISA_DOCKET.test(`${r.suitNature ?? ""} ${r.cause ?? ""}`)) continue;
    for (const d of r.recap_documents ?? []) {
      const label = String(d.short_description ?? "").trim();
      const desc = String(d.description ?? "").replace(/\s+/g, " ").trim();
      if (d.attachment_number || d.document_type === "Attachment") continue;
      if (!DECISIONAL.test(label || desc) || PROCEDURAL.test(label || desc)) continue;
      const head = [r.court_citation_string, r.docketNumber ? `No. ${r.docketNumber}` : null, d.entry_date_filed ? `entered ${d.entry_date_filed}` : null]
        .filter(Boolean).join(" · ");
      items.push({
        source: sourceName,
        title: `${r.caseName} — ${label || "Order"}`,
        link: `https://www.courtlistener.com${d.absolute_url}`,
        date: toISODate(d.entry_date_filed),
        summary: [head, decodeEntities(desc)].filter(Boolean).join(" — ").slice(0, 600),
        categories: [label || "Order"],
        structured: {
          docket_number: r.docketNumber, date_filed: d.entry_date_filed, court: r.court_id, docket_id: r.docket_id,
          download_url: d.filepath_local ? `https://storage.courtlistener.com/${d.filepath_local}` : null,
        },
      });
    }
  }
  return items;
}

export async function fetchCourtListener(source, sinceISO) {
  const recap = source.search_type === "r";
  const params = recap
    ? new URLSearchParams({ q: source.query, type: "r", court: source.court, order_by: "entry_date_filed desc", entry_date_filed_after: sinceISO })
    : new URLSearchParams({ q: source.query, type: "o", court: source.court ?? "ca9", order_by: "dateFiled desc", filed_after: sinceISO });
  const headers = { Accept: "application/json" };
  if (process.env.COURTLISTENER_TOKEN) headers.Authorization = `Token ${process.env.COURTLISTENER_TOKEN}`;
  let url = `${source.url}?${params}`;
  const items = [];
  for (let page = 0; url && page < 3; page++) {
    const json = JSON.parse(await fetchText(url, { headers }));
    items.push(...(recap ? parseCourtListenerRecap(json, source.name) : parseCourtListener(json, source.name)));
    url = json.next ?? null;
  }
  return items;
}

// ---------- Segal Compliance News (interpretation; Umbraco insights JSON) ----------

export function parseSegalInsights(list, sourceName, base = "https://www.segalco.com") {
  return (Array.isArray(list) ? list : []).filter((x) => x.Name && x.InsightUrl).map((x) => ({
    source: sourceName,
    title: stripTags(x.Name),
    link: new URL(x.InsightUrl, base).href,
    date: toISODate(x.InsightDate),
    summary: stripTags(x.Teaser ?? "").slice(0, 600),
    categories: [x.InsightCat, ...String(x.FooterTags ?? "").split(",").map((t) => t.trim())].filter(Boolean),
  }));
}

export async function fetchSegal(source) {
  const json = JSON.parse(await fetchText(source.api, { headers: { Accept: "application/json" } }));
  return parseSegalInsights(json, source.name);
}

// ---------- Mercer Law & Policy (interpretation; Elastic App Search behind the listing page) ----------

export function parseMercerSearch(json, sourceName, pathPrefix = "/insights/law-and-policy/") {
  const items = [];
  for (const r of json.results ?? []) {
    let card = {};
    try { card = JSON.parse(r.card?.raw ?? "{}"); } catch { /* no card */ }
    const uri = card.uri ?? "";
    const lang = r.language_code?.raw ?? "";
    if (!uri.includes(pathPrefix) || !lang.startsWith("en")) continue;
    const ms = Number(r.publication_date?.raw);
    items.push({
      source: sourceName,
      title: stripTags(r.title?.raw ?? card.title ?? ""),
      link: uri,
      date: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
      summary: stripTags(r.description?.raw ?? card.description ?? "").slice(0, 600),
      categories: [r.template_type?.raw, ...(r.insights?.raw ?? [])].filter(Boolean),
    });
  }
  return items;
}

export async function fetchMercer(source) {
  const url = `${source.search_endpoint}/api/as/v1/engines/${source.search_engine}/search`;
  const body = JSON.stringify({ query: source.query ?? "law and policy", page: { size: 100 }, sort: [{ publication_date: "desc" }] });
  const text = await fetchText(url, {
    method: "POST", body,
    headers: { Authorization: `Bearer ${source.search_key}`, "Content-Type": "application/json", Accept: "application/json" },
  });
  return parseMercerSearch(JSON.parse(text), source.name, source.path_prefix);
}

// ---------- California DAS / DIR / CAC pages (primary; plain HTML) ----------

const MONTH = "(?:January|February|March|April|May|June|July|August|September|October|November|December)";
const LONG_DATE = new RegExp(`${MONTH}\\s+\\d{1,2},?\\s+20\\d\\d`);

export function parseDasPage(html, pageUrl, sourceName) {
  const items = [];
  const abs = (href) => { try { return new URL(decodeEntities(href), pageUrl).href; } catch { return null; } };

  // 1. DIR "What's New" table: <td class="nowrap">DATE</td><td><a href=...>TITLE</a></td>
  for (const m of html.matchAll(/<td class="nowrap">\s*([^<]+?)\s*<\/td>\s*<td>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const link = abs(m[2]);
    if (!link) continue;
    items.push({ source: sourceName, title: stripTags(m[3]), link, date: toISODate(m[1]), summary: "DIR news release", categories: ["DIR news"] });
  }

  // 2. Meeting tables: a "Date:" row sets the date for the rows that follow within the same table.
  let current = null, heading = "Meeting";
  for (const chunk of html.split(/(?=<table|<tr)/i)) {
    const h = [...chunk.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)].pop();
    if (h) heading = stripTags(h[1]) || heading;
    if (/^<table/i.test(chunk)) { current = null; continue; }
    const dateRow = chunk.match(new RegExp(`Date:\\s*<\\/strong>[\\s\\S]*?<strong>\\s*(${MONTH}\\s+\\d{1,2},?\\s+20\\d\\d)`, "i"));
    if (dateRow) { current = dateRow[1]; continue; }
    if (!current) continue;
    const cells = [...chunk.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
    if (cells.length < 2) continue;
    const links = [...cells[1].matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map((a) => ({ href: abs(a[1]), label: stripTags(a[2]) })).filter((a) => a.href);
    if (!links.length) continue;
    const name = stripTags(cells[1].split(/<br\s*\/?>|<a\s/i)[0]) || heading;
    items.push({
      source: sourceName,
      title: `${name} — ${current}`,
      link: links[0].href,
      date: toISODate(current),
      summary: `${stripTags(cells[0])} · ${links.map((l) => l.label).join(" / ")}`,
      categories: ["Meeting notice"],
      structured: { meeting_date: toISODate(current)?.slice(0, 10), documents: links },
    });
  }
  return items;
}

export async function fetchDas(source) {
  const items = [];
  for (const url of source.urls ?? [source.url]) {
    items.push(...parseDasPage(await fetchText(url), url, source.name));
  }
  return items;
}

/**
 * The date an item should sort and publish under: its own date when that is
 * not in the future, otherwise the date it was first collected. A meeting
 * notice for October is news the day it appears, not on the meeting day, so
 * it must not pin itself to the top of the feed until then.
 */
export function displayDate(item, firstSeen = new Map(), now = new Date()) {
  const nowISO = now.toISOString();
  if (item.date && item.date <= nowISO) return item.date;
  const seen = firstSeen.get(item.link);
  return seen && seen <= nowISO ? seen : nowISO;
}

// ---------- regulations.gov comment deadlines (primary) ----------

const REMINDER_DAYS = 14;
const DEADLINE_AGENCIES = { EBSA: "Employee Benefits Security Administration", IRS: "Internal Revenue Service", CMS: "Centers for Medicare & Medicaid Services", HHS: "Health and Human Services Department", ETA: "Employment and Training Administration", WHD: "Wage and Hour Division" };

/**
 * Open comment periods from the regulations.gov v4 documents API, as reminders: each document
 * becomes one item dated two weeks before its comment period closes (or when it was posted, if
 * later), so the deadline reaches the feed while there is still time to comment. The link is the
 * regulations.gov comment page, distinct from the Federal Register item announcing the document.
 */
export function parseRegulationsGov(json, sourceName, now = new Date()) {
  const items = [];
  for (const d of json.data ?? []) {
    const a = d.attributes ?? {};
    if (!a.title || !a.commentEndDate || a.withdrawn) continue;
    const close = new Date(a.commentEndDate);
    // commentEndDate is 11:59 pm Eastern expressed in UTC (next day, 03:59Z); the Eastern date is the deadline.
    const closeDay = new Date(close.getTime() - 5 * 3600000).toISOString().slice(0, 10);
    const remind = new Date(Math.max(close.getTime() - REMINDER_DAYS * 86400000, a.postedDate ? new Date(a.postedDate).getTime() : 0));
    if (remind > now) continue; // not yet within two weeks of the deadline
    const agency = DEADLINE_AGENCIES[a.agencyId] ?? a.agencyId;
    items.push({
      source: sourceName,
      title: `Comments due ${longMonthDay(closeDay)}: ${stripTags(a.title)}`,
      link: `https://www.regulations.gov/document/${d.id}`,
      date: remind.toISOString(),
      summary: [agency, a.subtype || a.documentType, `docket ${a.docketId}`, a.frDocNum ? `FR Doc. ${a.frDocNum}` : null].filter(Boolean).join(" · "),
      categories: [a.documentType].filter(Boolean),
      structured: { comments_close_on: closeDay, docket_id: a.docketId, fr_doc_num: a.frDocNum ?? null },
    });
  }
  return items;
}

const longMonthDay = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

export async function fetchRegulationsGov(source, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + REMINDER_DAYS * 86400000).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    "filter[agencyId]": (source.agencies ?? ["EBSA", "IRS", "CMS"]).join(","),
    "filter[commentEndDate][ge]": today,
    "filter[commentEndDate][le]": horizon,
    sort: "commentEndDate",
    "page[size]": "100",
    api_key: process.env.REGULATIONS_GOV_API_KEY || "DEMO_KEY",
  });
  const json = JSON.parse(await fetchText(`${source.url}/documents?${params}`, { headers: { Accept: "application/json" } }));
  return parseRegulationsGov(json, source.name, now);
}

// ---------- Internal Revenue Bulletin highlights (primary) ----------

const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * The "Highlights of This Issue" synopses of one weekly Internal Revenue Bulletin: one item per
 * notice, revenue procedure, ruling, or regulation, under its section (Employee Plans, Income Tax,
 * Exempt Organizations, ...), linked to its place in the bulletin.
 */
export function parseIrb(html, url, sourceName) {
  const number = html.match(/<h1>\s*Internal Revenue Bulletin:\s*([\d-]+)\s*<\/h1>/i)?.[1];
  const date = toISODate(html.match(/<p class="pubdate">([^<]+)<\/p>/i)?.[1]);
  const start = html.search(/role-highlights/i);
  if (!number || start < 0) return [];
  // The bulletin's table of contents names some items that the highlights list only by number.
  const toc = new Map([...html.slice(0, start).matchAll(/<a href="#([^"]+)"[^>]*>([^<]+)<\/a>/gi)].map((m) => [m[1], stripTags(m[2])]));
  const end = html.indexOf("role-mission", start);
  const part = html.slice(start, end > 0 ? end : undefined);
  const items = [];
  let section = "";
  for (const chunk of part.split(/(?=<h2\b)/i)) {
    const h2 = chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (!h2) continue;
    const anchor = h2[1].match(/href="#([^"]+)"/i)?.[1];
    const label = stripTags(h2[1]).replace(/,\s*page\s+\d+\.?$/i, "").trim();
    if (!anchor) { section = titleCase(label); continue; }
    const synopsis = stripTags([...chunk.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => m[1]).join(" "));
    const named = toc.get(anchor);
    const brief = named && named !== label ? named : synopsis.length > 140 ? `${synopsis.slice(0, 140).replace(/\s+\S*$/, "")}…` : synopsis;
    items.push({
      source: sourceName,
      title: `${label}: ${brief}`,
      link: `${url}#${anchor}`,
      date,
      summary: `IRB ${number} · ${section} — ${synopsis}`.slice(0, 600),
      categories: [section].filter(Boolean),
      structured: { irb: number, document: label },
    });
  }
  return items;
}

/** ISO-week label of a date: IRB numbers follow the ISO week of their Monday publication date (2026-38 = September 14, 2026). */
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const week = Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

export async function fetchIrb(source, since, now = new Date()) {
  const items = [];
  const weeks = new Set();
  for (let d = new Date(since); d <= now; d = new Date(d.getTime() + 7 * 86400000)) weeks.add(isoWeek(d));
  weeks.add(isoWeek(now));
  for (const w of weeks) {
    const url = `https://www.irs.gov/irb/${w}_IRB`;
    try {
      items.push(...parseIrb(await fetchText(url, { retries: 1 }), url, source.name));
    } catch (e) {
      if (!/HTTP 404/.test(e.message)) throw e; // this week's bulletin is not out yet
    }
  }
  return items;
}

// ---------- dated guidance lists (CMS / CCIIO regulations and guidance page) ----------

/**
 * A guidance index page laid out as topic headings over lists of "<li>DATE<br><a>TITLE</a></li>"
 * entries. Each entry becomes an item carrying its topic heading, so the feed filter can keep
 * group-health topics (No Surprises Act, transparency, parity) and drop Marketplace-only ones.
 */
export function parseDatedGuidanceList(html, pageUrl, sourceName) {
  const items = [];
  let heading = "";
  const re = /<h[234][^>]*>([\s\S]*?)<\/h[234]>|<li[^>]*>\s*([^<]{6,40}?)\s*<br\s*\/?>([\s\S]*?)<\/li>/gi;
  for (const m of html.matchAll(re)) {
    if (m[1] != null) { heading = stripTags(m[1]); continue; }
    const date = toISODate(m[2]);
    const a = m[3].match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!date || !a) continue;
    let link;
    try { link = new URL(decodeEntities(a[1]), pageUrl).href; } catch { continue; }
    const note = stripTags(m[3].replace(/<a[\s\S]*?<\/a>/i, " ")).replace(/^\W+|\W+$/g, "");
    items.push({
      source: sourceName,
      title: stripTags(a[2]).replace(/\s*\(PDF\)\s*$/i, ""),
      link,
      date,
      summary: [heading, note].filter(Boolean).join(" — ").slice(0, 600),
      categories: [heading].filter(Boolean),
    });
  }
  return items;
}

export async function fetchDatedGuidanceList(source) {
  return parseDatedGuidanceList(await fetchText(source.url), source.url, source.name);
}

// ---------- feed with a fallback channel ----------

/**
 * A source's own feed, or its fallback feed when the own feed fails (Wagner's site sits behind a
 * bot challenge; a Google News query restricted to its domain lists the same articles). Fallback
 * items lose the channel's title suffix (" - The Wagner Law Group") and are marked "via <channel>".
 */
export async function fetchFeedWithFallback(source, fetcher = fetchText) {
  const get = (url) => fetcher(url, { headers: { Accept: FEED_ACCEPT } });
  try {
    return parseRss(await get(source.url), source.name);
  } catch (e) {
    if (!source.fallback_url) throw e;
    const items = parseRss(await get(source.fallback_url), source.name);
    const suffix = source.fallback_title_suffix;
    console.log(`note ${source.name}: own feed failed (${e.message}); ${items.length} items from fallback`);
    return items.map((it) => ({
      ...it,
      title: suffix && it.title.endsWith(suffix) ? it.title.slice(0, -suffix.length).trim() : it.title,
      summary: "",
      categories: [`via ${source.fallback_label ?? "fallback feed"}`],
    }));
  }
}

// ---------- dispatch ----------

/** Collect one source by resolved kind. Returns items within the window (date >= since, or undated). */
export async function collectSource(source, kind, { since, sinceISO }) {
  const inWindow = (list) => list.filter((it) => !it.date || new Date(it.date) >= since);
  switch (kind) {
    case "rss": return inWindow(await fetchFeedWithFallback(source));
    case "federal-register": return fetchFederalRegister(sinceISO, source.agencies);
    case "courtlistener": return inWindow(await fetchCourtListener(source, sinceISO));
    case "segal-insights": return inWindow(await fetchSegal(source));
    case "mercer-search": return inWindow(await fetchMercer(source));
    case "ca-das": return inWindow(await fetchDas(source));
    case "regulations-gov": return inWindow(await fetchRegulationsGov(source));
    case "irb": return inWindow(await fetchIrb(source, since));
    case "dated-list": return inWindow(await fetchDatedGuidanceList(source));
    default: throw new Error(`no collector for kind ${kind}`);
  }
}
