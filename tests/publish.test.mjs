import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { promisify } from "node:util";
import * as esbuild from "esbuild";
import { buildIssue, readerSummaryLine, releaseDecision } from "../scripts/lib/publish.mjs";
import { validate } from "../scripts/lib/schema.mjs";

const run = promisify(execFile);
const ROOT = new URL("..", import.meta.url).pathname;
const schema = JSON.parse(await readFile(path.join(ROOT, "spec/issue-schema.json"), "utf8"));

/** Bundle the pure Issue component with React and a static renderer, so the test renders real markup. */
async function loadRenderer() {
  const dir = await mkdtemp(path.join(tmpdir(), "issue-render-"));
  const entry = path.join(dir, "entry.jsx");
  await writeFile(entry, `import { renderToStaticMarkup } from "react-dom/server";\nimport { Issue } from ${JSON.stringify(path.join(ROOT, "src/Issue.jsx"))};\nexport const render = (issue) => renderToStaticMarkup(<Issue issue={issue} />);\n`);
  const out = path.join(dir, "bundle.mjs");
  await esbuild.build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", jsx: "automatic", outfile: out, logLevel: "silent", absWorkingDir: ROOT, nodePaths: [path.join(ROOT, "node_modules")], banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' }, define: { "process.env.NODE_ENV": '"production"' } });
  return (await import(pathToFileURL(out).href)).render;
}

test("publisher output renders: an empty issue shows the zero-development masthead, a carried-forward development is labeled in the expanded view", async () => {
  const render = await loadRenderer();
  const out = await mkdtemp(path.join(tmpdir(), "publish-"));
  const publish = (issue, extra) => run("node", [path.join(ROOT, "scripts/publish.mjs"), "--fixture", "--issue", issue, "--out", path.join(out, `${issue}.json`), "--omitted", path.join(out, "no-omitted"), ...extra]);

  await publish("2026-09-09", ["--review", path.join(out, "no-review.json")]);
  const empty = JSON.parse(await readFile(path.join(out, "2026-09-09.json"), "utf8"));
  assert.deepEqual(validate(empty, schema), []);
  assert.equal(empty.developments.length, 0);
  const emptyHtml = render(empty);
  assert.match(emptyHtml, /Nothing requires your attention this week\./);
  assert.match(emptyHtml, /Wednesday, September 9, 2026/);
  assert.doesNotMatch(emptyHtml, /<article/, "no development articles on an empty issue");
  assert.match(emptyHtml, /View source log/, "the footer and source log remain");

  await publish("2026-09-02", ["--previous", "tests/fixtures/issues/2026-08-26.json"]);
  const issue = JSON.parse(await readFile(path.join(out, "2026-09-02.json"), "utf8"));
  assert.deepEqual(validate(issue, schema), []);
  assert.equal(issue.developments.length, 2, "approved + edited released; rejected excluded");
  const liu = issue.developments.find((d) => d.id.startsWith("ninth-circuit"));
  const cac = issue.developments.find((d) => d.id.startsWith("california"));
  assert.equal(liu.carriedForward, true);
  assert.equal("carriedForward" in cac, false);
  assert.equal(cac.timing, "No action until the minutes post; re-check the CAC page on September 15", "paralegal edit applied");
  assert.deepEqual(cac.metadata.Topics, ["Apprenticeship", "Equal opportunity", "CAC", "EEO standards"], "metadata edit merged, other keys kept");
  assert.equal("pipeline" in liu, false, "pipeline block never reaches the front end");
  const html = render(issue);
  assert.match(html, /Carried forward from a previous issue; updated here rather than presented as new\./);
  assert.equal((html.match(/Carried forward from a previous issue/g) ?? []).length, 1, "only the carried-forward development is labeled");
  assert.match(html, /Two developments worth your time\./);
  assert.deepEqual(issue.sourceLog.map((r) => r.result), ["Verified", "Kept", "Verified", "Kept", "Omitted"]);
  assert.match(issue.sourceLog.at(-1).note, /paralegal reject/);
});

test("release rules: paralegal approval releases, gated items also need an attorney row, edits apply field by field", () => {
  const base = (id, lane, tags = ["Prudence & Process"]) => ({ id, lane, headline: id, metadata: { "Fiduciary duties": tags, Topics: ["a"] }, scan: "Federal Health & Welfare", mergedSources: ["X"], pipeline: {} });
  const rows = (...r) => ({ decisions: r });
  const p = (id, decision, edits = {}) => ({ development_id: id, role: "paralegal", decision, edits });
  const a = (id, decision) => ({ development_id: id, role: "attorney", decision, edits: {} });
  assert.equal(releaseDecision(base("w", "WATCH"), rows(p("w", "approve"))).release, true);
  assert.equal(releaseDecision(base("w", "WATCH"), rows()).why, "no paralegal decision");
  assert.equal(releaseDecision(base("w", "WATCH"), rows(p("w", "defer"))).why, "paralegal defer");
  const now = base("n", "NOW");
  assert.match(releaseDecision(now, rows(p("n", "approve"))).why, /attorney approval required \(NOW item\)/);
  assert.equal(releaseDecision(now, rows(p("n", "approve"), a("n", "approve"))).release, true);
  assert.equal(releaseDecision(base("g", "WATCH", ["Loyalty & Exclusive Benefit"]), rows(p("g", "approve"), a("g", "reject"))).why, "attorney reject");
  const { issue, released } = buildIssue({ issueDate: "2026-09-02", candidates: [base("w", "WATCH"), now], review: rows(p("w", "edit", { headline: "Edited headline", metadata: { Topics: ["b"] } }), p("n", "approve")) });
  assert.equal(released.length, 1);
  assert.equal(issue.developments[0].headline, "Edited headline");
  assert.deepEqual(issue.developments[0].metadata, { "Fiduciary duties": ["Prudence & Process"], Topics: ["b"] });
  assert.equal(issue.issueSummary, "One development worth your time.");
  assert.equal(readerSummaryLine([now, now, base("x", "NEXT")]), "Three developments worth your time. Two need a legal read.");
});
