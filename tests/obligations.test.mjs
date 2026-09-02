import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { promisify } from "node:util";
import * as esbuild from "esbuild";
import { buildObligations } from "../scripts/lib/publish.mjs";
import { NONE_TAG, renderTrusteeAgenda, trusteeAgendaItems } from "../scripts/lib/digest.mjs";
import { validate } from "../scripts/lib/schema.mjs";

const run = promisify(execFile);
const ROOT = new URL("..", import.meta.url).pathname;
const schema = JSON.parse(await readFile(path.join(ROOT, "spec/issue-schema.json"), "utf8"));

async function loadRenderer() {
  const dir = await mkdtemp(path.join(tmpdir(), "obligations-render-"));
  const entry = path.join(dir, "entry.jsx");
  await writeFile(entry, `import { renderToStaticMarkup } from "react-dom/server";\nimport { Issue } from ${JSON.stringify(path.join(ROOT, "src/Issue.jsx"))};\nexport const render = (issue) => renderToStaticMarkup(<Issue issue={issue} />);\n`);
  const out = path.join(dir, "bundle.mjs");
  await esbuild.build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", jsx: "automatic", outfile: out, logLevel: "silent", absWorkingDir: ROOT, nodePaths: [path.join(ROOT, "node_modules")], banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' }, define: { "process.env.NODE_ENV": '"production"' } });
  return (await import(pathToFileURL(out).href)).render;
}

test("publisher emits upcoming obligations from scan-matched Federal Register deadlines, sorted, future only, and the page renders them as one disclosure", async () => {
  const out = await mkdtemp(path.join(tmpdir(), "obligations-"));
  await run("node", [path.join(ROOT, "scripts/publish.mjs"), "--fixture", "--issue", "2026-09-02", "--previous", "tests/fixtures/issues/2026-08-26.json",
    "--collected", "tests/fixtures/obligations/collected", "--matches", "tests/fixtures/obligations/matches", "--omitted", path.join(out, "none"), "--out", path.join(out, "issue.json")]);
  const issue = JSON.parse(await readFile(path.join(out, "issue.json"), "utf8"));
  assert.deepEqual(validate(issue, schema), []);
  assert.equal(issue.obligations.length, 1, "the two released developments' dates (Aug 12, Aug 31) are before the issue date and are excluded");
  const [o] = issue.obligations;
  assert.deepEqual({ date: o.date, kind: o.kind, source: o.source, confirmed: o.confirmed }, { date: "2026-09-25", kind: "comment_deadline", source: "Federal Register", confirmed: true });
  assert.match(o.label, /^Comments due: Employer Contributions to Trump Accounts/);
  assert.match(o.label, /Federal Health & Welfare\)$/);

  const render = await loadRenderer();
  const html = render(issue);
  assert.equal((html.match(/class="briefing-disclosure obligations-disclosure"/g) ?? []).length, 1, "exactly one disclosure");
  assert.match(html, /<summary>Upcoming obligations<\/summary>/);
  assert.match(html, /<dt>September 25, 2026<\/dt>/);
  assert.match(html, /obligations-disclosure[\s\S]*<footer class="digest-footer"/, "the disclosure sits at the foot of the reading column, before the footer");
  const without = render({ ...issue, obligations: [] });
  assert.doesNotMatch(without, /Upcoming obligations/, "no disclosure when there is nothing upcoming");
});

test("buildObligations includes confirmed development dates, skips unconfirmed ones, dedupes, and sorts ascending", () => {
  const doc = (id, source, structured) => [id, { id, source, title: id, link: `https://x/${id}`, structured }];
  const docsById = new Map([
    doc("fr-a", "Federal Register — EBSA", { comments_close_on: "2026-10-01", effective_on: "2026-12-01" }),
    doc("fr-b", "Federal Register — IRS", { comments_close_on: "2026-09-20" }),
    doc("cl-c", "CourtListener API", { date_filed: "2026-09-10" }),
  ]);
  const dev = (id, operative_date, dates, primary) => ({ id, headline: id, authorityUrl: `https://x/${primary}`, authorityLabel: "A", pipeline: { operative_date, verification: { primary_document_id: primary, checked_fields: { dates } } } });
  const released = [dev("rule", "2026-10-01", "confirmed", "fr-a"), dev("case", "2026-09-10", "unconfirmed", "cl-c"), dev("past", "2026-08-01", "confirmed", "fr-b")];
  const matches = [{ document_id: "fr-a", scan_ids: ["cyb"] }, { document_id: "fr-b", scan_ids: ["fhw"] }, { document_id: "fr-b", scan_ids: [] }];
  const obl = buildObligations({ issueDate: "2026-09-02", released, matches, docsById });
  assert.deepEqual(obl.map((o) => [o.date, o.kind, o.developmentId ?? null]), [
    ["2026-09-20", "comment_deadline", null],
    ["2026-10-01", "comment_deadline", "rule"],
    ["2026-12-01", "effective_date", null],
  ], "fr-a's comment date appears once (development row wins the dedupe), unconfirmed case and past deadline are skipped");
});

test("trustee agenda handout keeps only candidates with a fiduciary tag other than None and shows each tag's justification", async () => {
  const c = (id, tags, lane = "WATCH") => ({ id, lane, headline: id, status: "s", affected: "who", action: "what", timing: "when", nextStep: "No action — informational", authorityLabel: "A", authorityUrl: "https://x", metadata: { "Fiduciary duties": tags }, pipeline: { fiduciary_justifications: tags.map((t) => ({ tag: t, justification: `because ${t}` })) } });
  const items = trusteeAgendaItems([c("none", [NONE_TAG]), c("prudence", ["Prudence & Process"], "NOW"), c("mixed", ["Reporting & Disclosure"])]);
  assert.deepEqual(items.map((i) => i.id), ["prudence", "mixed"]);
  const md = renderTrusteeAgenda("2026-09-02", [c("none", [NONE_TAG]), c("prudence", ["Prudence & Process"], "NOW")]);
  assert.match(md, /^# Trustees' meeting agenda/);
  assert.match(md, /For attorney review before any use/);
  assert.match(md, /- \*\*Prudence & Process:\*\* because Prudence & Process/);
  assert.doesNotMatch(md, /## \d+\. none/);
  assert.match(renderTrusteeAgenda("2026-09-02", [c("none", [NONE_TAG])]), /No development in this issue changes a trustee duty/);

  const out = await mkdtemp(path.join(tmpdir(), "agenda-"));
  const { stdout } = await run("node", [path.join(ROOT, "scripts/digest.mjs"), "--fixture", "--out", out, "--issue", "2026-09-02", "--trustee-agenda"]);
  assert.match(stdout, /3 of 3 candidate\(s\) touch a fiduciary duty/);
  const file = await readFile(path.join(out, "digests", "2026-09-02-trustee-agenda.md"), "utf8");
  assert.match(file, /Duties touched: Program & Funding Compliance · Prudence & Process · Claims & Appeals Procedure/);
  assert.doesNotMatch(file, /Reviewer notes/, "handout carries no reviewer-only content");
});
