/**
 * The human-facing collated feed: what reaches Outlook and how it looks.
 *
 * keepForFeed() applies spec/feed-filter.yaml (the store keeps everything;
 * only the feed is filtered). renderItemHtml() renders one item in the
 * prototype's palette using inline styles and a table, which is what
 * Outlook Classic's HTML engine reliably honours: no external CSS, no web
 * fonts, no div margins.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseYaml } from "./yaml.mjs";
import { ROOT } from "./sources.mjs";

export async function loadFeedRules(file = path.join(ROOT, "spec", "feed-filter.yaml")) {
  return parseYaml(await readFile(file, "utf8")) ?? {};
}

const has = (hay, needle) => String(hay ?? "").toLowerCase().includes(String(needle).toLowerCase());

/** Decide whether a collected item reaches the feed. Returns { keep, why }. */
export function keepForFeed(item, rules = {}, sourceId = null) {
  const src = rules.sources?.[sourceId ?? item.source_id ?? ""] ?? null;
  if (src?.drop_categories?.length) {
    const hit = (item.categories ?? []).find((c) => src.drop_categories.some((d) => has(c, d)));
    if (hit) return { keep: false, why: `category ${hit}` };
  }
  if (!/^Federal Register/.test(item.source)) return { keep: true, why: "interpretation or primary source" };
  const fr = rules.federal_register ?? {};
  const type = item.categories?.[0] ?? "";
  const title = item.title ?? "";
  const dropped = (fr.drop_title_patterns ?? []).find((p) => has(title, p));
  if (dropped) return { keep: false, why: `housekeeping: ${dropped}` };
  if ((fr.keep_types ?? []).some((t) => t.toLowerCase() === type.toLowerCase())) return { keep: true, why: `type ${type}` };
  if ((fr.keep_notice_agencies ?? []).some((a) => has(item.source, a))) return { keep: true, why: "agency" };
  const text = `${title} ${item.summary ?? ""}`;
  const kw = (fr.notice_keywords ?? []).find((k) => has(text, k));
  if (kw) return { keep: true, why: `keyword ${kw}` };
  if (item.structured?.comments_close_on && /^(Rule|Proposed Rule)/i.test(type)) return { keep: true, why: "comment deadline" };
  return { keep: false, why: `${type || "document"} without a benefits keyword` };
}

// ---------- presentation ----------

const P = { ink: "#0b1b43", text: "#20232b", muted: "#686761", rust: "#a62d16", rule: "#d8d3c9", paper: "#fbfaf7", detail: "#f3efe7" };
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const longDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");

/** Kicker text: source, plus the document type or first category when it says something. */
export function kicker(item) {
  const source = String(item.source).replace(/ — .*/, "");
  const type = item.categories?.[0];
  const useful = type && !/^(Uncategorized|Publications|Passle Post)$/i.test(type) && !source.toLowerCase().includes(type.toLowerCase());
  return useful ? `${source} · ${type}` : source;
}

/** Status line: the structured dates the collector kept, written for a reader. */
export function statusLine(item) {
  const s = item.structured ?? {};
  const parts = [];
  if (item.date) parts.push(longDate(item.date));
  if (s.comments_close_on) parts.push(`Comments close ${longDate(`${s.comments_close_on}T12:00:00Z`)}`);
  if (s.effective_on) parts.push(`Effective ${longDate(`${s.effective_on}T12:00:00Z`)}`);
  if (s.meeting_date) parts.push(`Meeting ${longDate(`${s.meeting_date}T12:00:00Z`)}`);
  if (s.docket_number) parts.push(`No. ${s.docket_number}`);
  return parts.join(" · ");
}

/** Body text without the source's boilerplate tail and structured-field prefix the collector added. */
export function cleanSummary(item) {
  let s = String(item.summary ?? "");
  s = s.replace(/\s*The post .*? appeared first on .*?\.?\s*$/i, "");
  s = s.replace(/^(Rule|Proposed Rule|Notice|Presidential Document)( · Comments close \d{4}-\d{2}-\d{2})?( · Effective \d{4}-\d{2}-\d{2})? — /, "");
  s = s.replace(/^\d{1,2}:\d{2} (a\.m\.|p\.m\.|am|pm) · /i, "");
  return s.trim();
}

export function renderItemHtml(item) {
  const source = String(item.source).replace(/ — .*/, "");
  const body = cleanSummary(item);
  const status = statusLine(item);
  const cell = (style, inner) => `<tr><td style="${style}">${inner}</td></tr>`;
  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:${P.paper};">`,
    cell(`padding:22px 24px 0 24px;font-family:${SANS};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${P.rust};`, esc(kicker(item))),
    cell(`padding:10px 24px 0 24px;font-family:${SERIF};font-size:24px;line-height:1.25;color:${P.ink};`, esc(item.title)),
    status ? cell(`padding:8px 24px 0 24px;font-family:${SANS};font-size:13px;color:${P.muted};`, esc(status)) : "",
    body ? cell(`padding:16px 24px 0 24px;font-family:${SANS};font-size:15px;line-height:1.6;color:${P.text};`, esc(body)) : "",
    cell(`padding:18px 24px 0 24px;font-family:${SANS};font-size:14px;`, `<a href="${esc(item.link)}" style="color:${P.ink};text-decoration:underline;">Read at ${esc(source)}</a>`),
    cell(`padding:22px 24px 22px 24px;`, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${P.rule};padding-top:12px;font-family:${SANS};font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${P.muted};">Benefits Signal · collected source · not legal advice</td></tr></table>`),
    `</table>`,
  ].filter(Boolean).join("\n");
}
