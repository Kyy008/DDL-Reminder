import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssistantMarkdown } from "./assistant-markdown";

function render(text: string) {
  return renderToStaticMarkup(<AssistantMarkdown text={text} />);
}

describe("assistant formatted messages", () => {
  it("renders emphasis next to Chinese punctuation without leaving stray stars", () => {
    for (const [text, expected] of [
      ["这是**“重点”**内容", "<strong>“重点”</strong>"],
      ["这是**任务：**说明", "<strong>任务：</strong>"],
      ["这是*“斜体”*内容", "<em>“斜体”</em>"],
      ["**重要。**接着说", "<strong>重要。</strong>"],
      ["中文**(English)**接着", "<strong>(English)</strong>"]
    ])
      expect(render(text)).toContain(expected);
    expect(render(String.raw`\*原样星号\*`)).not.toContain("<em>");
  });
  it("renders headings, bold, italic, strikethrough, lists, quotes and code", () => {
    const html = render(
      "## 标题\n\n**加粗**、*斜体*、***粗斜体***、~~删除线~~\n\n- 项目一\n- 项目二\n\n1. 第一步\n2. 第二步\n\n> 引用\n\n`**原样代码**`\n\n```js\nconst value = 1;\n```"
    );
    for (const expected of [
      "<h2>标题</h2>",
      "<strong>加粗</strong>",
      "<em>斜体</em>",
      "<em><strong>粗斜体</strong></em>",
      "<del>删除线</del>",
      "<ul>",
      "<ol>",
      "<blockquote>",
      "<code>**原样代码**</code>",
      '<pre><code class="language-js">'
    ])
      expect(html).toContain(expected);
  });
  it("renders GFM tables with a keyboard-accessible horizontal scrolling wrapper", () => {
    const html = render(
      "| 任务 | 状态 |\n| :--- | ---: |\n| **阅读** | 进行中 |\n| 写作 | 已完成 |"
    );
    expect(html).toContain('aria-label="表格，可横向滚动"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<strong>阅读</strong>");
    expect(html).toContain('style="text-align:right"');
  });
  it("renders inline, display, backslash and math-fence formulas", () => {
    for (const text of [
      "$x^2$",
      "$$\n\\frac{1}{2}\n$$",
      String.raw`\(a+b\)`,
      String.raw`\[\sum_{i=1}^{n} i\]`,
      "```math\nx^2\n```"
    ])
      expect(render(text)).toContain('class="katex"');
    expect(render(String.raw`\[x^2\]`)).toContain('class="katex-display"');
    expect(render("`$x^2$`")).not.toContain('class="katex"');
  });
  it("keeps line breaks, task lists, literal currency and incomplete Markdown readable", () => {
    expect(render("第一行\n第二行")).toContain("<br/>");
    expect(render("- [x] 已完成\n- [ ] 待完成")).toContain('type="checkbox"');
    expect(render(String.raw`价格 \$20，另一个 $30`)).toContain("$20");
    expect(render("**未结束")).toContain("**未结束");
    expect(render(String.raw`\[未结束`)).toContain("[未结束");
  });
  it("does not execute HTML, unsafe links, remote images or trusted LaTeX commands", () => {
    const html = render(
      '[危险](javascript:alert%281%29)\n\n![图片说明](https://tracking.example/pixel)\n\n<script>alert(1)</script>\n\n<iframe src="https://tracking.example"></iframe>\n\n$\\href{javascript:alert(1)}{test}$'
    );
    expect(html).not.toMatch(/<(script|iframe|img)\b/);
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('src="https://tracking.example');
    expect(html).toContain("图片说明");
  });
  it("falls back to readable formula text on invalid or excessively expanded LaTeX", () => {
    expect(render(String.raw`$\notARealCommand{x}$`)).toContain(
      "notARealCommand"
    );
    expect(() => render(String.raw`$\def\a{\a}\a$`)).not.toThrow();
  });
});
