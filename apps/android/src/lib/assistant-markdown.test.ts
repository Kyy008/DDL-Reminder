import { describe, expect, it } from "vitest";
import { normalizeAssistantMath, safeAssistantUrl } from "./assistant-markdown";

describe("assistant math delimiters", () => {
  it("converts inline and display LaTeX delimiters", () => {
    expect(
      normalizeAssistantMath(
        String.raw`公式 \(x^2 + y^2\) 然后 \[\frac{1}{2}\]`
      )
    ).toBe("公式 $x^2 + y^2$ 然后 \n\n$$\n\\frac{1}{2}\n$$\n\n");
  });
  it("leaves dollar math, currency, escaped delimiters and unfinished formulas alone", () => {
    for (const text of [
      "$x$ and $$y$$",
      String.raw`\$20`,
      String.raw`\\(not math\\)`,
      String.raw`\(unfinished`,
      String.raw`\[unfinished`,
      String.raw`\(\)`
    ])
      expect(normalizeAssistantMath(text)).toBe(text);
    expect(
      normalizeAssistantMath(String.raw`$\text{\(example\)}$ then \(x\)`)
    ).toBe(String.raw`$\text{\(example\)}$ then $x$`);
  });
  it("preserves inline code, fenced code, indented code, links and HTML", () => {
    const source = [
      "Use \\(x\\), but keep `\\(literal\\)` and ``code ` \\(literal\\)``.",
      "```js",
      String.raw`const example = "\[literal\]";`,
      "```",
      "",
      String.raw`    \(indented\)`,
      "",
      String.raw`[\(label\)](https://example.com/\(path\))`,
      String.raw`<span title="\(attribute\)">html</span>`
    ].join("\n");
    const normalized = normalizeAssistantMath(source);
    expect(normalized).toContain("Use $x$");
    expect(normalized).toContain("`\\(literal\\)`");
    expect(normalized).toContain(String.raw`const example = "\[literal\]";`);
    expect(normalized).toContain(String.raw`    \(indented\)`);
    expect(normalized).toContain(
      String.raw`[\(label\)](https://example.com/\(path\))`
    );
    expect(normalized).toContain(String.raw`<span title="\(attribute\)">`);
  });
  it("preserves Markdown tables and mixed Chinese emphasis around math", () => {
    expect(normalizeAssistantMath(String.raw`**重点**和*斜体*：\(a+b\)`)).toBe(
      "**重点**和*斜体*：$a+b$"
    );
    expect(
      normalizeAssistantMath("| 项目 | 值 |\n| --- | --- |\n| A | \\(x\\) |")
    ).toContain("| A | $x$ |");
  });
});

describe("assistant links", () => {
  it("allows ordinary external links and footnotes", () => {
    expect(safeAssistantUrl("https://example.com/a")).toBe(
      "https://example.com/a"
    );
    expect(safeAssistantUrl("mailto:hello@example.com")).toBe(
      "mailto:hello@example.com"
    );
    expect(safeAssistantUrl("#user-content-fn-1")).toBe("#user-content-fn-1");
  });
  it("blocks scripts, intents, local navigation, files and data URLs", () => {
    for (const url of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "intent://app",
      "file:///sdcard/private",
      "data:text/html,test",
      "//example.com",
      "/manage",
      "#bad anchor",
      "https://",
      "https://localhost/manage",
      "http://127.0.0.1/private",
      "http://[::1]/manage",
      "https://example.com/_capacitor_http_interceptor_?u=unsafe",
      " java\nscript:alert(1)"
    ])
      expect(safeAssistantUrl(url)).toBe("");
  });
});
