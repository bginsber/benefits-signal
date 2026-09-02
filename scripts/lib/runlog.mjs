/**
 * Run-log bookkeeping for the "source silent for N runs" notice (spec § 6.1).
 * The previous run's rows are keyed by source id; a failure increments the
 * carried count, a success resets it. Skipped rows are left untouched.
 */

export const SILENT_AFTER = 3;

/**
 * Mutates the current run's rows in place, adding `consecutive_failures` and,
 * for failing rows, `silent_since` (the first failing date carried forward).
 * `previous` is a Map of id → previous row (may be empty).
 * Returns { attempted, failed } for the caller's annotations and exit code.
 */
export function carryFailureCounts(runLog, previous = new Map(), today = new Date().toISOString().slice(0, 10)) {
  const attempted = runLog.filter((r) => !("skipped" in r));
  for (const r of attempted) {
    const prev = previous.get(r.id) ?? previous.get(r.source);
    r.consecutive_failures = r.ok ? 0 : (prev?.consecutive_failures ?? 0) + 1;
    if (r.ok) delete r.silent_since;
    else r.silent_since = prev?.silent_since ?? today;
  }
  return { attempted, failed: attempted.filter((r) => !r.ok) };
}
