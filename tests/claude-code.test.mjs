import assert from "node:assert/strict";
import test from "node:test";
import { claudeCodeArgs, parseClaudeCodeEnvelope } from "../scripts/lib/model.mjs";
import { batchSchema, buildBatchUser, triageBatch } from "../scripts/lib/triage.mjs";

const SCANS = ["fhw", "met", "ca9", "cyb", "atf"].map((id) => ({ id }));
const doc = (id, title) => ({ id, source: "S", title, link: `https://x/${id}`, summary: "body", categories: [] });

test("headless Claude Code arguments replace the system prompt, exclude dynamic sections and settings, allow no tools, and never use --bare", () => {
  const args = claudeCodeArgs({ system: ["A", "B"], schema: { type: "object" }, effort: "low", model: "claude-opus-5" });
  const at = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(args[0], "-p");
  assert.equal(at("--system-prompt"), "A\n\nB");
  assert.equal(at("--json-schema"), '{"type":"object"}');
  assert.equal(at("--output-format"), "json");
  assert.equal(at("--allowedTools"), "");
  assert.equal(at("--setting-sources"), "");
  assert.equal(at("--max-turns"), "1");
  assert.equal(at("--effort"), "low");
  assert.equal(at("--model"), "claude-opus-5");
  assert.ok(args.includes("--exclude-dynamic-system-prompt-sections"));
  assert.ok(!args.includes("--bare"), "--bare skips the stored login");
  assert.ok(!args.includes("--tools"), "--tools '' still loads tool schemas; --allowedTools '' is the lean form");
});

test("the CLI envelope maps to the SDK result shape, including errors and refusals", () => {
  const ok = parseClaudeCodeEnvelope(JSON.stringify({ structured_output: { ok: true }, usage: { input_tokens: 2, output_tokens: 57, cache_creation_input_tokens: 15000, output_tokens_details: { thinking_tokens: 10 } }, total_cost_usd: 0.12, modelUsage: { "claude-opus-5": {} } }));
  assert.deepEqual({ data: ok.data, stop: ok.stop_reason, model: ok.model, think: ok.usage.thinking_tokens, usd: ok.usage.subscription_equivalent_usd }, { data: { ok: true }, stop: "end_turn", model: "claude-opus-5", think: 10, usd: 0.12 });
  const err = parseClaudeCodeEnvelope(JSON.stringify({ is_error: true, result: "Not logged in · Please run /login", subtype: "success" }));
  assert.equal(err.stop_reason, "error");
  assert.match(err.stop_details.explanation, /Not logged in/);
  const maxTurns = parseClaudeCodeEnvelope(JSON.stringify({ subtype: "error_max_turns", stop_reason: "tool_use" }));
  assert.equal(maxTurns.stop_reason, "error");
  const refusal = parseClaudeCodeEnvelope(JSON.stringify({ is_error: true, result: "I refuse to classify this." }));
  assert.equal(refusal.stop_reason, "refusal");
  assert.throws(() => parseClaudeCodeEnvelope("not json"), /non-JSON/);
});

test("batched triage maps results by document id, skips documents the model left out, and never invents one", async () => {
  const docs = [doc("aaaaaaaa1111", "one"), doc("bbbbbbbb2222", "two"), doc("cccccccc3333", "three")];
  const seen = [];
  const client = {
    mode: "live", backend: "claude-code",
    async complete(req) {
      seen.push(req);
      return { data: { results: [
        { document_id: "aaaaaaaa1111", summary: "One. Two.", matches: [{ scan_id: "fhw", score: 0.9, in_scope: true, reason: "covered by the charter" }] },
        { document_id: "bbbbbbbb", summary: "Short id. Still matched.", matches: [{ scan_id: "atf", score: 0.2, in_scope: false, reason: "not covered at all" }] },
      ] }, stop_reason: "end_turn", model: "claude-opus-5", usage: { output_tokens: 100 } };
    },
  };
  const prompt = { version: "triage@2", body: "" };
  const out = await triageBatch(docs, { client, prompt, system: ["s"], scans: SCANS });
  assert.equal(seen.length, 1, "one call for the batch");
  assert.match(seen[0].user, /^3 documents to assess\.\n\n=== document aaaaaaaa1111 ===/);
  assert.deepEqual(seen[0].schema, batchSchema(SCANS.map((s) => s.id)));
  assert.deepEqual(out.map((r) => [r.doc.id.slice(0, 1), r.bucket]), [["a", "matches"], ["b", "omitted"], ["c", "skipped"]]);
  assert.deepEqual(out[0].record.scan_ids, ["fhw"]);
  assert.equal(out[0].record.usage.shared_by, 3);
  assert.equal(out[1].record.reason, "not covered at all");
  assert.match(out[2].record.skipped, /no result for this document/);
  assert.match(buildBatchUser([docs[0]]), /^1 document to assess\./);
});
