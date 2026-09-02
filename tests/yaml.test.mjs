import assert from "node:assert/strict";
import test from "node:test";
import { parseYaml } from "../scripts/lib/yaml.mjs";

test("parses mappings, sequences of mappings, inline arrays, and scalars", () => {
  const y = parseYaml(`
# comment
group:
  - name: One
    url: https://example.test/a#frag   # trailing comment
    scans: [fhw, met]
    active: true
    count: 3
  - name: Two
    active: false
    urls:
      - https://example.test/b
      - https://example.test/c
`);
  assert.equal(y.group.length, 2);
  assert.deepEqual(y.group[0], { name: "One", url: "https://example.test/a#frag", scans: ["fhw", "met"], active: true, count: 3 });
  assert.deepEqual(y.group[1].urls, ["https://example.test/b", "https://example.test/c"]);
  assert.equal(y.group[1].active, false);
});

test("joins folded block scalars and plain multi-line continuations", () => {
  const y = parseYaml(`
a:
  notes: >
    first line
    second line
  plain: starts here
         Backup: continues here
`);
  assert.equal(y.a.notes, "first line second line");
  assert.equal(y.a.plain, "starts here Backup: continues here");
});
