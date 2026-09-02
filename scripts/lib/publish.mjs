/**
 * Publish stage (spec § 6.8): approved candidates + review decisions → issue.json.
 *
 * The output is exactly what src/App.jsx renders. Only candidates the
 * paralegal approved (or edited) are included; NOW items and gated tags also
 * need an attorney's approve/edit row. Reviewer edits are applied field by
 * field. A development that appeared in the previous issue is marked
 * carriedForward rather than presented as new. The source log is generated
 * from the pipeline's own records: verification (Verified), the lead
 * commentary (Kept), other cluster members (Merged), rejected candidates and
 * the omitted pool (Omitted).
 */

import { needsAttorney, sortCandidates, longDate } from "./digest.mjs";

const WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const APPROVE = new Set(["approve", "edit"]);

export function readerSummaryLine(developments) {
  const n = developments.length;
  if (!n) return "Nothing requires your attention this week.";
  const now = developments.filter((d) => d.lane === "NOW").length;
  const head = `${WORDS[n] ?? n} development${n === 1 ? "" : "s"} worth your time.`;
  return now ? `${head} ${now === 1 ? "One needs" : `${WORDS[now] ?? now} need`} a legal read.` : head;
}

/** Decide, per candidate, whether the review file releases it. */
export function releaseDecision(candidate, review) {
  const rows = (review?.decisions ?? []).filter((d) => d.development_id === candidate.id);
  const paralegal = rows.find((d) => d.role === "paralegal");
  const attorney = rows.find((d) => d.role === "attorney");
  const gate = needsAttorney(candidate);
  if (!paralegal || !APPROVE.has(paralegal.decision)) return { release: false, why: paralegal?.decision ? `paralegal ${paralegal.decision}` : "no paralegal decision", paralegal, attorney };
  if (gate.required && !(attorney && APPROVE.has(attorney.decision))) return { release: false, why: attorney?.decision ? `attorney ${attorney.decision}` : `attorney approval required (${gate.why}) and not recorded`, paralegal, attorney };
  return { release: true, why: "approved", paralegal, attorney };
}

/** Apply reviewer edits (paralegal first, then attorney) to the schema fields only. */
export function applyEdits(dev, ...rows) {
  const out = structuredClone(dev);
  for (const r of rows) {
    if (!r || r.decision !== "edit") continue;
    for (const [k, v] of Object.entries(r.edits ?? {})) {
      if (k === "pipeline" || k === "id") continue;
      if (k === "metadata" && v && typeof v === "object") out.metadata = { ...out.metadata, ...v };
      else out[k] = v;
    }
  }
  return out;
}

function shortNote(s, max = 160) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(" ")))}…`;
}

const sourceName = (s) => String(s ?? "").replace(/ — .*/, "");

/** Source log from pipeline records (spec § 5 SourceLogEntry). */
export function buildSourceLog({ released, rejected, docsById, omitted = [] }) {
  const rows = [];
  const seen = new Set();
  const push = (row) => { const k = `${row.source}|${row.scan}|${row.result}|${row.note}`; if (!seen.has(k)) { seen.add(k); rows.push(row); } };
  for (const dev of released) {
    const p = dev.pipeline ?? {};
    const v = p.verification ?? {};
    const members = (p.member_document_ids ?? []).map((id) => docsById.get(id)).filter(Boolean);
    const primary = members.find((m) => m.id === v.primary_document_id);
    if (primary && v.result && v.result !== "unconfirmed") {
      push({ source: sourceName(primary.source), scan: dev.scan, result: "Verified", note: shortNote(`${v.result === "confirmed" ? "Confirmed" : "Partially confirmed"} status and dates for the ${dev.lane} item. ${v.notes ?? ""}`) });
    } else if (v.primary_link && v.result && v.result !== "unconfirmed") {
      push({ source: "Primary authority lookup", scan: dev.scan, result: "Verified", note: shortNote(`${v.lookup ?? "Lookup"}: ${v.notes ?? ""}`) });
    }
    const article = members.find((m) => m.link === dev.articleUrl) ?? members.find((m) => m.id !== v.primary_document_id) ?? members[0];
    if (article) push({ source: sourceName(article.source), scan: dev.scan, result: "Kept", note: shortNote(`Lead ${article.id === v.primary_document_id ? "primary document" : "commentary"} for the ${dev.lane} item: ${article.title}`) });
    for (const m of members) {
      if (m === article || m === primary) continue;
      push({ source: sourceName(m.source), scan: dev.scan, result: "Merged", note: shortNote(`Added to the same development: ${m.title}`) });
    }
  }
  for (const { candidate, why, note } of rejected) {
    push({ source: (candidate.mergedSources ?? []).join(", ") || "Pipeline", scan: candidate.scan, result: "Omitted", note: shortNote(`Candidate not released (${why})${note ? `: ${note}` : ""} — ${candidate.headline}`) });
  }
  // Omitted pool: one row per source with the count and the model's reason for its closest miss.
  const bySource = new Map();
  for (const o of omitted) {
    const s = sourceName(o.source);
    const cur = bySource.get(s) ?? { count: 0, best: null };
    cur.count++;
    const top = Math.max(0, ...(o.matches ?? []).map((m) => m.score ?? 0));
    if (!cur.best || top > cur.best.score) cur.best = { score: top, reason: o.reason, scan: (o.matches ?? []).find((m) => m.score === top)?.scan_id };
    bySource.set(s, cur);
  }
  const scanNames = { fhw: "Federal Health & Welfare", met: "Multiemployer & Taft-Hartley", ca9: "California & Ninth Circuit", cyb: "Cybersecurity & Privacy", atf: "Apprenticeship & Training Funds" };
  for (const [s, { count, best }] of [...bySource.entries()].sort((a, b) => b[1].count - a[1].count)) {
    push({ source: s, scan: scanNames[best?.scan] ?? "—", result: "Omitted", note: shortNote(`${count} item${count === 1 ? "" : "s"} reviewed did not clear the relevance threshold${best?.reason ? `; closest: ${best.reason}` : ""}`) });
  }
  return rows;
}

/**
 * Build the issue. `candidates` carry their `pipeline` block; `review` is the
 * ReviewDecision file; `previous` is the last published issue (or null).
 */
export function buildIssue({ issueDate, candidates, review, previous = null, docsById = new Map(), omitted = [] }) {
  const previousIds = new Set((previous?.developments ?? []).map((d) => d.id));
  const released = [], rejected = [];
  for (const c of sortCandidates(candidates)) {
    const d = releaseDecision(c, review);
    if (!d.release) { rejected.push({ candidate: c, why: d.why, note: d.paralegal?.note || d.attorney?.note || "" }); continue; }
    const edited = applyEdits(c, d.paralegal, d.attorney);
    if (previousIds.has(c.id)) edited.carriedForward = true;
    released.push(edited);
  }
  const developments = sortCandidates(released).map(({ pipeline, ...dev }) => dev);
  return {
    issue: {
      issueDate: longDate(issueDate),
      issueDateISO: issueDate,
      issueSummary: readerSummaryLine(developments),
      developments,
      sourceLog: buildSourceLog({ released, rejected, docsById, omitted }),
    },
    released, rejected,
  };
}
