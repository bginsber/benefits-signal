/**
 * Source and scan configuration (spec § 3, § 4).
 *
 * spec/sources.yaml and spec/scans.yaml are the records; nothing here is
 * hard-coded. Adding a source or a scan is a config change, not a code change.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseYaml } from "./yaml.mjs";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** All sources, flattened, each carrying its `layer` and a stable `id`. */
export async function loadSources(file = path.join(ROOT, "spec", "sources.yaml")) {
  const y = parseYaml(await readFile(file, "utf8"));
  const out = [];
  for (const layer of ["interpretation", "primary"]) {
    for (const s of y[layer] ?? []) {
      if (!s.name) throw new Error(`sources.yaml: entry without a name in ${layer}`);
      if (!s.method) throw new Error(`sources.yaml: ${s.name} has no method`);
      out.push({ ...s, id: s.id ?? slug(s.name), layer, active: s.active !== false, scans: s.scans ?? [] });
    }
  }
  return out;
}

/** The saved scans, in charter order. */
export async function loadScans(file = path.join(ROOT, "spec", "scans.yaml")) {
  const y = parseYaml(await readFile(file, "utf8"));
  const scans = y?.scans ?? [];
  for (const s of scans) {
    for (const k of ["id", "name", "charter", "primary_authorities", "plan_types", "out_of_scope"]) {
      if (s[k] == null) throw new Error(`scans.yaml: scan ${s.id ?? s.name ?? "?"} is missing ${k}`);
    }
  }
  return scans;
}

/** Collector kinds the pipeline implements today. Add to this list as collectors land (goal M2). */
export const IMPLEMENTED = ["rss", "federal-register"];

/**
 * Decide how a source is collected.
 *   { kind: "rss" | "federal-register" }            — implemented
 *   { kind: null, reason: "..." }                    — explicitly skipped, with the reason for the run log
 * `collector:` in the config overrides the method-based default (e.g. `collector: none`).
 */
export function resolveCollector(source) {
  if (!source.active) return { kind: null, reason: "inactive in spec/sources.yaml" };
  const override = source.collector;
  if (override === "none") return { kind: null, reason: source.notes ? "collector: none — " + firstSentence(source.notes) : "collector: none" };
  if (override) return IMPLEMENTED.includes(override) ? { kind: override } : { kind: null, reason: `collector "${override}" not implemented` };

  switch (source.method) {
    case "rss":
      return source.url ? { kind: "rss" } : { kind: null, reason: "rss source without url" };
    case "api":
      if (/federalregister\.gov/.test(source.url ?? "")) {
        return Array.isArray(source.agencies) && source.agencies.length
          ? { kind: "federal-register" }
          : { kind: null, reason: "federal register entry without an agencies list" };
      }
      return { kind: null, reason: `no collector for api source at ${source.url ?? "?"} (goal M2)` };
    case "email":
      return { kind: null, reason: "email-only source; needs the dedicated firm mailbox (out of loop scope)" };
    case "scrape":
      return { kind: null, reason: "scrape collector not implemented yet (goal M2)" };
    case "scrape-js":
      return { kind: null, reason: "JavaScript-rendered listing; needs headless fetch or its JSON endpoint (goal M2)" };
    default:
      return { kind: null, reason: `unknown method "${source.method}"` };
  }
}

function firstSentence(s) {
  return String(s).split(/(?<=\.)\s/)[0].trim();
}
