import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { displayDate, fetchFeedWithFallback, isoWeek, parseAtom, parseDatedGuidanceList, parseDmhcPage, parseIrb, parseRegulationsGov, parseCourtListener, parseCourtListenerRecap, parseDasPage, parseMercerSearch, parseRss, parseSegalInsights, toISODate } from "../scripts/lib/collectors.mjs";

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const json = async (name) => JSON.parse(await fixture(name));

test("CourtListener opinions keep docket, filing date, and opinion PDF as structured fields", async () => {
  const items = parseCourtListener(await json("courtlistener.json"), "CourtListener API");
  assert.equal(items.length, 2);
  const [liu] = items;
  assert.equal(liu.title, "Liu v. Kaiser Permanente Employees Pension Plan for the Permanente Medical Group, Inc.");
  assert.equal(liu.link, "https://www.courtlistener.com/opinion/10962913/liu-v-kaiser-permanente-employees-pension-plan-for-the-permanente-medical/");
  assert.equal(liu.date, "2026-08-31T12:00:00.000Z");
  assert.deepEqual({ ...liu.structured, citation: undefined }, {
    docket_number: "24-4303", date_filed: "2026-08-31", cluster_id: 10962913, court: "ca9",
    download_url: "https://cdn.ca9.uscourts.gov/datastore/opinions/2026/08/31/24-4303.pdf", citation: undefined,
  });
  assert.match(liu.summary, /^9th Cir\. · No\. 24-4303 · filed 2026-08-31/);
  const snippet = "25-2204\nE. Coast Advanced Plastic Surgery, LLC v. Cigna Health & Life Ins. Co.\n\n   United States Court of Appeals";
  const [short] = parseCourtListener({ results: [{ caseName: "E.", caseNameFull: "", absolute_url: "/opinion/10975583/e/", dateFiled: "2026-09-17", opinions: [{ snippet }] }] }, "x");
  assert.equal(short.title, "E. Coast Advanced Plastic Surgery, LLC v. Cigna Health & Life Ins. Co.", "a truncated short name falls back to the caption on the opinion's first page");
});

test("CourtListener RECAP keeps rulings on ERISA dockets and skips filings, procedural orders, and attachments", async () => {
  const items = parseCourtListenerRecap(await json("courtlistener-recap.json"), "California District Courts");
  assert.deepEqual(items.map((it) => it.title), [
    "Jane Doe v. The Signature Benefits Plan and the Disney Severance Pay Plan — Findings of Fact & Conclusions of Law",
    "GCIU-Employer Retirement Fund v. T.C. Peters Printing Co., Inc. — Judgment",
  ], "protective orders, attachments, and non-ERISA dockets are dropped");
  const [doe, gciu] = items;
  assert.equal(doe.link, "https://www.courtlistener.com/docket/69264457/56/jane-doe-v-the-signature-benefits-plan-and-the-disney-severance-pay-plan/");
  assert.equal(doe.date, "2026-09-17T12:00:00.000Z");
  assert.match(doe.summary, /^C\.D\. Cal\. · No\. 8:24-cv-02230 · entered 2026-09-17 — FINDINGS OF FACT/);
  assert.equal(doe.structured.download_url, "https://storage.courtlistener.com/recap/gov.uscourts.cacd.944669/gov.uscourts.cacd.944669.56.0.pdf");
  assert.equal(gciu.structured.docket_number, "2:25-cv-11893");
});

test("regulations.gov open comment periods become reminders dated two weeks before the deadline", async () => {
  const items = parseRegulationsGov(await json("regulations-gov.json"), "Comment Deadlines", new Date("2026-09-20T12:00:00Z"));
  assert.deepEqual(items.map((it) => it.structured.comments_close_on), ["2026-09-25", "2026-10-02"], "deadlines more than two weeks out wait for a later run");
  const [trump] = items;
  assert.equal(trump.title, "Comments due September 25: Employer Contributions to Trump Accounts and Nondiscrimination Rules for Dependent Care Assistance Programs");
  assert.equal(trump.link, "https://www.regulations.gov/document/IRS-2026-0925-0001");
  assert.equal(trump.date, "2026-09-12T03:59:59.000Z");
  assert.match(trump.summary, /^Internal Revenue Service · Notice of Proposed Rulemaking \(NPRM\) · docket IRS-2026-0925 · FR Doc\. 2026-16314$/);
  assert.equal(parseRegulationsGov(await json("regulations-gov.json"), "x", new Date("2026-09-23T12:00:00Z")).length, 5);
});

test("Internal Revenue Bulletin highlights yield one dated item per document under its section", async () => {
  const url = "https://www.irs.gov/irb/2026-38_IRB";
  const items = parseIrb(await fixture("irb-2026-38.html"), url, "IRS Internal Revenue Bulletin");
  assert.equal(items.length, 5);
  assert.deepEqual(items.map((it) => it.categories[0]), ["Employee Plans", "Employee Plans", "Income Tax", "Income Tax", "Income Tax"]);
  const trump = items.find((it) => it.link === `${url}#CC-00349938-26`);
  assert.equal(trump.title, "CC-00349938-26: Guidance on Eligible Investments for Trump Accounts", "the table of contents names items the highlights list by number");
  assert.equal(trump.date, "2026-09-14T12:00:00.000Z");
  assert.match(trump.summary, /^IRB 2026-38 · Income Tax — The proposed regulations would provide guidance regarding eligible investments/);
  assert.match(items[0].title, /^Notice 2026-51: This notice sets forth updates on the corporate bond monthly yield curve/);
  assert.ok(items[0].title.length < 170);
  assert.equal(isoWeek(new Date("2026-09-14T12:00:00Z")), "2026-38", "IRB numbers follow the ISO week of their Monday");
  assert.equal(isoWeek(new Date("2026-01-01T12:00:00Z")), "2026-01");
});

test("dated guidance lists yield one item per entry, carrying the topic heading", async () => {
  const page = "https://www.cms.gov/marketplace/resources/regulations-guidance";
  const items = parseDatedGuidanceList(await fixture("cciio-guidance.html"), page, "CMS Private Insurance Guidance");
  assert.equal(items.length, 15);
  const papi = items[0];
  assert.equal(papi.date, "2026-01-29T12:00:00.000Z");
  assert.equal(papi.link, "https://www.cms.gov/files/document/2027-papi-parameters-guidance-2026-01-29.pdf");
  assert.ok(!papi.title.endsWith("(PDF)"));
  const nsa = items.find((it) => it.title.startsWith("CMS-9909-IFC"));
  assert.deepEqual(nsa.categories, ["No Surprises Act"]);
  assert.equal(nsa.link, "https://www.federalregister.gov/documents/2021/07/13/2021-14379/requirements-related-to-surprise-billing-part-i", "absolute links are kept, so they merge with the Federal Register item");
  assert.equal(items.find((it) => it.title.includes("Idr Process") || it.title.includes("(IDR) Process")).date, "2023-09-20T12:00:00.000Z", "a &nbsp; inside the date still parses");
  const typo = `<h2>Shared Responsibility</h2><ul><li>September 18, 2104<br><a href="/x.pdf">Filing Threshold Hardship Exemption</a></li></ul>`;
  assert.equal(parseDatedGuidanceList(typo, page, "x", new Date("2026-09-23T12:00:00Z")).length, 0, "a far-future typo date is skipped");
});

test("DMHC All Plan Letters and press releases yield dated items; attachments are skipped", async () => {
  const apl = parseDmhcPage(await fixture("dmhc-apl.html"), "https://www.dmhc.ca.gov/LicensingReporting/HealthPlanLicensing/AllPlanLetters.aspx", "California DMHC");
  assert.equal(apl.length, 14, "letters only; FAQ, checklist, and attachment links are not letters");
  assert.equal(apl[0].title, "APL 26-014: Contracted Pharmacy Benefit Manager Information");
  assert.equal(apl[0].date, "2026-09-03T12:00:00.000Z");
  assert.equal(apl.find((it) => it.title.startsWith("APL 26-011")).title, "APL 26-011: Compliance with Senate Bill 306 (2025) – First Data Call – REVISED");
  assert.deepEqual(apl.find((it) => it.title.startsWith("ALL 26-010")).categories, ["All Licensee Letter"]);
  assert.equal(apl.find((it) => it.title.startsWith("APL 26-005")).link, "https://www.dmhc.ca.gov/LinkClick.aspx?fileticket=RN93GnGRShk%3d&portalid=0");
  const press = parseDmhcPage(await fixture("dmhc-press.html"), "https://www.dmhc.ca.gov/Resources/Newsroom/PressReleases.aspx", "California DMHC");
  assert.equal(press.length, 5);
  assert.equal(press[0].title, "California fines Blue Shield of California $800,000 for delaying resolution of member complaints");
  assert.equal(press[0].date, "2026-09-09T12:00:00.000Z");
  assert.equal(press[0].link, "https://www.dmhc.ca.gov/Resources/Newsroom/PressReleases/September9,2026PressRelease.aspx");
});

test("Segal insights resolve relative URLs and parse long-form dates", async () => {
  const items = parseSegalInsights(await json("segal-insights.json"), "Segal Compliance News");
  assert.equal(items.length, 5);
  assert.equal(items[0].link, "https://www.segalco.com/consulting-insights/proposed-rules-for-employer-contributions-to-trump-accounts/");
  assert.equal(items[0].date, "2026-08-18T12:00:00.000Z");
  assert.ok(items[0].categories.includes("Compliance News"));
});

test("Mercer search results are filtered to English law-and-policy articles with epoch dates", async () => {
  const all = (await json("mercer-search.json")).results.length;
  const items = parseMercerSearch(await json("mercer-search.json"), "Mercer Law & Policy Group");
  assert.equal(all, 8);
  assert.equal(items.length, 4);
  for (const it of items) assert.match(it.link, /^https:\/\/www\.mercer\.com\/insights\/law-and-policy\//);
  assert.equal(items[0].date, "2026-08-16T18:30:00.000Z");
  assert.equal(items[0].title, "Roundup: Global employer resources on artificial intelligence");
});

test("DIR What's New table yields dated news releases with absolute links", async () => {
  const items = parseDasPage(await fixture("das-whats-new.html"), "https://www.dir.ca.gov/das/das.html", "California DAS / DIR / CAC");
  assert.equal(items.length, 6);
  assert.equal(items[0].date, "2026-04-30T12:00:00.000Z");
  assert.equal(items[0].link, "https://www.dir.ca.gov/DIRNews/2026/2026-38.html");
  assert.match(items[0].title, /youth apprenticeships/);
});

test("CAC meeting tables yield one notice per committee with the meeting date and its documents", async () => {
  const items = parseDasPage(await fixture("cac-meetings.html"), "https://www.dir.ca.gov/das/DAS_CACMeetings.html", "California DAS / DIR / CAC");
  assert.equal(items.length, 7);
  const cca = items.find((it) => it.title.startsWith("CCA/CAC Subcommittee Meeting"));
  assert.equal(cca.date, "2026-08-12T12:00:00.000Z");
  assert.equal(cca.structured.meeting_date, "2026-08-12");
  assert.equal(cca.link, "https://www.dir.ca.gov/DAS/DAS_MeetingAgenda/2026/August/2026-8-CCA-CAC-Notice.pdf");
  assert.deepEqual(cca.structured.documents.map((d) => d.label), ["Notice", "Agenda", "Remote Attendees"]);
  assert.equal(new Set(items.map((it) => it.link)).size, items.length, "links must be unique so the store keys them separately");
});

test("Atom entries yield the alternate link, published date, summary text, and category labels", async () => {
  const xml = await fixture("atom-feed.xml");
  const items = parseAtom(xml, "Example Blog");
  assert.equal(items.length, 2, "an entry without a title is skipped");
  const [faq, appeal] = items;
  assert.equal(faq.title, "Agencies Issue FAQs on Mental Health Parity & Network Adequacy");
  assert.equal(faq.link, "https://blog.example.org/2026/09/mhpaea-faqs.html", "the rel=alternate link wins over replies and edit links");
  assert.equal(faq.date, "2026-09-18T16:30:00.000Z", "published wins over updated");
  assert.equal(faq.summary, "The Departments released FAQs Part 75 on nonquantitative treatment limitations.");
  assert.deepEqual(faq.categories, ["MHPAEA", "Group Health"]);
  assert.equal(appeal.link, "https://blog.example.org/2026/08/section-515.html", "a link without rel is the alternate link");
  assert.equal(appeal.date, "2026-08-29T12:00:00.000Z", "updated stands in when there is no published date");
  assert.match(appeal.summary, /^The Seventh Circuit held/);
  assert.deepEqual(parseRss(xml, "Example Blog"), items, "parseRss hands Atom documents to the Atom parser");
});

test("a source whose own feed is blocked reads its fallback feed, without the channel's title suffix", async () => {
  const google = await fixture("google-news-site.xml");
  const source = { name: "Wagner Law Group Law Alerts", url: "https://www.wagnerlawgroup.com/feed/", fallback_url: "https://news.google.com/rss/search?q=site:wagnerlawgroup.com", fallback_title_suffix: " - The Wagner Law Group", fallback_label: "Google News" };
  const fetcher = async (url) => { if (url === source.url) throw new Error("HTTP 403"); return google; };
  const items = await fetchFeedWithFallback(source, fetcher);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Bally’s Class Action Launches Circuit Reviews of Smoking Penalties");
  assert.equal(items[0].date, "2026-09-15T07:00:00.000Z");
  assert.deepEqual(items[0].categories, ["via Google News"]);
  assert.equal(items[0].summary, "", "the fallback's description only repeats the title");
  await assert.rejects(fetchFeedWithFallback({ ...source, fallback_url: undefined }, fetcher), /HTTP 403/, "no fallback: the failure is reported");
  const own = await fetchFeedWithFallback(source, async () => "<rss><item><title>Own</title><link>https://w/1</link></item></rss>");
  assert.equal(own[0].title, "Own", "the own feed wins when it answers");
});

test("RSS 1.0 (RDF) items take their date from dc:date", () => {
  const xml = `<rdf:RDF><item rdf:about="https://x/a"><title>IRS Notice 2026-61</title><link>https://x/a</link><dc:date>2026-09-15T14:00:00Z</dc:date></item></rdf:RDF>`;
  assert.equal(parseRss(xml, "x")[0].date, "2026-09-15T14:00:00.000Z");
});

test("toISODate accepts ISO and long-form dates and rejects junk", () => {
  assert.equal(toISODate("2026-08-18"), "2026-08-18T12:00:00.000Z");
  assert.equal(toISODate("August 18, 2026"), "2026-08-18T12:00:00.000Z");
  assert.equal(toISODate("TBD"), null);
  assert.equal(toISODate("Sept. 18, 2026"), "2026-09-18T12:00:00.000Z");
});

test("displayDate keeps past dates, and moves future-dated notices to when they were first seen", () => {
  const now = new Date("2026-09-02T15:00:00.000Z");
  const seen = new Map([["https://x/meeting", "2026-08-20T12:00:00.000Z"]]);
  assert.equal(displayDate({ link: "https://x/old", date: "2026-08-30T12:00:00.000Z" }, seen, now), "2026-08-30T12:00:00.000Z");
  assert.equal(displayDate({ link: "https://x/meeting", date: "2026-10-29T12:00:00.000Z" }, seen, now), "2026-08-20T12:00:00.000Z", "future meeting sorts by first-seen");
  assert.equal(displayDate({ link: "https://x/new", date: "2026-10-29T12:00:00.000Z" }, seen, now), now.toISOString(), "brand-new future item is news today");
  assert.equal(displayDate({ link: "https://x/undated", date: null }, seen, now), now.toISOString());
});
