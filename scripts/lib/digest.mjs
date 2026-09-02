/**
 * Weekly candidate digest for the paralegal (spec § 6.7, Phase 1).
 *
 * Each candidate is rendered exactly as the newsletter would show it (the
 * same fields in the same order as src/App.jsx), followed by the reviewer
 * block: what the model argued, what verification found, which documents
 * were merged, what the enforcement layer corrected, and whether an
 * attorney must approve before publication. Output is Markdown for the
 * record and HTML for the review feed; both are rendered from the same data.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const LANE_ORDER = { NOW: 0, NEXT: 1, WATCH: 2 };
/** Attorney gate: every NOW item, and these tags (spec § 6.7 plus the § 14 item 1 default for Contribution Collection). */
export const ATTORNEY_GATE_TAGS = ["Prohibited Transactions & Expense Reasonableness", "Loyalty & Exclusive Benefit", "Contribution Collection & Delinquency"];

export function needsAttorney(dev) {
  const tags = dev.metadata?.["Fiduciary duties"] ?? [];
  const gated = tags.filter((t) => ATTORNEY_GATE_TAGS.includes(t));
  if (dev.lane === "NOW") return { required: true, why: gated.length ? `NOW item; tagged ${gated.join(", ")}` : "NOW item" };
  if (gated.length) return { required: true, why: `tagged ${gated.join(", ")}` };
  return { required: false, why: "" };
}

export function sortCandidates(list) {
  return [...list].sort((a, b) => (LANE_ORDER[a.lane] - LANE_ORDER[b.lane]) || a.headline.localeCompare(b.headline));
}

export async function readCandidates(dir) {
  let files = [];
  try { files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort(); } catch { return []; }
  const out = [];
  for (const f of files) out.push(JSON.parse(await readFile(path.join(dir, f), "utf8")));
  return sortCandidates(out);
}

/** Next Wednesday on or after `from` (the issue convention, spec § 2). */
export function nextIssueDate(from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + ((3 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}

export const longDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export function issueSummaryLine(candidates) {
  const n = candidates.length;
  if (n === 0) return "Nothing requires your attention this week.";
  const now = candidates.filter((c) => c.lane === "NOW").length;
  const words = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  const count = `${words[n] ?? n} candidate development${n === 1 ? "" : "s"} for review.`;
  return now ? `${count} ${now === 1 ? "One needs" : `${words[now] ?? now} need`} attorney sign-off.` : count;
}

/** Build a review template the paralegal fills by hand (ReviewDecision shape, spec § 5). Existing decisions are kept. */
export function buildReviewTemplate(issueDate, candidates, existing = null) {
  const prior = new Map((existing?.decisions ?? []).map((d) => [`${d.development_id}:${d.role}`, d]));
  const decisions = [];
  for (const c of candidates) {
    const gate = needsAttorney(c);
    const blank = (role) => prior.get(`${c.id}:${role}`) ?? { development_id: c.id, headline: c.headline, reviewer: "", role, decision: "", edits: {}, note: "", decided_at: null };
    decisions.push({ ...blank("paralegal") });
    if (gate.required) decisions.push({ ...blank("attorney"), gate_reason: gate.why });
  }
  return {
    issue_date: issueDate,
    generated_at: new Date().toISOString(),
    instructions: "Fill decision with approve, edit, reject, or defer. For edit, put the changed fields in edits as {field: newValue}. Attorney rows are required before a NOW item or a gated tag can publish. The publisher (scripts/publish.mjs) reads this file.",
    decisions,
  };
}

// ---------- rendering ----------

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const mdEsc = (s = "") => String(s).replace(/\|/g, "\\|");

function reviewerFacts(c) {
  const p = c.pipeline ?? {};
  const v = p.verification ?? {};
  const gate = needsAttorney(c);
  return {
    gate,
    tier: `${c.lane}${p.model_tier && p.model_tier !== c.lane ? ` (model proposed ${p.model_tier}; lowered by rule)` : ""}`,
    tierRationale: p.tier_rationale || "",
    confidence: `${c.metadata.Confidence[0]}${p.model_confidence && p.model_confidence !== c.metadata.Confidence[0] ? ` (model proposed ${p.model_confidence}; capped by verification)` : ""}`,
    justifications: p.fiduciary_justifications ?? [],
    verification: v,
    members: p.member_document_ids ?? [],
    passageDoc: p.passage_document_id ?? "",
    defects: p.defects ?? [],
    prompt: p.prompt_version ?? "",
    clusterLabel: p.cluster_label ?? "",
    whySame: p.why_same ?? "",
  };
}

export function renderMarkdown(issueDate, candidates, { docsById = new Map(), omittedCount = null } = {}) {
  const L = [];
  L.push(`# Benefits Signal — candidate digest for the issue of ${longDate(issueDate)}`);
  L.push("");
  L.push(`*${issueSummaryLine(candidates)}* Review each candidate below as it would appear in the newsletter, then the reviewer notes. Record decisions in \`data/reviews/${issueDate}.json\`. Nothing here is published until the paralegal releases the issue; NOW items and gated tags also need an attorney's approval.`);
  L.push("");
  if (!candidates.length) {
    L.push("No candidate cleared triage, verification, and assessment this week. Publishing an issue with zero developments is the correct outcome when nothing changed.");
    if (omittedCount != null) L.push(`${omittedCount} document(s) were triaged and omitted; they remain in \`data/omitted/\` for recall sampling.`);
    return L.join("\n") + "\n";
  }
  candidates.forEach((c, i) => {
    const f = reviewerFacts(c);
    L.push(`---`);
    L.push("");
    L.push(`## ${i + 1}. ${c.lane} · ${c.cue}`);
    L.push("");
    L.push(`### ${c.headline}`);
    L.push(`**${c.status}**`);
    L.push("");
    for (const p of c.summary) L.push(p, "");
    if (c.uncertainty) L.push(`> ${c.uncertainty}`, "");
    L.push("**Read briefing and evidence**", "");
    L.push(`- **Who:** ${c.affected}`);
    L.push(`- **What:** ${c.action}`);
    L.push(`- **By when:** ${c.timing}`);
    L.push(`- **Matched scan:** ${c.scan}`);
    for (const [label, values] of Object.entries(c.metadata)) L.push(`- **${label}:** ${values.join(" · ")}`);
    L.push(`- **Merged evidence:** ${c.mergedSources.join(" · ")}`);
    L.push(`- **Confidence rationale:** ${c.confidenceNote}`);
    L.push(`- **Supporting passage:** “${c.passage}”`);
    L.push(`- **Links:** [${c.articleLabel}](${c.articleUrl}) · [${c.authorityLabel}](${c.authorityUrl})`);
    L.push(`- **Suggested next step:** ${c.nextStep}. Nothing is sent or changed automatically. (On selection: “${c.completion}”)`);
    L.push("");
    L.push("#### Reviewer notes (not shown to readers)", "");
    L.push(`- **Attorney approval:** ${f.gate.required ? `REQUIRED — ${f.gate.why}` : "not required"}`);
    L.push(`- **Tier:** ${f.tier}${f.tierRationale ? ` — ${f.tierRationale}` : ""}`);
    L.push(`- **Confidence:** ${f.confidence}`);
    if (f.justifications.length) { L.push(`- **Fiduciary-duty justifications:**`); for (const j of f.justifications) L.push(`  - ${j.tag}: ${j.justification}`); }
    const v = f.verification;
    L.push(`- **Verification:** ${v.result ?? "n/a"}${v.checked_fields ? ` (status ${v.checked_fields.status}, dates ${v.checked_fields.dates}, posture ${v.checked_fields.posture})` : ""}${v.primary_link ? ` — primary: ${v.primary_link}` : " — no primary authority located"}`);
    if (v.notes) L.push(`  - ${v.notes}`);
    L.push(`- **Cluster:** ${f.clusterLabel}${f.whySame ? ` — ${f.whySame}` : ""}`);
    L.push(`- **Documents merged (${f.members.length}):**`);
    for (const id of f.members) {
      const d = docsById.get(id);
      L.push(`  - ${d ? `[${mdEsc(d.title)}](${d.link}) — ${d.source}${d.date ? `, ${d.date.slice(0, 10)}` : ""}` : id}${id === f.passageDoc ? " *(passage source)*" : ""}`);
    }
    L.push(`- **Rule corrections applied:** ${f.defects.length ? "" : "none"}`);
    for (const d of f.defects) L.push(`  - ${d}`);
    L.push(`- **Prompt version:** ${f.prompt}`);
    L.push("");
  });
  return L.join("\n") + "\n";
}

export function renderHtml(issueDate, candidates, opts = {}) {
  const { docsById = new Map(), omittedCount = null } = opts;
  const H = [];
  H.push(`<h1>Benefits Signal — candidate digest for the issue of ${esc(longDate(issueDate))}</h1>`);
  H.push(`<p><em>${esc(issueSummaryLine(candidates))}</em> Review each candidate as it would appear in the newsletter, then the reviewer notes. Record decisions in <code>data/reviews/${esc(issueDate)}.json</code>.</p>`);
  if (!candidates.length) {
    H.push(`<p>No candidate cleared triage, verification, and assessment this week.${omittedCount != null ? ` ${omittedCount} document(s) were triaged and omitted and remain available for recall sampling.` : ""}</p>`);
    return H.join("\n");
  }
  candidates.forEach((c, i) => {
    const f = reviewerFacts(c);
    H.push(`<hr/><h2>${i + 1}. ${esc(c.lane)} · ${esc(c.cue)}</h2><h3>${esc(c.headline)}</h3><p><strong>${esc(c.status)}</strong></p>`);
    for (const p of c.summary) H.push(`<p>${esc(p)}</p>`);
    if (c.uncertainty) H.push(`<p><em>${esc(c.uncertainty)}</em></p>`);
    H.push(`<p><strong>Read briefing and evidence</strong></p><ul>`);
    H.push(`<li><b>Who:</b> ${esc(c.affected)}</li><li><b>What:</b> ${esc(c.action)}</li><li><b>By when:</b> ${esc(c.timing)}</li><li><b>Matched scan:</b> ${esc(c.scan)}</li>`);
    for (const [label, values] of Object.entries(c.metadata)) H.push(`<li><b>${esc(label)}:</b> ${esc(values.join(" · "))}</li>`);
    H.push(`<li><b>Merged evidence:</b> ${esc(c.mergedSources.join(" · "))}</li><li><b>Confidence rationale:</b> ${esc(c.confidenceNote)}</li>`);
    H.push(`<li><b>Supporting passage:</b> “${esc(c.passage)}”</li>`);
    H.push(`<li><b>Links:</b> <a href="${esc(c.articleUrl)}">${esc(c.articleLabel)}</a> · <a href="${esc(c.authorityUrl)}">${esc(c.authorityLabel)}</a></li>`);
    H.push(`<li><b>Suggested next step:</b> ${esc(c.nextStep)}. Nothing is sent or changed automatically.</li></ul>`);
    H.push(`<p><strong>Reviewer notes (not shown to readers)</strong></p><ul>`);
    H.push(`<li><b>Attorney approval:</b> ${f.gate.required ? `REQUIRED — ${esc(f.gate.why)}` : "not required"}</li>`);
    H.push(`<li><b>Tier:</b> ${esc(f.tier)}${f.tierRationale ? ` — ${esc(f.tierRationale)}` : ""}</li><li><b>Confidence:</b> ${esc(f.confidence)}</li>`);
    if (f.justifications.length) H.push(`<li><b>Fiduciary-duty justifications:</b><ul>${f.justifications.map((j) => `<li>${esc(j.tag)}: ${esc(j.justification)}</li>`).join("")}</ul></li>`);
    const v = f.verification;
    H.push(`<li><b>Verification:</b> ${esc(v.result ?? "n/a")}${v.checked_fields ? ` (status ${esc(v.checked_fields.status)}, dates ${esc(v.checked_fields.dates)}, posture ${esc(v.checked_fields.posture)})` : ""}${v.primary_link ? ` — <a href="${esc(v.primary_link)}">primary</a>` : " — no primary authority located"}${v.notes ? `<br/>${esc(v.notes)}` : ""}</li>`);
    H.push(`<li><b>Cluster:</b> ${esc(f.clusterLabel)}${f.whySame ? ` — ${esc(f.whySame)}` : ""}</li>`);
    H.push(`<li><b>Documents merged (${f.members.length}):</b><ul>${f.members.map((id) => { const d = docsById.get(id); return `<li>${d ? `<a href="${esc(d.link)}">${esc(d.title)}</a> — ${esc(d.source)}${d.date ? `, ${d.date.slice(0, 10)}` : ""}` : esc(id)}${id === f.passageDoc ? " <em>(passage source)</em>" : ""}</li>`; }).join("")}</ul></li>`);
    H.push(`<li><b>Rule corrections applied:</b> ${f.defects.length ? `<ul>${f.defects.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "none"}</li><li><b>Prompt version:</b> ${esc(f.prompt)}</li></ul>`);
  });
  return H.join("\n");
}

/** RSS 2.0 review feed: one item per digest, newest first. */
export function renderReviewFeed(digests, { feedUrl = "https://example.invalid/benefits-signal/review.xml" } = {}) {
  const now = new Date().toUTCString();
  const items = [...digests].sort((a, b) => b.issueDate.localeCompare(a.issueDate)).slice(0, 20).map((d) => `    <item>
      <title>${esc(`[Review] Candidate digest — issue of ${longDate(d.issueDate)}: ${issueSummaryLine(d.candidates)}`)}</title>
      <link>${esc(d.link)}</link>
      <guid isPermaLink="false">benefits-signal-review-${esc(d.issueDate)}</guid>
      <pubDate>${new Date(d.generatedAt ?? Date.now()).toUTCString()}</pubDate>
      <category>Review queue</category>
      <description>${esc(renderHtml(d.issueDate, d.candidates, d.opts))}</description>
    </item>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Benefits Signal — Review Queue</title>
    <link>${esc(feedUrl)}</link>
    <description>Weekly candidate digests for the paralegal's review. AI-assisted assessments awaiting human decision; nothing here is published or legal advice.</description>
    <language>en-us</language>
    <lastBuildDate>${now}</lastBuildDate>
    <ttl>1440</ttl>
${items}
  </channel>
</rss>
`;
}

// ---------- trustees' meeting handout (spec § 13 Phase 3; goal M7) ----------

export const NONE_TAG = "None — Settlor or Administrative";

/** Candidates carrying at least one fiduciary-duty tag other than None. */
export function trusteeAgendaItems(candidates) {
  return sortCandidates(candidates.filter((c) => (c.metadata?.["Fiduciary duties"] ?? []).some((t) => t !== NONE_TAG)));
}

/** A handout the attorneys may choose to use: what each item does to a trustee duty, and nothing the reviewer-only block carries. */
export function renderTrusteeAgenda(issueDate, candidates) {
  const items = trusteeAgendaItems(candidates);
  const L = [`# Trustees' meeting agenda — items touching fiduciary duties`, "", `*Prepared from the Benefits Signal issue of ${longDate(issueDate)}. For attorney review before any use; not legal advice.*`, ""];
  if (!items.length) { L.push("No development in this issue changes a trustee duty."); return L.join("\n") + "\n"; }
  const byTag = new Map();
  for (const c of items) for (const t of c.metadata["Fiduciary duties"]) if (t !== NONE_TAG) byTag.set(t, [...(byTag.get(t) ?? []), c]);
  L.push(`Duties touched: ${[...byTag.keys()].join(" · ")}`, "");
  items.forEach((c, i) => {
    const just = new Map((c.pipeline?.fiduciary_justifications ?? []).map((j) => [j.tag, j.justification]));
    L.push(`## ${i + 1}. ${c.headline}`, `**${c.status}** · ${c.lane}`, "");
    for (const t of c.metadata["Fiduciary duties"].filter((t) => t !== NONE_TAG)) L.push(`- **${t}:** ${just.get(t) ?? "(justification not recorded)"}`);
    L.push(`- **Who:** ${c.affected}`, `- **What:** ${c.action}`, `- **By when:** ${c.timing}`, `- **Suggested next step:** ${c.nextStep}`, `- **Authority:** [${c.authorityLabel}](${c.authorityUrl})`, "");
  });
  return L.join("\n") + "\n";
}
