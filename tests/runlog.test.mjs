import assert from "node:assert/strict";
import test from "node:test";
import { SILENT_AFTER, carryFailureCounts } from "../scripts/lib/runlog.mjs";

test("failure counts carry across runs, reset on success, and cross the silent threshold", () => {
  const prev = new Map([
    ["wagner", { id: "wagner", ok: false, consecutive_failures: 2, silent_since: "2026-08-30" }],
    ["groom", { id: "groom", ok: false, consecutive_failures: 1, silent_since: "2026-08-31" }],
  ]);
  const runLog = [
    { source: "Wagner", id: "wagner", ok: false, error: "HTTP 403" },
    { source: "Groom", id: "groom", ok: true, items: 4 },
    { source: "New", id: "new", ok: false, error: "timeout" },
    { source: "EBIA", id: "ebia", skipped: "email-only" },
  ];
  const { attempted, failed } = carryFailureCounts(runLog, prev, "2026-09-01");
  assert.equal(attempted.length, 3);
  assert.deepEqual(failed.map((r) => r.id), ["wagner", "new"]);
  assert.equal(runLog[0].consecutive_failures, 3);
  assert.equal(runLog[0].silent_since, "2026-08-30");
  assert.ok(runLog[0].consecutive_failures >= SILENT_AFTER);
  assert.equal(runLog[1].consecutive_failures, 0);
  assert.equal("silent_since" in runLog[1], false);
  assert.deepEqual({ n: runLog[2].consecutive_failures, since: runLog[2].silent_since }, { n: 1, since: "2026-09-01" });
  assert.equal("consecutive_failures" in runLog[3], false);
});
