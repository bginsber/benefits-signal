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

/** Batch schema: one result per document, each in the single-document shape. */
export function batchSchema(scanIds) {
  const single = matchSchema(scanIds);
  return {
    type: "object", additionalProperties: false, required: ["results"],
    properties: { results: { type: "array", items: { type: "object", additionalProperties: false, required: ["document_id", ...single.required], properties: { document_id: { type: "string" }, ...single.properties } } } },
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

/** Several documents in one message, each introduced by its id. */
export function buildBatchUser(docs) {
  return `${docs.length} document${docs.length === 1 ? "" : "s"} to assess.\n\n${docs.map((d) => `=== document ${d.id} ===\n${buildUser(d)}`).join("\n\n")}`;
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
  if (res.stop_reason === "error" || !res.data) return { bucket: "skipped", record: { ...base, skipped: `model error: ${res.stop_details?.explanation ?? res.stop_reason}` } };
  if (res.stop_reason === "refusal") {
    return { bucket: "omitted", record: { ...base, omitted: true, defect: "refusal", reason: `MODEL REFUSAL (${res.stop_details?.category ?? "uncategorised"}): ${res.stop_details?.explanation ?? "no explanation"}`, summary: null, matches: [] } };
  }
  const { rows, inScope, omittedReason } = decide(res.data, scanIds);
  const record = { ...base, summary: res.data.summary, matches: rows, scan_ids: inScope };
  return inScope.length
    ? { bucket: "matches", record }
    : { bucket: "omitted", record: { ...record, omitted: true, reason: omittedReason } };
}

/**
 * Triage a batch of documents in one call. Fixture and record modes stay
 * per-document so recorded responses remain keyed by document id; live mode
 * sends the batch and maps results back by document_id, marking any the model
 * did not return as skipped rather than inventing a result.
 */
export async function triageBatch(docs, ctx) {
  const { client, prompt, system, scans } = ctx;
  if (docs.length === 1 || client.mode !== "live") {
    const out = [];
    for (const doc of docs) out.push({ doc, ...(await triageDocument(doc, ctx)) });
    return out;
  }
  const scanIds = scans.map((s) => s.id);
  const res = await client.complete({
    key: `${prompt.version}-batch-${docs.map((d) => d.id.slice(0, 8)).join("-")}`,
    system,
    user: buildBatchUser(docs),
    schema: batchSchema(scanIds),
    effort: "low",
    maxTokens: 1024 * docs.length,
  });
  const at = new Date().toISOString();
  const base = (doc) => ({ document_id: doc.id, source: doc.source, title: doc.title, link: doc.link, prompt_version: prompt.version, model: res.model, matched_at: at, usage: { ...res.usage, shared_by: docs.length } });
  if (!res.data) {
    const why = res.stop_reason === "refusal" ? `MODEL REFUSAL: ${res.stop_details?.explanation ?? ""}` : `model error: ${res.stop_details?.explanation ?? res.stop_reason}`;
    return docs.map((doc) => ({ doc, bucket: "skipped", record: { ...base(doc), skipped: why } }));
  }
  const byId = new Map((res.data.results ?? []).map((r) => [r.document_id, r]));
  return docs.map((doc) => {
    const r = byId.get(doc.id) ?? byId.get(doc.id.slice(0, 8));
    if (!r) return { doc, bucket: "skipped", record: { ...base(doc), skipped: "model returned no result for this document in its batch" } };
    const { rows, inScope, omittedReason } = decide(r, scanIds);
    const record = { ...base(doc), summary: r.summary, matches: rows, scan_ids: inScope };
    return inScope.length ? { doc, bucket: "matches", record } : { doc, bucket: "omitted", record: { ...record, omitted: true, reason: omittedReason } };
  });
}
