import assert from "node:assert/strict";
import test from "node:test";
import { IMPLEMENTED, loadScans, loadSources, resolveCollector } from "../scripts/lib/sources.mjs";

test("spec/scans.yaml defines the five saved scans with complete charters", async () => {
  const scans = await loadScans();
  assert.deepEqual(scans.map((s) => s.id), ["fhw", "met", "ca9", "cyb", "atf"]);
  for (const s of scans) {
    assert.ok(s.charter.length > 100, `${s.id} charter is too short to match against`);
    assert.ok(s.out_of_scope.length >= 1, `${s.id} has no out-of-scope rule`);
  }
});

test("spec/sources.yaml carries the seven interpretation sources and every scan key is a real scan", async () => {
  const [sources, scans] = await Promise.all([loadSources(), loadScans()]);
  const interpretation = sources.filter((s) => s.layer === "interpretation");
  assert.equal(interpretation.length, 7);
  const ids = new Set(scans.map((s) => s.id));
  for (const s of sources) {
    assert.ok(s.id, `${s.name} has no id`);
    for (const k of s.scans) assert.ok(ids.has(k), `${s.name} references unknown scan ${k}`);
  }
  assert.equal(new Set(sources.map((s) => s.id)).size, sources.length, "source ids must be unique");
});

test("every active source is either collected or skipped with a reason", async () => {
  const sources = await loadSources();
  for (const s of sources.filter((x) => x.active)) {
    const r = resolveCollector(s);
    if (r.kind) assert.ok(IMPLEMENTED.includes(r.kind), `${s.name}: collector ${r.kind} is not implemented`);
    else assert.ok(typeof r.reason === "string" && r.reason.length > 0, `${s.name}: skipped without a reason`);
  }
  assert.equal(resolveCollector({ ...sources[0], active: false }).kind, null);
});
