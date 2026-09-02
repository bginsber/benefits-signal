/**
 * Minimal JSON Schema validator, zero dependencies, covering the subset used
 * by spec/issue-schema.json and the pipeline's structured-output schemas:
 * type, required, properties, additionalProperties (boolean or schema),
 * enum, items, minItems, maxItems, $ref to #/$defs/..., description/format
 * ignored. Returns a list of "<path>: <problem>" strings; empty means valid.
 */

export function validate(value, schema, root = schema, path = "$") {
  const errors = [];
  if (!schema || typeof schema !== "object") return errors;
  if (schema.$ref) {
    const target = resolveRef(schema.$ref, root);
    if (!target) return [`${path}: unresolvable $ref ${schema.$ref}`];
    return validate(value, target, root, path);
  }
  if (schema.enum && !schema.enum.some((e) => deepEqual(e, value))) {
    errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => hasType(value, t))) {
      errors.push(`${path}: expected ${types.join("|")}, got ${describe(value)}`);
      return errors;
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${path}: expected at least ${schema.minItems} items, got ${value.length}`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${path}: expected at most ${schema.maxItems} items, got ${value.length}`);
    if (schema.items) value.forEach((v, i) => errors.push(...validate(v, schema.items, root, `${path}[${i}]`)));
  } else if (value && typeof value === "object") {
    for (const k of schema.required ?? []) if (!(k in value)) errors.push(`${path}: missing required property "${k}"`);
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(value)) {
      if (k in props) errors.push(...validate(v, props[k], root, `${path}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected property "${k}"`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") errors.push(...validate(v, schema.additionalProperties, root, `${path}.${k}`));
    }
  }
  return errors;
}

function resolveRef(ref, root) {
  if (!ref.startsWith("#/")) return null;
  return ref.slice(2).split("/").reduce((o, k) => (o == null ? null : o[k]), root);
}

function hasType(v, t) {
  switch (t) {
    case "object": return v !== null && typeof v === "object" && !Array.isArray(v);
    case "array": return Array.isArray(v);
    case "string": return typeof v === "string";
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "integer": return Number.isInteger(v);
    case "boolean": return typeof v === "boolean";
    case "null": return v === null;
    default: return false;
  }
}

const describe = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
}
