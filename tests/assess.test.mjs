import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { NONE_TAG, enforce } from "../scripts/lib/assess.mjs";
import { validate } from "../scripts/lib/schema.mjs";

const run = promisify(execFile);
const ROOT = new URL("..", import.meta.url).pathname;
const schema = JSON.parse(await readFile(path.join(ROOT, "spec/issue-schema.json"), "utf8"));

// ---- shared scaffolding for the rule tests ----
const DOC = { id: "fr-1", source: "Federal Register — Employee Benefits Security Administration", title: "Cybersecurity Program Requirements for Employee Benefit Plans", link: "https://www.federalregister.gov/d/2026-0412", date: "2026-08-20T12:00:00.000Z", summary: "Proposed Rule · Comments close 2026-09-30 — Plans would be expected to maintain a documented program proportionate to their systems, data, and service-provider relationships.", categories: ["Proposed Rule"], structured: { comments_close_on: "2026-09-30" } };
const COMMENTARY = { id: "ifebp-1", source: "Word on Benefits (IFEBP)", title: "DOL Proposes Plan Cybersecurity Rule", link: "https://blog.ifebp.org/x", date: "2026-08-21T12:00:00.000Z", summary: "The post walks through the written-program and incident-reporting elements.", categories: [] };
const cluster = (members) => ({ id: "c1", label: "DOL cybersecurity proposal", why_same: "same rule", existing_development_id: null, document_ids: members.map((m) => m.id), scan_ids: ["cyb", "fhw"], sources: [...new Set(members.map((m) => m.source.replace(/ — .*/, "")))] });
const verification = (status, dates, posture) => {
  const all = [status, dates, posture];
  return { primary_document_id: "fr-1", checked_fields: { status, dates, posture }, result: all.every((f) => f === "confirmed") ? "confirmed" : all.some((f) => f === "confirmed") ? "partially_confirmed" : "unconfirmed", notes: "n" };
};
const draft = (over = {}) => ({
  headline: "DOL proposes cybersecurity program requirements", status: "Proposed · Comments due September 30",
  summary: ["Would require a written cybersecurity program."], uncertainty: "", affected: "Multiemployer plans", action: "Decide whether to comment.", timing: "Before September 30",
  tier: "NOW", operative_date: "2026-09-30", tier_rationale: "confirmed deadline within 60 days", confidence: "High", confidenceNote: "FR confirms status and deadline.",
  plan_types: ["Health & welfare", "Multiemployer"], jurisdiction: ["Federal"], topics: ["Cybersecurity"],
  fiduciary_duties: ["Prudence & Process"], fiduciary_justifications: [{ tag: "Prudence & Process", justification: "Sets what a prudent trustee must document." }],
  nextStep: "Prepare internal research assignment", completion: "Research assignment prepared for attorney review.",
  passage: "Plans would be expected to maintain a documented program proportionate to their systems, data, and service-provider relationships.", passage_document_id: "fr-1",
  articleLabel: "Word on Benefits", article_document_id: "ifebp-1", authorityLabel: "Federal Register", authority_document_id: "fr-1",
  ...over,
});
const TODAY = new Date("2026-09-01T12:00:00Z");

test("fixture-mode assess writes candidates that validate against spec/issue-schema.json and records the verification result", async () => {
  const out = await mkdtemp(path.join(tmpdir(), "assess-"));
  const { stdout } = await run("node", [path.join(ROOT, "scripts/assess.mjs"), "--fixture", "--out", out, "--today", "2026-09-01"]);
  assert.match(stdout, /3 candidates from 3 clusters \(0 unassessed\)/);
  assert.match(stdout, /0 schema errors/);
  const files = await readdir(path.join(out, "candidates"));
  assert.equal(files.length, 3);
  const results = {};
  for (const f of files) {
    const { pipeline, ...dev } = JSON.parse(await readFile(path.join(out, "candidates", f), "utf8"));
    assert.deepEqual(validate(dev, schema.$defs.development, schema), [], `${f} must match the development schema`);
    assert.ok(["confirmed", "partially_confirmed", "unconfirmed"].includes(pipeline.verification.result));
    assert.equal(pipeline.prompt_version, "assess@1");
    results[dev.id] = { lane: dev.lane, confidence: dev.metadata.Confidence[0], verification: pipeline.verification.result, defects: pipeline.defects };
  }
  const pbm = Object.values(results).find((r) => r.verification === "unconfirmed");
  assert.deepEqual({ lane: pbm.lane, confidence: pbm.confidence }, { lane: "WATCH", confidence: "Low" }, "unverified single-source item cannot be NEXT or above Low");
  assert.ok(pbm.defects.some((d) => d.startsWith("passage was not verbatim")));
  assert.ok(pbm.defects.some((d) => d.startsWith("tags without justification dropped")));
  const liu = Object.values(results).find((r) => r.verification === "confirmed");
  assert.equal(liu.confidence, "High");
  // A whole issue built from these candidates validates too.
  const issue = { issueDate: "Wednesday, September 2, 2026", issueSummary: "Three developments worth your time.", developments: await Promise.all(files.map(async (f) => { const { pipeline, ...dev } = JSON.parse(await readFile(path.join(out, "candidates", f), "utf8")); return dev; })), sourceLog: [] };
  assert.deepEqual(validate(issue, schema), []);
});

test("tier rule: an unconfirmed deadline cannot be NOW or NEXT, and NOW needs a near deadline or a confirmed status change", () => {
  const members = [DOC, COMMENTARY];
  const c = cluster(members);
  const lowered = enforce(draft(), c, members, verification("confirmed", "unconfirmed", "confirmed"), { today: TODAY });
  assert.equal(lowered.development.lane, "WATCH");
  assert.match(lowered.development.uncertainty, /not been confirmed/);
  assert.ok(lowered.defects.some((d) => d.startsWith("tier lowered from NOW to WATCH")));

  const kept = enforce(draft(), c, members, verification("confirmed", "confirmed", "confirmed"), { today: TODAY });
  assert.equal(kept.development.lane, "NOW");
  assert.equal(kept.development.cue, "Attorney review");
  assert.equal("uncertainty" in kept.development, false);

  const far = enforce(draft({ operative_date: "2027-03-01" }), c, members, verification("partially_confirmed", "confirmed", "confirmed"), { today: TODAY });
  assert.equal(far.development.lane, "NEXT", "NOW with a deadline 6 months out and no confirmed status change drops to NEXT");
  assert.equal(far.development.cue, "March 1, 2027");

  const next = enforce(draft({ tier: "NEXT" }), c, members, verification("unconfirmed", "unconfirmed", "unconfirmed"), { today: TODAY });
  assert.equal(next.development.lane, "WATCH");
});

test("confidence rule: verification caps confidence and a single unverified source is always Low", () => {
  const members = [DOC, COMMENTARY];
  const c = cluster(members);
  assert.equal(enforce(draft(), c, members, verification("confirmed", "confirmed", "confirmed"), { today: TODAY }).development.metadata.Confidence[0], "High");
  const partial = enforce(draft(), c, members, verification("confirmed", "unconfirmed", "confirmed"), { today: TODAY });
  assert.equal(partial.development.metadata.Confidence[0], "Medium");
  assert.ok(partial.defects.some((d) => d.startsWith("confidence lowered from High to Medium")));
  const single = enforce(draft({ passage_document_id: "ifebp-1", passage: "The post walks through the written-program and incident-reporting elements." }), cluster([COMMENTARY]), [COMMENTARY], { primary_document_id: null, checked_fields: { status: "unconfirmed", dates: "unconfirmed", posture: "unconfirmed" }, result: "unconfirmed", notes: "" }, { today: TODAY });
  assert.equal(single.development.metadata.Confidence[0], "Low");
  assert.equal(enforce(draft({ confidence: "Low" }), c, members, verification("confirmed", "confirmed", "confirmed"), { today: TODAY }).development.metadata.Confidence[0], "Low", "code never raises confidence");
});

test("closed lists: passage must be verbatim, tags need justification, None is exclusive, next step is from the list", () => {
  const members = [DOC, COMMENTARY];
  const c = cluster(members);
  const v = verification("confirmed", "confirmed", "confirmed");
  const para = enforce(draft({ passage: "Plans must keep a program that fits their systems." }), c, members, v, { today: TODAY });
  assert.ok(para.defects.some((d) => d.startsWith("passage was not verbatim")));
  assert.equal(para.development.passage, DOC.summary.replace(/\s+/g, " ").trim());
  const misattributed = enforce(draft({ passage_document_id: "ifebp-1" }), c, members, v, { today: TODAY });
  assert.equal(misattributed.passage_document_id, "fr-1");
  const tags = enforce(draft({ fiduciary_duties: ["Prudence & Process", NONE_TAG, "Reporting & Disclosure"], fiduciary_justifications: [{ tag: "Prudence & Process", justification: "x" }] }), c, members, v, { today: TODAY });
  assert.deepEqual(tags.development.metadata["Fiduciary duties"], [NONE_TAG]);
  const step = enforce(draft({ nextStep: "Email the DOL" }), c, members, v, { today: TODAY });
  assert.equal(step.development.nextStep, "No action — informational");
  assert.deepEqual(validate(step.development, schema.$defs.development, schema), []);
});
