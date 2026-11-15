import "server-only";

/**
 * The UI shows the agent's `reply` as plain text (line breaks kept, no markdown renderer), so a
 * model's markdown would appear as raw `**`, `#` and `|` characters. `toPlainReply` turns markdown
 * into short readable text: paragraphs separated by a blank line, lists as "- item" lines.
 * Pure; used on every model reply (the deterministic replies are already plain).
 */

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|[\s:|-]+\|\s*$/;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** A markdown table becomes one "- first cell: header value, header value" line per row. */
function tableToList(rows: string[]): string[] {
  const body = rows.filter((row) => !TABLE_SEPARATOR.test(row));
  const [header, ...data] = body.map(splitRow);
  if (!header) return [];
  if (data.length === 0) return [`- ${header.filter(Boolean).join(", ")}`];
  return data.map((cells) => {
    const [first = "", ...rest] = cells;
    const details = rest
      .map((value, i) => (value ? (header[i + 1] ? `${header[i + 1]} ${value}` : value) : ""))
      .filter(Boolean)
      .join(", ");
    return details ? `- ${first}: ${details}` : `- ${first}`;
  });
}

function stripInline(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => (text === url ? url : `${text} (${url})`))
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2") // bold
    .replace(/(?<![\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])/g, "$1") // *italic*
    .replace(/(?<![\w])_(?=\S)([^_\n]+?)(?<=\S)_(?![\w])/g, "$1") // _italic_ (not snake_case)
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1");
}

export function toPlainReply(markdown: string): string {
  const out: string[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;

    if (/^\s*(```|~~~)/.test(raw)) continue; // fence markers; the code inside stays as text
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) {
      out.push(""); // horizontal rule
      continue;
    }
    if (TABLE_ROW.test(raw)) {
      const rows = [raw];
      while (i + 1 < lines.length && TABLE_ROW.test(lines[i + 1]!)) rows.push(lines[++i]!);
      out.push(...tableToList(rows).map(stripInline));
      continue;
    }

    let line = raw
      .replace(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/, "$1") // headings
      .replace(/^\s{0,3}>\s?/, "") // quotes
      .replace(/^(\s*)[*+•]\s+/, "$1- ") // bullets → "- "
      .replace(/^(\s*)\d+[.)]\s+/, (m) => m.replace(/\s+$/, " ")); // numbered lists stay numbered
    line = stripInline(line).replace(/[ \t]+$/, "");
    // Nested list indentation is noise in a chat bubble: one level.
    line = line.replace(/^\s+(- )/, "$1");
    out.push(line);
  }

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
