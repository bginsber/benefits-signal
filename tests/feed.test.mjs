import assert from "node:assert/strict";
import test from "node:test";
import { cleanSummary, keepForFeed, kicker, loadFeedRules, renderItemHtml, statusLine } from "../scripts/lib/feed.mjs";

const rules = await loadFeedRules();
const fr = (title, type, extra = {}) => ({ source: "Federal Register — Health and Human Services Department", title, categories: [type], summary: "", ...extra });

test("feed filter keeps rules, EBSA notices, and keyword notices; drops housekeeping and unrelated notices", () => {
  assert.equal(keepForFeed(fr("Requirements Related to Surprise Billing", "Proposed Rule"), rules).keep, true);
  assert.equal(keepForFeed(fr("Agency Information Collection Activities: Comment Request", "Notice"), rules).keep, false);
  assert.equal(keepForFeed(fr("Prospective Grant of an Exclusive Patent License", "Notice"), rules).keep, false);
  assert.equal(keepForFeed(fr("Pharmacokinetics in Patients With Impaired Hepatic Function", "Notice"), rules).keep, false);
  assert.equal(keepForFeed(fr("Request for Information on Mental Health Parity Comparative Analyses", "Notice"), rules).keep, true);
  assert.equal(keepForFeed({ source: "Federal Register — Employee Benefits Security Administration", title: "Proposed Exemption Involving XYZ", categories: ["Notice"] }, rules).keep, true);
  // An information-collection notice is dropped even when it mentions a keyword.
  assert.equal(keepForFeed(fr("Agency Information Collection Activities; Comment Request on Form 5500", "Notice"), rules).keep, false);
});

test("feed filter drops firm news and events by category and leaves other sources alone", () => {
  assert.equal(keepForFeed({ source: "Groom Law Group", title: "Best Lawyers", categories: ["News"] }, rules, "groom").keep, false);
  assert.equal(keepForFeed({ source: "Groom Law Group", title: "Symposium", categories: ["Events"] }, rules, "groom").keep, false);
  assert.equal(keepForFeed({ source: "Groom Law Group", title: "IRS Issues New Guidance", categories: ["Publications"] }, rules, "groom").keep, true);
  assert.equal(keepForFeed({ source: "Word on Benefits (IFEBP)", title: "Grief Awareness", categories: ["Canada", "Employee Assistance"] }, rules, "ifebp").keep, false);
  assert.equal(keepForFeed({ source: "CourtListener API", title: "Liu v. Kaiser", categories: ["Opinion"] }, rules, "courtlistener").keep, true);
});

test("item HTML carries the prototype palette inline, the title, status, cleaned body, and a source link", () => {
  const item = { source: "Federal Register — Employee Benefits Security Administration", title: "Cybersecurity Program Requirements", link: "https://www.federalregister.gov/d/2026-0412", date: "2026-08-20T12:00:00.000Z", categories: ["Proposed Rule"], summary: "Proposed Rule · Comments close 2026-09-30 — Would require a written program. The post X appeared first on Y.", structured: { comments_close_on: "2026-09-30", effective_on: null } };
  assert.equal(kicker(item), "Federal Register · Proposed Rule");
  assert.equal(kicker({ source: "Segal Compliance News", categories: ["Compliance News"] }), "Segal Compliance News", "no repeated category");
  assert.equal(statusLine(item), "August 20, 2026 · Comments close September 30, 2026");
  assert.equal(cleanSummary(item), "Would require a written program.");
  const html = renderItemHtml(item);
  assert.match(html, /<table role="presentation"/);
  assert.match(html, /color:#a62d16/, "rust kicker");
  assert.match(html, /Georgia, 'Times New Roman', serif;font-size:24px;line-height:1.25;color:#0b1b43;">Cybersecurity Program Requirements</);
  assert.match(html, /Read at Federal Register<\/a>/);
  assert.doesNotMatch(html, /appeared first on/);
  assert.doesNotMatch(html, /<style|<link|class=/, "inline styles only");
  const das = { source: "California DAS / DIR / CAC", title: "Forum — August 12, 2026", link: "https://x", date: "2026-08-12T12:00:00.000Z", categories: ["Meeting notice"], summary: "9:00 am · Notice / Agenda", structured: { meeting_date: "2026-08-12", documents: [] } };
  assert.equal(cleanSummary(das), "Notice / Agenda");
  assert.equal(statusLine(das), "August 12, 2026 · Meeting August 12, 2026");
});
