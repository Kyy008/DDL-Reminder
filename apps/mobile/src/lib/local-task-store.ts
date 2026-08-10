import { Preferences } from "@capacitor/preferences";
import {
  archiveTaskInState,
  completeTaskInState,
  createEmptyLocalAppState,
  createTaskInState,
  deleteTaskInState,
  LocalAppState,
  LocalSettingsInput,
  LocalTaskInput,
  parseLocalAppState,
  serializeLocalAppState,
  updateSettingsInState,
  updateTaskInState
} from "./local-app-state";

const LOCAL_APP_STATE_KEY = "ddl-reminder:local-app-state";

export type LocalStorageBackend = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

export type LocalTaskStore = ReturnType<typeof createLocalTaskStore>;

export function createLocalTaskStore(
  backend: LocalStorageBackend = createPreferencesStorageBackend()
) {
  let mutationQueue: Promise<void> = Promise.resolve();

  async function readStateImmediately() {
    return parseLocalAppState(await backend.get(LOCAL_APP_STATE_KEY));
  }

  async function writeState(state: LocalAppState) {
    await backend.set(LOCAL_APP_STATE_KEY, serializeLocalAppState(state));
    return state;
  }

  function enqueueMutation<Result>(mutation: () => Promise<Result>) {
    const result = mutationQueue.then(mutation);

    mutationQueue = result.then(
      () => undefined,
      () => undefined
    );

    return result;
  }

  async function readState() {
    const pendingMutations = mutationQueue;

    await pendingMutations;

    return readStateImmediately();
  }

  return {
    async listTasks() {
      return (await readState()).tasks;
    },

    createTask(input: LocalTaskInput) {
      return enqueueMutation(async () => {
        const result = createTaskInState(await readStateImmediately(), input);
        await writeState(result.state);
        return result.task;
      });
    },

    updateTask(taskId: string, input: LocalTaskInput) {
      return enqueueMutation(async () => {
        const result = updateTaskInState(
          await readStateImmediately(),
          taskId,
          input
        );
        await writeState(result.state);
        return result.task;
      });
    },

    completeTask(taskId: string) {
      return enqueueMutation(async () => {
        const result = completeTaskInState(
          await readStateImmediately(),
          taskId
        );
        await writeState(result.state);
        return result.task;
      });
    },

    archiveTask(taskId: string) {
      return enqueueMutation(async () => {
        const result = archiveTaskInState(await readStateImmediately(), taskId);
        await writeState(result.state);
        return result.task;
      });
    },

    deleteTask(taskId: string) {
      return enqueueMutation(async () => {
        const result = deleteTaskInState(await readStateImmediately(), taskId);
        await writeState(result.state);
      });
    },

    async getSettings() {
      return (await readState()).settings;
    },

    updateSettings(input: LocalSettingsInput) {
      return enqueueMutation(async () => {
        const result = updateSettingsInState(
          await readStateImmediately(),
          input
        );
        await writeState(result.state);
        return result.settings;
      });
    },

    async getState() {
      return readState();
    },

    clearAllData() {
      return enqueueMutation(async () => {
        await backend.remove(LOCAL_APP_STATE_KEY);
      });
    }
  };
}

export const localTaskStore = createLocalTaskStore();

export function createMemoryStorageBackend(
  initialState: LocalAppState = createEmptyLocalAppState()
): LocalStorageBackend {
  const values = new Map<string, string>([
    [LOCAL_APP_STATE_KEY, serializeLocalAppState(initialState)]
  ]);

  return {
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async remove(key) {
      values.delete(key);
    }
  };
}

function createPreferencesStorageBackend(): LocalStorageBackend {
  return {
    async get(key) {
      return (await Preferences.get({ key })).value;
    },
    async set(key, value) {
      await Preferences.set({ key, value });
    },
    async remove(key) {
      await Preferences.remove({ key });
    }
  };
}
