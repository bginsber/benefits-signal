/**
 * Source collectors (spec § 6.1). Zero dependencies, Node 18+.
 *
 * Every collector produces the same document shape that data/collected/
 * stores: { source, title, link, date, summary, categories, structured? }.
 * Parsers are pure functions over fetched text so they can be tested against
 * saved fixtures; fetchers are thin and retry only on transient failures.
 */

export const UA = "BenefitsSignalCollector/0.1 (internal legal newsletter pilot)";
const RETRYABLE = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

/** Fetch text with bounded retry-and-backoff on transient statuses and network errors. */
export async function fetchText(url, { headers = {}, method = "GET", body, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1000 * 3 ** (attempt - 1)));
    try {
      const res = await fetch(url, { method, body, headers: { "User-Agent": UA, Accept: "*/*", ...headers }, redirect: "follow" });
      if (res.ok) return res.text();
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

/** "August 18, 2026" or "2026-08-18" → ISO at noon UTC, or null. */
export function toISODate(s) {
  if (!s) return null;
  const t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t}T12:00:00.000Z`;
  const d = new Date(t.replace(/,/g, "") + " 12:00:00 UTC");
  return isNaN(d) ? null : d.toISOString();
}

// ---------- RSS (interpretation sources) ----------

export function parseRss(xml, sourceName) {
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

export function parseCourtListener(json, sourceName) {
  return (json.results ?? []).map((r) => {
    const op = r.opinions?.[0] ?? {};
    const snippet = (op.snippet ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
    const head = [r.court_citation_string, r.docketNumber ? `No. ${r.docketNumber}` : null, r.dateFiled ? `filed ${r.dateFiled}` : null]
      .filter(Boolean).join(" · ");
    return {
      source: sourceName,
      title: r.caseName,
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

export async function fetchCourtListener(source, sinceISO) {
  const params = new URLSearchParams({ q: source.query, type: "o", court: source.court ?? "ca9", order_by: "dateFiled desc", filed_after: sinceISO });
  const headers = { Accept: "application/json" };
  if (process.env.COURTLISTENER_TOKEN) headers.Authorization = `Token ${process.env.COURTLISTENER_TOKEN}`;
  let url = `${source.url}?${params}`;
  const items = [];
  for (let page = 0; url && page < 3; page++) {
    const json = JSON.parse(await fetchText(url, { headers }));
    items.push(...parseCourtListener(json, source.name));
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

// ---------- dispatch ----------

/** Collect one source by resolved kind. Returns items within the window (date >= since, or undated). */
export async function collectSource(source, kind, { since, sinceISO }) {
  const inWindow = (list) => list.filter((it) => !it.date || new Date(it.date) >= since);
  switch (kind) {
    case "rss": return inWindow(parseRss(await fetchText(source.url), source.name));
    case "federal-register": return fetchFederalRegister(sinceISO, source.agencies);
    case "courtlistener": return inWindow(await fetchCourtListener(source, sinceISO));
    case "segal-insights": return inWindow(await fetchSegal(source));
    case "mercer-search": return inWindow(await fetchMercer(source));
    case "ca-das": return inWindow(await fetchDas(source));
    default: throw new Error(`no collector for kind ${kind}`);
  }
}
