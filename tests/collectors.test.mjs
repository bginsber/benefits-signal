import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { displayDate, parseCourtListener, parseDasPage, parseMercerSearch, parseSegalInsights, toISODate } from "../scripts/lib/collectors.mjs";

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

test("toISODate accepts ISO and long-form dates and rejects junk", () => {
  assert.equal(toISODate("2026-08-18"), "2026-08-18T12:00:00.000Z");
  assert.equal(toISODate("August 18, 2026"), "2026-08-18T12:00:00.000Z");
  assert.equal(toISODate("TBD"), null);
});

test("displayDate keeps past dates, and moves future-dated notices to when they were first seen", () => {
  const now = new Date("2026-09-02T15:00:00.000Z");
  const seen = new Map([["https://x/meeting", "2026-08-20T12:00:00.000Z"]]);
  assert.equal(displayDate({ link: "https://x/old", date: "2026-08-30T12:00:00.000Z" }, seen, now), "2026-08-30T12:00:00.000Z");
  assert.equal(displayDate({ link: "https://x/meeting", date: "2026-10-29T12:00:00.000Z" }, seen, now), "2026-08-20T12:00:00.000Z", "future meeting sorts by first-seen");
  assert.equal(displayDate({ link: "https://x/new", date: "2026-10-29T12:00:00.000Z" }, seen, now), now.toISOString(), "brand-new future item is news today");
  assert.equal(displayDate({ link: "https://x/undated", date: null }, seen, now), now.toISOString());
});
