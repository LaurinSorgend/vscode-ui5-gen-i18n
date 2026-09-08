/**
 * Parsing of `.properties` files (java.util.Properties format), kept free of
 * any `vscode` import so it can be unit tested with plain node.
 */

/** Characters that separate a key from its value. */
const SEPARATORS = "=:";

function isBlank(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\f";
}

/**
 * Replicates java.util.Properties key unescaping: `\=`, `\:`, `\ `, `\`,
 * `\t`, `\n`, `\r`, `\f` and `\uXXXX`. Any other `\x` collapses to `x`.
 */
function unescapeKey(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = raw[++i];
    switch (next) {
      case undefined:
        return out;
      case "t":
        out += "\t";
        break;
      case "n":
        out += "\n";
        break;
      case "r":
        out += "\r";
        break;
      case "f":
        out += "\f";
        break;
      case "u": {
        const hex = raw.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else {
          out += "u";
        }
        break;
      }
      default:
        out += next;
    }
  }
  return out;
}

/** True when the line ends with an odd number of backslashes, i.e. it continues. */
function continuesOnNextLine(line: string): boolean {
  let slashes = 0;
  for (let i = line.length - 1; i >= 0 && line[i] === "\\"; i--) {
    slashes++;
  }
  return slashes % 2 === 1;
}

/**
 * Returns every key defined in a `.properties` text.
 *
 * Unlike a naive `indexOf("=")` this honours the full format: whitespace as a
 * separator, escaped separators inside keys, value-less keys and multi-line
 * values — all of which would otherwise look like "key not present" and cause
 * a duplicate entry to be appended.
 */
export function parsePropertyKeys(text: string): Set<string> {
  const keys = new Set<string>();
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/^[ \t\f]+/, "");

    // Consume any continuation lines belonging to this entry's value.
    let logical = lines[i];
    while (continuesOnNextLine(logical) && i + 1 < lines.length) {
      logical = lines[++i];
    }

    if (line === "" || line.startsWith("#") || line.startsWith("!")) {
      continue;
    }

    const key = extractKey(line);
    if (key) {
      keys.add(key);
    }
  }
  return keys;
}

function extractKey(line: string): string {
  let end = line.length;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\") {
      i++; // escaped character is part of the key
      continue;
    }
    if (SEPARATORS.includes(ch) || isBlank(ch)) {
      end = i;
      break;
    }
  }
  return unescapeKey(line.slice(0, end));
}
