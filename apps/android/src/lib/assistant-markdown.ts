import remarkGfm from "remark-gfm";
import remarkCjkFriendly from "remark-cjk-friendly/parseOnly";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

type SourceNode = {
  type: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: SourceNode[];
};
const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkCjkFriendly)
  .use(remarkMath);
const protectedTypes = new Set([
  "code",
  "inlineCode",
  "math",
  "inlineMath",
  "link",
  "image",
  "definition",
  "html"
]);

// DeepSeek also uses LaTeX's \(...\) and \[...\] delimiters. Convert only
// prose: replacing across code, existing math, or URLs would corrupt examples.
export function normalizeAssistantMath(source: string): string {
  if (!/\\[([]/.test(source)) return source;
  const ranges: Array<[number, number]> = [];
  function collect(node: SourceNode) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (
      protectedTypes.has(node.type) &&
      start !== undefined &&
      end !== undefined
    ) {
      ranges.push([start, end]);
      return;
    }
    node.children?.forEach(collect);
  }
  collect(parser.parse(source));
  ranges.sort((a, b) => a[0] - b[0]);
  let result = "",
    cursor = 0;
  for (const [start, end] of ranges) {
    result += normalizeProse(source.slice(cursor, start));
    result += source.slice(start, end);
    cursor = end;
  }
  return result + normalizeProse(source.slice(cursor));
}

function normalizeProse(source: string): string {
  let result = "";
  for (let index = 0; index < source.length; index++) {
    const character = source[index],
      next = source[index + 1];
    if (character !== "\\") {
      result += character;
      continue;
    }
    if (next === "\\") {
      result += "\\\\";
      index++;
      continue;
    }
    if (next !== "(" && next !== "[") {
      result += character;
      continue;
    }
    const closing = next === "(" ? "\\)" : "\\]";
    let end = source.indexOf(closing, index + 2);
    while (end !== -1) {
      let precedingSlashes = 0;
      for (
        let before = end - 1;
        before >= 0 && source[before] === "\\";
        before--
      )
        precedingSlashes++;
      if (precedingSlashes % 2 === 0) break;
      end = source.indexOf(closing, end + 2);
    }
    const formula = end === -1 ? "" : source.slice(index + 2, end).trim();
    if (!formula) {
      result += character;
      continue;
    }
    result += next === "[" ? `\n\n$$\n${formula}\n$$\n\n` : `$${formula}$`;
    index = end + 1;
  }
  return result;
}

export function safeAssistantUrl(url: string): string {
  // Local anchors are needed for GFM footnotes, but model links must never
  // navigate to an app route, an intent, a script, or a local file.
  if (/^#[\w:-]+$/.test(url)) return url;
  if (!/^(https?:\/\/|mailto:)/i.test(url)) return "";
  try {
    const parsed = new URL(url);
    if (
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
      parsed.pathname.startsWith("/_capacitor_http_interceptor_")
    )
      return "";
    return ["https:", "http:", "mailto:"].includes(parsed.protocol)
      ? parsed.href
      : "";
  } catch {
    return "";
  }
}
