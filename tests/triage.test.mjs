import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { loadScans } from "../scripts/lib/sources.mjs";
import { IN_SCOPE_THRESHOLD, buildUser, decide, matchSchema } from "../scripts/lib/triage.mjs";
import { createModelClient, loadPrompt } from "../scripts/lib/model.mjs";

const run = promisify(execFile);
const ROOT = new URL("..", import.meta.url).pathname;
const SCAN_IDS = ["fhw", "met", "ca9", "cyb", "atf"];

function assertScanMatchRecord(rec, scanIds) {
  assert.equal(typeof rec.document_id, "string");
  assert.equal(rec.prompt_version, "triage@2");
  assert.equal(typeof rec.summary, "string");
  assert.ok(rec.summary.split(/[.!?]\s/).length >= 2, "summary should be two sentences");
  assert.deepEqual(rec.matches.map((m) => m.scan_id), scanIds, "one row per scan, in charter order");
  for (const m of rec.matches) {
    assert.ok(m.score >= 0 && m.score <= 1);
    assert.equal(typeof m.in_scope, "boolean");
    assert.ok(m.reason.length > 10);
    if (m.in_scope) assert.ok(m.score >= IN_SCOPE_THRESHOLD, `${m.scan_id} in scope below threshold`);
  }
}

test("fixture-mode triage writes schema-shaped matches and omissions, keeps the model's reason verbatim, and deletes nothing", async () => {
  const out = await mkdtemp(path.join(tmpdir(), "triage-"));
  const { stdout } = await run("node", [path.join(ROOT, "scripts/triage.mjs"), "--fixture", "--out", out]);
  assert.match(stdout, /assessed 5: 3 matched, 2 omitted/);

  const scanIds = (await loadScans()).map((s) => s.id);
  const matches = await readdir(path.join(out, "matches"));
  const omitted = await readdir(path.join(out, "omitted"));
  assert.equal(matches.length, 3);
  assert.equal(omitted.length, 2);

  for (const f of matches) {
    const rec = JSON.parse(await readFile(path.join(out, "matches", f), "utf8"));
    assertScanMatchRecord(rec, scanIds);
    assert.ok(rec.scan_ids.length >= 1);
    assert.equal("omitted" in rec, false);
  }
  for (const f of omitted) {
    const rec = JSON.parse(await readFile(path.join(out, "omitted", f), "utf8"));
    assertScanMatchRecord(rec, scanIds);
    assert.equal(rec.omitted, true);
    assert.deepEqual(rec.scan_ids, []);
    const fixture = JSON.parse(await readFile(path.join(ROOT, "tests/fixtures/model/triage", `triage@2-${rec.document_id}.json`), "utf8"));
    const closest = [...fixture.data.matches].sort((a, b) => b.score - a.score)[0];
    assert.equal(rec.reason, closest.reason, "omission reason is the model's own sentence for the closest scan");
  }

  const collected = await readdir(path.join(ROOT, "tests/fixtures/collected"));
  assert.equal(collected.length, 5, "input documents are never deleted");
  const log = JSON.parse(await readFile(path.join(out, "run-log.json"), "utf8"));
  assert.deepEqual(log.triage.per_scan, { fhw: 1, met: 0, ca9: 1, cyb: 0, atf: 1 });
  assert.equal(log.triage.usage.fixture_hits, 5);
});

test("decide applies the conservative threshold in code and names the closest scan when nothing matches", () => {
  const data = { summary: "x. y.", matches: [
    { scan_id: "fhw", score: 0.9, in_scope: true, reason: "clearly covered" },
    { scan_id: "met", score: 0.5, in_scope: true, reason: "model said yes but low score" },
    { scan_id: "ca9", score: 0.7, in_scope: false, reason: "model said no" },
  ] };
  const d = decide(data, SCAN_IDS);
  assert.deepEqual(d.inScope, ["fhw"]);
  assert.equal(d.rows.length, 5, "missing scans get a row");
  assert.equal(d.rows.find((r) => r.scan_id === "cyb").reason, "no row returned for this scan");
  assert.equal(d.omittedReason, null);

  const none = decide({ summary: "", matches: [{ scan_id: "atf", score: 0.4, in_scope: false, reason: "closest but not covered" }] }, SCAN_IDS);
  assert.deepEqual(none.inScope, []);
  assert.equal(none.omittedReason, "closest but not covered");
});

test("structured-output schema enumerates the scans and the user message carries only stored fields", async () => {
  const schema = matchSchema(SCAN_IDS);
  assert.deepEqual(schema.properties.matches.items.properties.scan_id.enum, SCAN_IDS);
  assert.equal(schema.additionalProperties, false);
  const user = buildUser({ source: "S", title: "T", link: "https://x", date: "2026-08-01T12:00:00.000Z", summary: "Body", categories: ["a"], structured: { comments_close_on: "2026-09-30" } });
  assert.match(user, /^Source: S\nTitle: T\nDate: 2026-08-01\nCategories: a\nStructured fields: .*comments_close_on/);
  assert.match(user, /Text as collected:\nBody$/);
});

test("prompt header parses and a document without a recorded fixture is skipped, not invented", async () => {
  const prompt = await loadPrompt(path.join(ROOT, "prompts/triage.md"));
  assert.equal(prompt.version, "triage@2");
  assert.match(prompt.body, /^You are the intake reader/);
  const client = createModelClient({ mode: "fixture", fixtureDir: path.join(ROOT, "tests/fixtures/model/triage") });
  const res = await client.complete({ key: "triage@2-does-not-exist", system: ["s"], user: "u", schema: {} });
  assert.equal(res.stop_reason, "no_fixture");
  assert.equal(res.data, null);
});
