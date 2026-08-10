import { describe, expect, it, vi } from "vitest";
import { initializeReminderReconciliation } from "./reminder-reconciliation";

describe("reminder reconciliation lifecycle", () => {
  it("registers the app-state listener before the initial reconciliation", async () => {
    const calls: string[] = [];
    let appStateListener: ((state: { isActive: boolean }) => void) | undefined;
    const onActive = vi.fn();

    await initializeReminderReconciliation({
      addListener: async (_eventName, listener) => {
        calls.push("listener");
        appStateListener = listener;
        return { remove: vi.fn().mockResolvedValue(undefined) };
      },
      isDisposed: () => false,
      onActive,
      onListenerReady: () => calls.push("listener-ready"),
      reconcile: async () => {
        calls.push("reconcile");
      }
    });

    expect(calls).toEqual(["listener", "listener-ready", "reconcile"]);

    appStateListener?.({ isActive: false });
    expect(onActive).not.toHaveBeenCalled();
    appStateListener?.({ isActive: true });
    expect(onActive).toHaveBeenCalledOnce();
  });

  it("removes a listener and skips reconciliation if disposal wins the race", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const reconcile = vi.fn().mockResolvedValue(undefined);

    await initializeReminderReconciliation({
      addListener: async () => ({ remove }),
      isDisposed: () => true,
      onActive: vi.fn(),
      onListenerReady: vi.fn(),
      reconcile
    });

    expect(remove).toHaveBeenCalledOnce();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("still runs the initial reconciliation when listener registration fails", async () => {
    const reconcile = vi.fn().mockResolvedValue(undefined);

    await initializeReminderReconciliation({
      addListener: async () => {
        throw new Error("listener unavailable");
      },
      isDisposed: () => false,
      onActive: vi.fn(),
      onListenerReady: vi.fn(),
      reconcile
    });

    expect(reconcile).toHaveBeenCalledOnce();
  });
});
