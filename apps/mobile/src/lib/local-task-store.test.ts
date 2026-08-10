import { describe, expect, it } from "vitest";
import {
  createLocalTaskStore,
  createMemoryStorageBackend
} from "./local-task-store";
import { LOCAL_APP_STATE_ERROR_MESSAGES } from "./local-app-state";

describe("local task store", () => {
  it("persists tasks and settings through the storage backend", async () => {
    const backend = createMemoryStorageBackend();
    const store = createLocalTaskStore(backend);

    const task = await store.createTask({
      title: "Submit report",
      hasDeadline: false
    });
    await store.completeTask(task.id);
    await store.updateSettings({
      localReminderEnabled: false,
      approachingReminderMinutes: 1440,
      urgentReminderMinutes: 30
    });

    const reloadedStore = createLocalTaskStore(backend);

    await expect(reloadedStore.listTasks()).resolves.toMatchObject([
      {
        title: "Submit report",
        status: "COMPLETED"
      }
    ]);
    await expect(reloadedStore.getSettings()).resolves.toEqual({
      localReminderEnabled: false,
      approachingReminderMinutes: 1440,
      urgentReminderMinutes: 30
    });
  });

  it("serializes concurrent mutations so neither task is lost", async () => {
    const store = createLocalTaskStore(createMemoryStorageBackend());

    await Promise.all([
      store.createTask({
        title: "First",
        hasDeadline: false
      }),
      store.createTask({
        title: "Second",
        hasDeadline: false
      })
    ]);

    await expect(store.listTasks()).resolves.toHaveLength(2);
    await expect(store.listTasks()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "First" }),
        expect.objectContaining({ title: "Second" })
      ])
    );
  });

  it("makes reads wait for an in-flight mutation", async () => {
    const memoryBackend = createMemoryStorageBackend();
    let releaseWrite = () => {};
    let markWriteStarted = () => {};
    let writeInProgress = false;
    let readsDuringWrite = 0;
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve;
    });
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const store = createLocalTaskStore({
      async get(key) {
        if (writeInProgress) {
          readsDuringWrite += 1;
        }

        return memoryBackend.get(key);
      },
      async set(key, value) {
        writeInProgress = true;
        markWriteStarted();
        await writeGate;
        await memoryBackend.set(key, value);
        writeInProgress = false;
      },
      remove: memoryBackend.remove
    });

    const creation = store.createTask({
      title: "Queued task",
      hasDeadline: false
    });
    await writeStarted;

    const read = store.listTasks();
    await Promise.resolve();
    await Promise.resolve();
    const observedReadsDuringWrite = readsDuringWrite;

    releaseWrite();
    await creation;

    expect(observedReadsDuringWrite).toBe(0);
    await expect(read).resolves.toMatchObject([
      {
        title: "Queued task"
      }
    ]);
  });

  it("preserves corrupt backend data when a mutation is rejected", async () => {
    const corruptValue = "{not-json";
    let storedValue: string | null = corruptValue;
    let writeCount = 0;
    const store = createLocalTaskStore({
      async get() {
        return storedValue;
      },
      async set(_key, value) {
        writeCount += 1;
        storedValue = value;
      },
      async remove() {
        storedValue = null;
      }
    });

    await expect(
      store.createTask({
        title: "Must not overwrite",
        hasDeadline: false
      })
    ).rejects.toThrow(LOCAL_APP_STATE_ERROR_MESSAGES.corruptJson);
    expect(storedValue).toBe(corruptValue);
    expect(writeCount).toBe(0);
  });
});
