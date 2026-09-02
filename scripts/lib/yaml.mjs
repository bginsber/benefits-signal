/**
 * Minimal YAML subset parser, zero dependencies, for spec/*.yaml.
 *
 * Supports what the Benefits Signal config files use and nothing more:
 * block mappings, block sequences (of scalars or mappings), inline arrays
 * `[a, b]`, folded/literal block scalars (`>` / `|`), plain multi-line
 * scalars (continuation lines indented past the key), quoted strings,
 * booleans, null, numbers, and `#` comments. Anchors, aliases, tags, flow
 * mappings, and multi-document streams are not supported and will either
 * throw or parse as plain strings.
 */

export function parseYaml(text) {
  const raw = text.split(/\r?\n/);
  const lines = [];
  for (let n = 0; n < raw.length; n++) {
    const line = raw[n];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    lines.push({ n: n + 1, indent: line.length - line.trimStart().length, text: line.trimEnd(), body: trimmed });
  }
  if (lines.length === 0) return null;
  const [value, next] = parseBlock(lines, 0, lines[0].indent);
  if (next < lines.length) throw new Error(`yaml: unexpected content at line ${lines[next].n}`);
  return value;
}

function parseBlock(lines, i, indent) {
  if (i >= lines.length) return [null, i];
  return lines[i].body.startsWith("- ") || lines[i].body === "-"
    ? parseSequence(lines, i, indent)
    : parseMapping(lines, i, indent);
}

function parseMapping(lines, i, indent) {
  const out = {};
  while (i < lines.length && lines[i].indent === indent && !lines[i].body.startsWith("- ")) {
    const line = lines[i];
    const m = line.body.match(/^("[^"]*"|'[^']*'|[^:#]+?)\s*:(?:\s+(.*))?$/);
    if (!m) throw new Error(`yaml: expected "key: value" at line ${line.n}`);
    const key = unquote(m[1]);
    const rest = (m[2] ?? "").trim();
    i++;
    if (rest === "" || rest.startsWith("#")) {
      // Nested block: either more-indented, or a sequence at the same indent.
      if (i < lines.length && (lines[i].indent > indent || (lines[i].indent === indent && lines[i].body.startsWith("- ")))) {
        const [v, next] = parseBlock(lines, i, lines[i].indent);
        out[key] = v; i = next;
      } else {
        out[key] = null;
      }
    } else if (rest === ">" || rest === "|" || rest === ">-" || rest === "|-") {
      const parts = [];
      while (i < lines.length && lines[i].indent > indent) { parts.push(lines[i].body); i++; }
      out[key] = rest.startsWith(">") ? parts.join(" ") : parts.join("\n");
    } else {
      // Plain scalar, possibly continued on more-indented lines.
      let scalar = rest;
      while (i < lines.length && lines[i].indent > indent) { scalar += " " + lines[i].body; i++; }
      out[key] = parseScalar(scalar, line.n);
    }
  }
  if (i < lines.length && lines[i].indent > indent) throw new Error(`yaml: bad indentation at line ${lines[i].n}`);
  return [out, i];
}

function parseSequence(lines, i, indent) {
  const out = [];
  while (i < lines.length && lines[i].indent === indent && (lines[i].body.startsWith("- ") || lines[i].body === "-")) {
    const line = lines[i];
    const content = line.body === "-" ? "" : line.body.slice(2).trim();
    const childIndent = indent + 2;
    if (content === "") {
      i++;
      const [v, next] = parseBlock(lines, i, lines[i]?.indent ?? childIndent);
      out.push(v); i = next;
    } else if (/^("[^"]*"|'[^']*'|[^:#]+?)\s*:(\s|$)/.test(content) && !content.startsWith("[")) {
      // Mapping whose first key sits on the dash line: re-express that line at childIndent.
      const rewritten = { ...line, indent: childIndent, body: content, text: " ".repeat(childIndent) + content };
      const sub = [rewritten, ...lines.slice(i + 1)];
      const [v, consumed] = parseMapping(sub, 0, childIndent);
      out.push(v); i = i + consumed;
    } else {
      out.push(parseScalar(content, line.n));
      i++;
    }
  }
  return [out, i];
}

function parseScalar(s, n) {
  s = stripComment(s).trim();
  if (s === "" || s === "~" || s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.startsWith("[")) {
    if (!s.endsWith("]")) throw new Error(`yaml: unterminated inline array at line ${n}`);
    const inner = s.slice(1, -1).trim();
    return inner === "" ? [] : inner.split(",").map((x) => parseScalar(x, n));
  }
  return unquote(s);
}

function stripComment(s) {
  let q = null;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === "#" && (k === 0 || /\s/.test(s[k - 1]))) return s.slice(0, k);
  }
  return s;
}

function unquote(s) {
  s = s.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}
