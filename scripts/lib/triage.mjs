/**
 * Triage stage: normalize (two-sentence summary) + scan match (spec § 6.2–6.3).
 *
 * One model call per document returns the summary and one ScanMatch row per
 * scan. Code, not the model, applies the conservative threshold and decides
 * the in-scope / omitted split. Omitted documents keep the model's reason
 * verbatim and are never deleted; they are the pool for recall sampling.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** A scan is in scope only when the model says so and its score clears this bar. */
export const IN_SCOPE_THRESHOLD = 0.6;

export function matchSchema(scanIds) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "matches"],
    properties: {
      summary: { type: "string", description: "Two neutral sentences: what the document is and what it says." },
      matches: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["scan_id", "score", "in_scope", "reason"],
          properties: {
            scan_id: { type: "string", enum: scanIds },
            score: { type: "number", description: "0 to 1: how clearly the scan's charter covers this document." },
            in_scope: { type: "boolean" },
            reason: { type: "string", description: "One sentence a paralegal can check against the document." },
          },
        },
      },
    },
  };
}

/** Stable system prompt: prompt body, then the scan charters. Cached across documents. */
export function buildSystem(prompt, scans) {
  const charters = scans.map((s) => [
    `### ${s.id} — ${s.name}`,
    s.charter.trim(),
    `Primary authorities: ${s.primary_authorities.join("; ")}.`,
    `Plan types served: ${s.plan_types.join("; ")}.`,
    `Out of scope for this scan: ${s.out_of_scope.map((r) => r.trim()).join(" ")}`,
  ].join("\n")).join("\n\n");
  return [prompt.body, `## Saved scans\n\n${charters}`];
}

/** The per-document user message. Only fields the collector stored; no fetched full text. */
export function buildUser(doc) {
  const lines = [
    `Source: ${doc.source}`,
    `Title: ${doc.title}`,
    doc.date ? `Date: ${doc.date.slice(0, 10)}` : null,
    doc.categories?.length ? `Categories: ${doc.categories.join(", ")}` : null,
    doc.structured ? `Structured fields: ${JSON.stringify(doc.structured)}` : null,
    `Link: ${doc.link}`,
    "",
    "Text as collected:",
    doc.summary || "(no text beyond the title)",
  ].filter((l) => l !== null);
  return lines.join("\n");
}

/** Apply the threshold and normalise the model's rows into ScanMatch rows, one per scan. */
export function decide(data, scanIds, threshold = IN_SCOPE_THRESHOLD) {
  const byScan = new Map((data?.matches ?? []).map((m) => [m.scan_id, m]));
  const rows = scanIds.map((id) => {
    const m = byScan.get(id);
    const score = Math.min(1, Math.max(0, Number(m?.score ?? 0)));
    return { scan_id: id, score, in_scope: Boolean(m?.in_scope) && score >= threshold, reason: String(m?.reason ?? "no row returned for this scan") };
  });
  const inScope = rows.filter((r) => r.in_scope).map((r) => r.scan_id);
  // Omission reason: the model's own words for the scan it came closest to.
  const closest = [...rows].sort((a, b) => b.score - a.score)[0];
  return { rows, inScope, omittedReason: inScope.length ? null : closest.reason };
}

export async function readCollected(dir) {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const docs = [];
  for (const f of files) docs.push({ id: f.replace(/\.json$/, ""), ...JSON.parse(await readFile(path.join(dir, f), "utf8")) });
  return docs;
}

/** Triage one document. Returns the record to write and where it belongs. */
export async function triageDocument(doc, { client, prompt, system, scans }) {
  const scanIds = scans.map((s) => s.id);
  const res = await client.complete({
    key: `${prompt.version}-${doc.id}`,
    system,
    user: buildUser(doc),
    schema: matchSchema(scanIds),
    effort: "low",
    maxTokens: 1024,
  });
  const base = { document_id: doc.id, source: doc.source, title: doc.title, link: doc.link, prompt_version: prompt.version, model: res.model, matched_at: new Date().toISOString(), usage: res.usage };
  if (res.stop_reason === "no_fixture") return { bucket: "skipped", record: { ...base, skipped: "no fixture recorded for this document" } };
  if (res.stop_reason === "refusal") {
    return { bucket: "omitted", record: { ...base, omitted: true, defect: "refusal", reason: `MODEL REFUSAL (${res.stop_details?.category ?? "uncategorised"}): ${res.stop_details?.explanation ?? "no explanation"}`, summary: null, matches: [] } };
  }
  const { rows, inScope, omittedReason } = decide(res.data, scanIds);
  const record = { ...base, summary: res.data.summary, matches: rows, scan_ids: inScope };
  return inScope.length
    ? { bucket: "matches", record }
    : { bucket: "omitted", record: { ...record, omitted: true, reason: omittedReason } };
}
