"use client";

import { memo } from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkCjkFriendly from "remark-cjk-friendly/parseOnly";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  normalizeAssistantMath,
  safeAssistantUrl
} from "@/lib/assistant-markdown";

const components: Components = {
  table: ({ children }) => (
    <div
      className="assistant-table-scroll"
      role="region"
      aria-label="表格，可横向滚动"
      tabIndex={0}
    >
      <table>{children}</table>
    </div>
  ),
  a: ({ href, children }) =>
    href ? (
      <a
        href={href}
        target={href.startsWith("#") ? undefined : "_blank"}
        rel="noopener noreferrer"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  // Don't let a model response load tracking pixels or send data to an image
  // host automatically. Markdown images remain readable as their description.
  img: ({ alt }) => (
    <span className="assistant-image-description">
      [图片：{alt || "未提供说明"}]
    </span>
  )
};

export const AssistantMarkdown = memo(function AssistantMarkdown({
  text
}: {
  text: string;
}) {
  return (
    <div className="assistant-markdown">
      <Markdown
        remarkPlugins={[remarkGfm, remarkCjkFriendly, remarkMath, remarkBreaks]}
        rehypePlugins={[
          [
            rehypeKatex,
            {
              trust: false,
              strict: "ignore",
              maxExpand: 1000,
              maxSize: 10,
              output: "htmlAndMathml"
            }
          ]
        ]}
        components={components}
        urlTransform={safeAssistantUrl}
        skipHtml
      >
        {normalizeAssistantMath(text)}
      </Markdown>
    </div>
  );
});
