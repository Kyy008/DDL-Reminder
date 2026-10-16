import { describe, expect, it } from "vitest";
import {
  ASSISTANT_SUGGESTIONS,
  pickAssistantSuggestions
} from "./assistant-suggestions";

describe("assistant suggestions", () => {
  it("draws exactly two different options from a larger pool", () => {
    expect(ASSISTANT_SUGGESTIONS.length).toBeGreaterThan(10);
    const suggestions = pickAssistantSuggestions([], () => 0);
    expect(suggestions).toHaveLength(2);
    expect(new Set(suggestions).size).toBe(2);
    expect(
      suggestions.every((item) =>
        (ASSISTANT_SUGGESTIONS as readonly string[]).includes(item)
      )
    ).toBe(true);
  });
  it("does not immediately repeat the last two options", () => {
    const previous = pickAssistantSuggestions([], () => 0);
    expect(
      pickAssistantSuggestions(previous, () => 0).some((item) =>
        previous.includes(item)
      )
    ).toBe(false);
  });
});
