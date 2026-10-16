import { describe, expect, it } from "vitest";
import {
  buildAssistantRequest,
  parseAssistantResponse
} from "./assistant-client";

describe("DeepSeek request contract", () => {
  it.each(["off", "low", "high", "max"] as const)(
    "sends the real %s effort with the Flash model",
    (effort) => {
      const body = buildAssistantRequest(
        [{ role: "user", content: "你好" }],
        effort
      );
      expect(body.model).toBe("deepseek-flash");
      expect(body.reasoning_effort).toBe(effort === "off" ? "none" : effort);
      expect(body.thinking.type).toBe(
        effort === "off" ? "disabled" : "enabled"
      );
      expect(body.tools.map((tool) => tool.function.name)).toEqual([
        "query_tasks",
        "propose_task_change"
      ]);
      expect(JSON.stringify(body)).not.toMatch(/api[_-]?key|Authorization/i);
    }
  );
  it("rejects truncated answers rather than applying partial tool calls", () => {
    expect(() =>
      parseAssistantResponse(
        JSON.stringify({
          choices: [
            { finish_reason: "length", message: { content: "partial" } }
          ]
        })
      )
    ).toThrow(/长度/);
  });
  it("preserves private reasoning for protocol replay, without exposing it as visible text", () => {
    const message = parseAssistantResponse(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: { content: "答案", reasoning_content: "thinking" }
          }
        ]
      })
    );
    expect(message.content).toBe("答案");
    expect(message.reasoning_content).toBe("thinking");
  });
});
