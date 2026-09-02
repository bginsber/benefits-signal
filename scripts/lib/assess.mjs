/**
 * Cluster → verify → assess (spec § 6.4–6.6).
 *
 * Produces Development candidates in the exact shape spec/issue-schema.json
 * describes, plus a `pipeline` block the front end ignores (cluster members,
 * verification record, justifications, prompt versions, defects). The rules
 * the spec makes non-negotiable are enforced here in code as well as in the
 * prompts: tier follows confirmed dates, confidence follows verification, the
 * supporting passage is verbatim, tags and next steps come from closed lists.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./sources.mjs";
import { fetchText } from "./collectors.mjs";

export const SCAN_NAMES = { fhw: "Federal Health & Welfare", met: "Multiemployer & Taft-Hartley", ca9: "California & Ninth Circuit", cyb: "Cybersecurity & Privacy", atf: "Apprenticeship & Training Funds" };
export const PLAN_TYPES = ["Health & welfare", "Multiemployer", "Self-funded", "Training trust / apprenticeship fund", "Service providers", "All welfare plans"];
export const FIDUCIARY_TAGS = [
  "Prudence & Process", "Loyalty & Exclusive Benefit", "Plan Document & Trust Conformity", "Reporting & Disclosure",
  "Prohibited Transactions & Expense Reasonableness", "Co-Fiduciary, Delegation & Bonding", "Claims & Appeals Procedure",
  "Contribution Collection & Delinquency", "Program & Funding Compliance", "None — Settlor or Administrative",
];
export const NONE_TAG = "None — Settlor or Administrative";
export const NEXT_STEPS = [
  "Prepare internal research assignment", "Add deadline to review queue", "Create monitoring follow-up",
  "Flag for trustees' meeting agenda", "Request service-provider confirmation", "No action — informational",
];
export const NOW_WINDOW_DAYS = 60;

const key = (...parts) => createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
const isPrimary = (doc) => /^(Federal Register|CourtListener)/.test(doc.source) || /California DAS/.test(doc.source);
const norm = (s) => String(s ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
const docText = (doc) => norm(`${doc.title}. ${doc.summary ?? ""}`);
const slug = (s) => norm(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

export function docLine(doc) {
  const extra = doc.structured ? ` · ${Object.entries(doc.structured).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ")}` : "";
  return `[document ${doc.id} · ${doc.source}${doc.date ? ` · ${doc.date.slice(0, 10)}` : ""}${(doc.categories ?? []).length ? ` · ${doc.categories.slice(0, 3).join(", ")}` : ""}${extra}]\n${doc.title}. ${doc.summary ?? ""}`;
}

// ---------- 6.4 cluster ----------

export const clusterSchema = {
  type: "object", additionalProperties: false, required: ["clusters"],
  properties: {
    clusters: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["label", "document_ids", "existing_development_id", "why_same"],
        properties: {
          label: { type: "string" },
          document_ids: { type: "array", items: { type: "string" } },
          existing_development_id: { type: ["string", "null"] },
          why_same: { type: "string" },
        },
      },
    },
  },
};

export function buildClusterUser(docs, openDevelopments = []) {
  const open = openDevelopments.length
    ? `Open developments from earlier issues:\n${openDevelopments.map((d) => `[development ${d.id} · ${d.lane}] ${d.headline} — ${d.status}`).join("\n")}\n\n`
    : "No developments are open from earlier issues.\n\n";
  return `${open}Documents to cluster (${docs.length}):\n\n${docs.map((d) => `${docLine(d)}\nScans: ${(d.scan_ids ?? []).join(", ")}\nMatcher summary: ${d.triage_summary ?? ""}`).join("\n\n")}`;
}

/** Group in-scope documents by underlying development; every document lands in exactly one cluster. */
export async function clusterDocuments(docs, { client, prompt, openDevelopments = [] }) {
  if (!docs.length) return [];
  const ids = docs.map((d) => d.id).sort();
  const res = await client.complete({
    key: `${prompt.version}-${key(...ids)}`,
    system: [prompt.body],
    user: buildClusterUser(docs, openDevelopments),
    schema: clusterSchema,
    effort: "low",
    maxTokens: 4096,
  });
  const byId = new Map(docs.map((d) => [d.id, d]));
  const placed = new Set();
  const clusters = [];
  if (res.data) {
    for (const c of res.data.clusters ?? []) {
      const members = c.document_ids.filter((id) => byId.has(id) && !placed.has(id));
      if (!members.length) continue;
      members.forEach((id) => placed.add(id));
      clusters.push({ id: key(...members.sort()), label: c.label, why_same: c.why_same, existing_development_id: c.existing_development_id ?? null, document_ids: members });
    }
  }
  // Anything the model left out (or no fixture) becomes its own cluster; nothing is dropped.
  for (const d of docs) if (!placed.has(d.id)) clusters.push({ id: key(d.id), label: d.title, why_same: res.data ? "not placed by the model; kept as its own cluster" : "no cluster response; kept as its own cluster", existing_development_id: null, document_ids: [d.id] });
  for (const c of clusters) {
    const members = c.document_ids.map((id) => byId.get(id));
    c.scan_ids = [...new Set(members.flatMap((m) => m.scan_ids ?? []))];
    c.sources = [...new Set(members.map((m) => m.source.replace(/ — .*/, "")))];
  }
  return clusters;
}

// ---------- 6.5 primary lookup + verify ----------

const FR_DOC = /\b(20\d{2}-\d{4,6})\b/;
const FR_LINK = /federalregister\.gov\/(?:documents|d)\/(?:\d{4}\/\d{2}\/\d{2}\/)?(20\d{2}-\d{4,6})/;

/**
 * Locate primary authority for a cluster: first among its own primary-layer
 * members, then by targeted Federal Register lookup from document numbers or
 * links in the commentary. Network lookups are skipped when `offline` is set.
 */
export async function locatePrimary(cluster, docsById, { offline = false, fetch = fetchText } = {}) {
  const members = cluster.document_ids.map((id) => docsById.get(id));
  const primary = members.filter(isPrimary);
  if (primary.length) return { primary: primary[0], candidates: primary, lookup: "in-cluster" };
  const commentary = members.filter((d) => !isPrimary(d));
  const numbers = new Set();
  for (const d of commentary) {
    const m = `${d.summary ?? ""} ${d.link}`.match(FR_LINK) ?? `${d.summary ?? ""}`.match(FR_DOC);
    if (m) numbers.add(m[1]);
  }
  if (!numbers.size || offline) return { primary: null, candidates: [], lookup: numbers.size ? "skipped (offline)" : "no document number or primary link in commentary" };
  for (const n of numbers) {
    try {
      const fields = ["title", "html_url", "publication_date", "agency_names", "type", "abstract", "comments_close_on", "effective_on", "document_number", "docket_ids"];
      const j = JSON.parse(await fetch(`https://www.federalregister.gov/api/v1/documents/${n}.json?${fields.map((f) => `fields[]=${f}`).join("&")}`));
      const doc = { id: `fr-${n}`, source: `Federal Register — ${(j.agency_names ?? []).join(", ")}`, title: j.title, link: j.html_url, date: j.publication_date ? `${j.publication_date}T12:00:00.000Z` : null, summary: j.abstract ?? "", categories: [j.type].filter(Boolean), structured: { document_number: j.document_number, comments_close_on: j.comments_close_on, effective_on: j.effective_on, docket_ids: j.docket_ids }, looked_up: true };
      return { primary: doc, candidates: [doc], lookup: `federal register ${n}` };
    } catch (e) {
      return { primary: null, candidates: [], lookup: `federal register ${n} lookup failed: ${e.message}` };
    }
  }
  return { primary: null, candidates: [], lookup: "no primary located" };
}

const FIELD = { enum: ["confirmed", "partially_confirmed", "unconfirmed"] };
export const verifySchema = {
  type: "object", additionalProperties: false, required: ["status", "dates", "posture", "result", "notes"],
  properties: { status: FIELD, dates: FIELD, posture: FIELD, result: FIELD, notes: { type: "string" } },
};

export function buildVerifyUser(cluster, members, primary) {
  const commentary = members.filter((d) => d.id !== primary.id);
  return `Development: ${cluster.label}\n\nPrimary document (the only source of status, dates, and posture):\n${docLine(primary)}\n\nCommentary to check (${commentary.length}):\n${commentary.length ? commentary.map(docLine).join("\n\n") : "(none — the primary document is the only member; check its own stated fields for internal consistency and record what it does not state)"}`;
}

export async function verifyCluster(cluster, docsById, { client, prompt, offline = false }) {
  const members = cluster.document_ids.map((id) => docsById.get(id));
  const { primary, lookup } = await locatePrimary(cluster, docsById, { offline });
  const base = { development_cluster_id: cluster.id, primary_document_id: primary?.id ?? null, primary_link: primary?.link ?? null, lookup, checked_at: new Date().toISOString(), prompt_version: prompt.version };
  if (!primary) {
    return { ...base, checked_fields: { status: "unconfirmed", dates: "unconfirmed", posture: "unconfirmed" }, result: "unconfirmed", notes: "No primary authority located; commentary only. Status and dates are as the commentary states them and have not been checked against the agency, court, or register.", model: null };
  }
  const ask = () => client.complete({
    key: `${prompt.version}-${cluster.id}`,
    system: [prompt.body],
    user: buildVerifyUser(cluster, members, primary),
    schema: verifySchema,
    effort: "high",
    maxTokens: 2048,
  });
  let res = await ask();
  if (!res.data && res.stop_reason === "error") res = await ask(); // one retry; a blocked tool attempt is the usual cause
  if (!res.data) {
    return { ...base, checked_fields: { status: "unconfirmed", dates: "unconfirmed", posture: "unconfirmed" }, result: "unconfirmed", notes: `Verification not performed (${res.stop_reason}); treated as unconfirmed.`, model: res.model, stop_reason: res.stop_reason };
  }
  const { status, dates, posture, notes } = res.data;
  const all = [status, dates, posture];
  const result = all.every((f) => f === "confirmed") ? "confirmed" : all.some((f) => f === "confirmed") ? "partially_confirmed" : "unconfirmed";
  return { ...base, primary, checked_fields: { status, dates, posture }, result, notes, model: res.model, usage: res.usage };
}

// ---------- 6.6 assess ----------

export function assessSchema() {
  const arr = (items) => ({ type: "array", items });
  return {
    type: "object", additionalProperties: false,
    required: ["headline", "status", "summary", "uncertainty", "affected", "action", "timing", "tier", "operative_date", "tier_rationale",
      "confidence", "confidenceNote", "plan_types", "jurisdiction", "topics", "fiduciary_duties", "fiduciary_justifications",
      "nextStep", "completion", "passage", "passage_document_id", "articleLabel", "article_document_id", "authorityLabel", "authority_document_id"],
    properties: {
      headline: { type: "string" }, status: { type: "string" },
      summary: arr({ type: "string" }),
      uncertainty: { type: "string", description: "Empty string when uncertainty does not change how the reader should act." },
      affected: { type: "string" }, action: { type: "string" }, timing: { type: "string" },
      tier: { type: "string", enum: ["NOW", "NEXT", "WATCH"] },
      operative_date: { type: ["string", "null"], description: "ISO date of the confirmed deadline or effective date, else null." },
      tier_rationale: { type: "string" },
      confidence: { type: "string", enum: ["High", "Medium", "Low"] },
      confidenceNote: { type: "string" },
      plan_types: arr({ type: "string", enum: PLAN_TYPES }),
      jurisdiction: arr({ type: "string" }),
      topics: arr({ type: "string" }),
      fiduciary_duties: arr({ type: "string", enum: FIDUCIARY_TAGS }),
      fiduciary_justifications: arr({ type: "object", additionalProperties: false, required: ["tag", "justification"], properties: { tag: { type: "string", enum: FIDUCIARY_TAGS }, justification: { type: "string" } } }),
      nextStep: { type: "string", enum: NEXT_STEPS },
      completion: { type: "string" },
      passage: { type: "string" }, passage_document_id: { type: "string" },
      articleLabel: { type: "string" }, article_document_id: { type: "string" },
      authorityLabel: { type: "string" }, authority_document_id: { type: "string" },
    },
  };
}

export async function loadTaxonomyText() {
  // The taxonomy and the closed next-step list are read from the spec so the prompt and the reviewer share one text.
  const spec = await readFile(path.join(ROOT, "spec", "benefits-signal-pipeline-spec.md"), "utf8");
  const tax = spec.slice(spec.indexOf("## 7. Fiduciary-duty tag taxonomy"), spec.indexOf("## 8. Suggested next steps"));
  const steps = spec.slice(spec.indexOf("## 8. Suggested next steps"), spec.indexOf("## 9. Model and prompt architecture"));
  return `${tax.trim()}\n\n${steps.trim()}`;
}

export function buildAssessSystem(prompt, scans, taxonomyText) {
  const charters = scans.map((s) => `### ${s.id} — ${s.name}\n${s.charter.trim()}`).join("\n\n");
  return [prompt.body, `## Saved scans\n\n${charters}\n\n## Fiduciary-duty taxonomy and next steps (spec § 7–8)\n\n${taxonomyText}`];
}

export function buildAssessUser(cluster, members, verification) {
  const v = verification;
  const vLine = `[verification · primary ${v.primary_document_id ?? "none"} · status ${v.checked_fields.status} · dates ${v.checked_fields.dates} · posture ${v.checked_fields.posture} · result ${v.result}]\n${v.notes}`;
  return `Development: ${cluster.label}\nScans matched: ${cluster.scan_ids.map((s) => SCAN_NAMES[s] ?? s).join("; ")}\nSources in cluster: ${cluster.sources.join("; ")}\n\n${members.map(docLine).join("\n\n")}\n\n${vLine}`;
}

/** Enforce the spec's rules on the model's draft. Returns the schema-shaped development and the defects found. */
export function enforce(draft, cluster, members, verification, { today = new Date() } = {}) {
  const defects = [];
  const byId = new Map(members.map((m) => [m.id, m]));
  const datesConfirmed = verification.checked_fields.dates === "confirmed";
  const statusConfirmed = verification.checked_fields.status === "confirmed";

  // Tier: NOW and NEXT need a confirmed date; NOW additionally needs the date within the window or a confirmed status change.
  let tier = draft.tier;
  let uncertainty = norm(draft.uncertainty);
  const opDate = draft.operative_date && /^\d{4}-\d{2}-\d{2}$/.test(draft.operative_date) ? draft.operative_date : null;
  const daysOut = opDate ? Math.round((new Date(`${opDate}T12:00:00Z`) - today) / 86400000) : null;
  if ((tier === "NOW" || tier === "NEXT") && !datesConfirmed) {
    defects.push(`tier lowered from ${tier} to WATCH: dates ${verification.checked_fields.dates}`);
    tier = "WATCH";
    if (!uncertainty) uncertainty = "The operative date has not been confirmed against primary authority; treat the timing as unsettled until it is.";
  } else if (tier === "NOW" && !(daysOut !== null && daysOut <= NOW_WINDOW_DAYS) && !statusConfirmed) {
    defects.push(`tier lowered from NOW to NEXT: no confirmed deadline within ${NOW_WINDOW_DAYS} days and status ${verification.checked_fields.status}`);
    tier = "NEXT";
  }

  // Confidence: capped by verification, never raised.
  const cap = verification.result === "confirmed" ? "High" : statusConfirmed || (verification.result === "unconfirmed" && cluster.sources.length >= 1 && members.some((m) => !isPrimary(m))) ? "Medium" : "Low";
  const rank = { High: 3, Medium: 2, Low: 1 };
  let confidence = draft.confidence;
  if (verification.result === "unconfirmed" && members.length === 1) { if (rank[confidence] > 1) defects.push(`confidence lowered from ${confidence} to Low: single unverified source`); confidence = "Low"; }
  else if (rank[confidence] > rank[cap]) { defects.push(`confidence lowered from ${confidence} to ${cap}: verification ${verification.result}`); confidence = cap; }

  // Passage: verbatim from one member, at most a short paragraph.
  let passage = norm(draft.passage);
  let passageDoc = byId.get(draft.passage_document_id) ?? null;
  const verbatim = passageDoc && passage && docText(passageDoc).includes(passage);
  if (!verbatim) {
    const holder = members.find((m) => docText(m).includes(passage));
    if (passage && holder) { passageDoc = holder; defects.push(`passage attributed to ${holder.id} (model cited ${draft.passage_document_id})`); }
    else {
      passageDoc = passageDoc ?? members[0];
      const fallback = norm(passageDoc.summary || passageDoc.title);
      defects.push(`passage was not verbatim; replaced with the stored text of ${passageDoc.id}`);
      passage = fallback.length > 400 ? fallback.slice(0, fallback.lastIndexOf(" ", 400)) : fallback;
    }
  }
  if (passage.length > 600) { passage = passage.slice(0, passage.lastIndexOf(" ", 600)); defects.push("passage truncated to a short paragraph"); }

  // Fiduciary tags: closed list; None is exclusive; every tag needs a justification.
  let tags = [...new Set((draft.fiduciary_duties ?? []).filter((t) => FIDUCIARY_TAGS.includes(t)))];
  const just = new Map((draft.fiduciary_justifications ?? []).filter((j) => norm(j.justification)).map((j) => [j.tag, norm(j.justification)]));
  const unjustified = tags.filter((t) => t !== NONE_TAG && !just.has(t));
  if (unjustified.length) { defects.push(`tags without justification dropped: ${unjustified.join(", ")}`); tags = tags.filter((t) => !unjustified.includes(t)); }
  if (tags.includes(NONE_TAG) && tags.length > 1) { defects.push("None tag is exclusive; other tags dropped"); tags = [NONE_TAG]; }
  if (!tags.length) { tags = [NONE_TAG]; if (draft.fiduciary_duties?.length) defects.push("no justified tag remained; recorded as None"); }

  const nextStep = NEXT_STEPS.includes(draft.nextStep) ? draft.nextStep : (defects.push(`nextStep "${draft.nextStep}" not in closed list; set to informational`), "No action — informational");
  const article = byId.get(draft.article_document_id) ?? members.find((m) => !isPrimary(m)) ?? members[0];
  const authority = byId.get(draft.authority_document_id) ?? verification.primary ?? members.find(isPrimary) ?? article;
  const planTypes = (draft.plan_types ?? []).filter((p) => PLAN_TYPES.includes(p));
  const cue = tier === "NOW" ? "Attorney review" : tier === "NEXT" && opDate ? longDate(opDate) : tier === "NEXT" ? "Date confirmed" : "No action yet";

  const development = {
    id: cluster.existing_development_id ?? slug(draft.headline),
    lane: tier, cue,
    headline: norm(draft.headline), status: norm(draft.status),
    summary: (draft.summary ?? []).map(norm).filter(Boolean).slice(0, 3),
    ...(uncertainty ? { uncertainty } : {}),
    metadata: {
      "Plan type": planTypes.length ? planTypes : ["All welfare plans"],
      Jurisdiction: (draft.jurisdiction ?? []).map(norm).filter(Boolean),
      Topics: (draft.topics ?? []).map(norm).filter(Boolean).slice(0, 5),
      Confidence: [confidence],
      "Fiduciary duties": tags,
    },
    confidenceNote: norm(draft.confidenceNote),
    scan: SCAN_NAMES[cluster.scan_ids[0]] ?? SCAN_NAMES.fhw,
    affected: norm(draft.affected), action: norm(draft.action), timing: norm(draft.timing),
    mergedSources: cluster.sources,
    nextStep, completion: norm(draft.completion),
    passage,
    articleLabel: norm(draft.articleLabel) || article.source.replace(/ — .*/, ""), articleUrl: article.link,
    authorityLabel: norm(draft.authorityLabel) || authority.source, authorityUrl: authority.link,
  };
  if (!development.summary.length) { development.summary = [norm(draft.headline)]; defects.push("empty summary; headline used"); }
  return { development, defects, tags: tags.map((t) => ({ tag: t, justification: t === NONE_TAG ? (just.get(t) ?? "No change to trustee responsibility.") : just.get(t) })), passage_document_id: passageDoc.id, operative_date: opDate, tier_rationale: norm(draft.tier_rationale), model_tier: draft.tier, model_confidence: draft.confidence };
}

function longDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export async function assessCluster(cluster, docsById, verification, { client, prompt, system, today }) {
  const members = cluster.document_ids.map((id) => docsById.get(id));
  const res = await client.complete({
    key: `${prompt.version}-${cluster.id}`,
    system,
    user: buildAssessUser(cluster, members, verification),
    schema: assessSchema(),
    effort: "high",
    maxTokens: 4096,
  });
  if (!res.data) return { candidate: null, stop_reason: res.stop_reason, stop_details: res.stop_details ?? null };
  const out = enforce(res.data, cluster, members, verification, { today });
  return {
    candidate: {
      ...out.development,
      pipeline: {
        cluster_id: cluster.id, cluster_label: cluster.label, why_same: cluster.why_same,
        member_document_ids: cluster.document_ids, scan_ids: cluster.scan_ids,
        verification: { ...verification, primary: undefined },
        fiduciary_justifications: out.tags, passage_document_id: out.passage_document_id,
        operative_date: out.operative_date, tier_rationale: out.tier_rationale,
        model_tier: out.model_tier, model_confidence: out.model_confidence,
        defects: out.defects, prompt_version: prompt.version, model: res.model, usage: res.usage,
        review_state: "pending", assessed_at: new Date().toISOString(),
      },
    },
    stop_reason: res.stop_reason,
  };
}
