import { describe, expect, it } from "vitest";
import { createBackupDocument } from "./data-backup";
import {
  createEmptyLocalAppState,
  createTaskInState,
  parseLocalAppState
} from "./local-app-state";

describe("export backup", () => {
  it("round trips tasks and settings without modifying source or including credentials", () => {
    const state = createTaskInState(createEmptyLocalAppState(), {
      title: "备份任务",
      description: "中文内容",
      hasDeadline: false
    }).state;
    const original = JSON.stringify(state);
    const backup = createBackupDocument(state);
    expect(parseLocalAppState(JSON.stringify(backup.state))).toEqual(state);
    expect(backup.format).toBe("ddl-reminder-backup");
    expect(backup.version).toBe(1);
    expect(JSON.stringify(state)).toBe(original);
    expect(JSON.stringify(backup)).not.toMatch(/apiKey|api_key|preset/i);
  });
  it("does not export invalid task state as a supposedly successful backup", () => {
    const state = createEmptyLocalAppState();
    state.version = 2 as 1;
    expect(() => createBackupDocument(state)).toThrow();
  });
});
