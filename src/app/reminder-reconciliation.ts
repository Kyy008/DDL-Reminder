type AppState = {
  isActive: boolean;
};

type AppStateListenerHandle = {
  remove: () => Promise<void>;
};

type AddAppStateListener = (
  eventName: "appStateChange",
  listener: (state: AppState) => void
) => Promise<AppStateListenerHandle>;

export async function initializeReminderReconciliation({
  addListener,
  isDisposed,
  onActive,
  onListenerReady,
  reconcile
}: {
  addListener: AddAppStateListener;
  isDisposed: () => boolean;
  onActive: () => void;
  onListenerReady: (remove: () => Promise<void>) => void;
  reconcile: () => Promise<void>;
}) {
  let listener: AppStateListenerHandle;

  try {
    listener = await addListener("appStateChange", ({ isActive }) => {
      if (isActive) {
        onActive();
      }
    });
  } catch {
    if (!isDisposed()) {
      await reconcile();
    }

    return;
  }

  if (isDisposed()) {
    await listener.remove();
    return;
  }

  onListenerReady(() => listener.remove());
  await reconcile();
}
