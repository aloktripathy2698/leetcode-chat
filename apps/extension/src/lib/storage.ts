const STORAGE_KEYS = {
  backendUrl: 'leetcodeAssistant.backendUrl',
} as const;

const isChromeStorageAvailable = () =>
  typeof chrome !== 'undefined' && Boolean(chrome.storage?.sync);

export const DEFAULT_BACKEND_URL = 'http://localhost:8000/api/v1';

export const readBackendUrl = async (): Promise<string | null> => {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.sync.get([STORAGE_KEYS.backendUrl], (result: Record<string, unknown>) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        const value = result[STORAGE_KEYS.backendUrl] as unknown;
        resolve(typeof value === 'string' && value.trim() ? value.trim() : null);
      });
    });
  }

  const fallback = localStorage.getItem(STORAGE_KEYS.backendUrl) ?? '';
  return fallback.trim() || null;
};

export const saveBackendUrl = async (value: string): Promise<void> => {
  const trimmed = value.trim();
  if (isChromeStorageAvailable()) {
    await new Promise<void>((resolve, reject) => {
      chrome.storage.sync.set({ [STORAGE_KEYS.backendUrl]: trimmed }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
    return;
  }

  localStorage.setItem(STORAGE_KEYS.backendUrl, trimmed);
};
