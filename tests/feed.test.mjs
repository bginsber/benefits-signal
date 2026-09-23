import assert from "node:assert/strict";
import test from "node:test";
import { cleanSummary, findKeyword, keepForFeed, kicker, loadFeedRules, renderItemHtml, statusLine } from "../scripts/lib/feed.mjs";

const rules = await loadFeedRules();
const fr = (title, type, extra = {}) => ({ source: "Federal Register — Health and Human Services Department", title, categories: [type], summary: "", ...extra });

test("feed filter keeps rules, EBSA notices, and keyword notices; drops housekeeping and unrelated notices", () => {
  assert.equal(keepForFeed(fr("Requirements Related to Surprise Billing", "Proposed Rule"), rules).keep, true);
  assert.equal(keepForFeed(fr("Agency Information Collection Activities: Comment Request", "Notice"), rules).keep, false);
  assert.equal(keepForFeed(fr("Prospective Grant of an Exclusive Patent License", "Notice"), rules).keep, false);
  assert.equal(keepForFeed(fr("Pharmacokinetics in Patients With Impaired Hepatic Function", "Notice"), rules).keep, false);
  assert.equal(keepForFeed(fr("Request for Information on Mental Health Parity Comparative Analyses", "Notice"), rules).keep, true);
  const ebsa = (title, summary = "") => keepForFeed({ source: "Federal Register — Employee Benefits Security Administration", title, summary, categories: ["Notice"] }, rules).keep;
  assert.equal(ebsa("Exemption Involving the Abiomed Retirement Savings Plan Located in Danvers, MA", "This document contains a final exemption from certain prohibited transaction restrictions."), false, "a single company's 401(k) exemption stays out");
  assert.equal(ebsa("Proposed Exemption Involving XYZ"), false);
  assert.equal(ebsa("Exemption Involving the Operating Engineers Local 12 Health and Welfare Fund"), true, "a union health and welfare fund's exemption reaches the feed");
  assert.equal(ebsa("Proposed Exemptions From Certain Prohibited Transaction Restrictions", "Involving the Carpenters Multiemployer Pension Trust Fund"), true);
  assert.equal(ebsa("Proposed Class Exemption for Pooled Employer Plans"), true, "class exemptions are not individual exemptions");
  assert.equal(ebsa("Improving Transparency Into Fees for Welfare Plans"), true, "other EBSA documents still always reach the feed");
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

test("keywords match whole-word starts, so rules from HHS and IRS need a benefits topic to reach the feed", () => {
  const order = fr("Order Continuing the Suspension of the Right To Introduce Certain Persons", "Rule");
  assert.equal(keepForFeed(order, rules).keep, false, "'pension' must not match inside 'suspension'");
  assert.equal(keepForFeed(fr("Medical Devices; Cardiovascular Devices; Classification", "Rule", { summary: "FDA is classifying a device." }), rules).keep, false);
  assert.equal(keepForFeed({ source: "Federal Register — Internal Revenue Service", title: "Car Loan Interest Deduction", categories: ["Proposed Rule"], summary: "" }, rules).keep, false);
  assert.equal(keepForFeed(fr("Federal Independent Dispute Resolution Operations; Correction", "Rule"), rules).keep, true);
  assert.equal(keepForFeed({ source: "Federal Register — Internal Revenue Service", title: "Nondiscrimination Rules", categories: ["Proposed Rule"], summary: "Rules for dependent care assistance programs." }, rules).keep, true);
  assert.equal(findKeyword("Multiemployer pensions", ["pension"]), "pension");
});

test("source rules drop off-topic Mercer items and Groom webinars without touching benefits items", () => {
  const mercer = (title, summary = "") => keepForFeed({ source: "Mercer Law & Policy Group", title, categories: [], summary }, rules, "mercer");
  assert.equal(mercer("Roundup: Employer resources on H-1B reforms", "Visa fee changes for employers.").keep, false);
  assert.equal(mercer("Roundup: Employer resources on the changing landscape of DEI").keep, false);
  assert.equal(mercer("San Francisco boosts 2027 Health Care Expenditure Rates").keep, true);
  assert.equal(mercer("PBGC waives reporting for attrition events").keep, true);
  const dol = (title) => keepForFeed({ source: "DOL News Releases", title, categories: [], summary: "" }, rules, "dol-ebsa-newsroom").keep;
  assert.equal(dol("Unemployment Insurance Weekly Claims Report"), false);
  assert.equal(dol("US Department of Labor recovers $2.1M for health plan participants after EBSA investigation"), true);
  assert.equal(keepForFeed({ source: "Groom Law Group", title: "Groom Webinar: Q3 2026 Benefits Watch", categories: ["Publications"] }, rules, "groom").keep, false);
});

test("new source gates: deadline reminders use the Federal Register keywords; IRB and CCIIO keep group-health items", () => {
  const keep = (id, title, summary = "") => keepForFeed({ source: id, title, summary, categories: [] }, rules, id).keep;
  assert.equal(keep("regulations-gov", "Comments due September 25: Employer Contributions to Trump Accounts and Nondiscrimination Rules for Dependent Care Assistance Programs"), true);
  assert.equal(keep("regulations-gov", "Comments due October 5: Application of Section 250(b)(3)(A)(i)(VII) to Sales or Other Dispositions of Property"), false);
  assert.equal(keep("regulations-gov", "Comments due October 2: Agency Information Collection Activities; Proposals, Submissions, and Approvals"), false);
  assert.equal(keep("irs-irb", "CC-00349938-26: Guidance on Eligible Investments for Trump Accounts"), true);
  assert.equal(keep("irs-irb", "Notice 2026-51: This notice sets forth updates on the corporate bond monthly yield curve", "IRB 2026-38 · Employee Plans — segment rates under § 430(h)(2)"), false);
  assert.equal(keep("cms-cciio", "CMS-9909-IFC: Requirements Related to Surprise Billing; Part I", "No Surprises Act"), true);
  assert.equal(keep("cms-cciio", "Key Dates for Calendar Year 2025: Qualified Health Plan (QHP) Data Submission and Certification", "Plan Management"), false);
  assert.equal(keep("courtlistener-cal-district", "(PS) Gunnison v. Ingersoll Rand Retirement Savings Plan — Findings and Recommendations"), false);
  assert.equal(keep("nccmp", "Presentation: 2026 LA Surprise Billing and IDR Update"), true);
  assert.equal(keep("nccmp", "Presentation: 2026 LA PBGC Update"), false);
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
