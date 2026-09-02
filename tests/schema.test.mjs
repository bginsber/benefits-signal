import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { validate } from "../scripts/lib/schema.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const schema = JSON.parse(await readFile(path.join(ROOT, "spec/issue-schema.json"), "utf8"));

test("validator rejects a development that breaks the issue contract and accepts the illustrative shape", () => {
  const bad = { id: "x", lane: "SOON", cue: "c", headline: "h", status: "s", summary: [], metadata: { "Plan type": ["Pension"], Jurisdiction: [], Topics: [], Confidence: ["High", "Low"] }, confidenceNote: "n", scan: "Nope", affected: "a", action: "a", timing: "t", mergedSources: [], nextStep: "Email", completion: "c", passage: "p", articleLabel: "l", articleUrl: "u", authorityLabel: "l", authorityUrl: "u" };
  const errors = validate(bad, schema.$defs.development, schema);
  for (const needle of ['$.lane: "SOON"', "$.summary: expected at least 1", '$.metadata.Plan type[0]: "Pension"', "$.metadata.Confidence: expected at most 1", '$.metadata: missing required property "Fiduciary duties"', '$.scan: "Nope"', "$.mergedSources: expected at least 1", '$.nextStep: "Email"']) {
    assert.ok(errors.some((e) => e.startsWith(needle)), `expected an error starting with ${needle}; got ${JSON.stringify(errors)}`);
  }
  const good = { ...bad, lane: "NOW", summary: ["s"], metadata: { "Plan type": ["Multiemployer"], Jurisdiction: ["Federal"], Topics: ["t"], Confidence: ["High"], "Fiduciary duties": ["Prudence & Process"] }, scan: "Federal Health & Welfare", mergedSources: ["EBIA Weekly"], nextStep: "No action — informational" };
  assert.deepEqual(validate(good, schema.$defs.development, schema), []);
  assert.deepEqual(validate({ issueDate: "d", issueSummary: "s", developments: [], sourceLog: [] }, schema), [], "a zero-development issue is valid");
});
