/**
 * Storage: localStorage for the settings (the same key as the Pyodide page and the same keys as the desktop config),
 * IndexedDB "poe-filter-gen" v2 for the sound files (key = slot label) and for the game folder handles (key = game).
 * Every access is guarded: private mode / blocked storage -> the page keeps working from memory only.
 */

const mem = new Map<string, string>();

/** Where the keys live when it is not localStorage (the desktop shell keeps them in its own files, see platform.ts). */
export interface StoreBackend {
  get(k: string): string | null;
  set(k: string, v: string): boolean;
  del(k: string): void;
  keys(): string[];
}
let backend: StoreBackend | null = null;
export function setStoreBackend(b: StoreBackend): void {
  backend = b;
}

export const store = {
  get(k: string): string | null {
    if (backend) return backend.get(k);
    try {
      const v = localStorage.getItem(k);
      if (v !== null) return v;
    } catch { /* blocked */ }
    return mem.has(k) ? mem.get(k)! : null;
  },
  set(k: string, v: string, keepInMemory = true): boolean {
    if (backend) return backend.set(k, v);
    if (keepInMemory) mem.set(k, v);
    try {
      localStorage.setItem(k, v);
      return true;
    } catch {
      return false;
    }
  },
  del(k: string): void {
    if (backend) return backend.del(k);
    mem.delete(k);
    try { localStorage.removeItem(k); } catch { /* blocked */ }
  },
  keys(): string[] {
    if (backend) return backend.keys();
    try { return Object.keys(localStorage); } catch { return []; }
  },
};

export function readJson<T extends object>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(store.get(key) as string);
    return v && typeof v === "object" ? v : fallback;
  } catch {
    return fallback;
  }
}

export const KEY_CFG = "poeFilterGen.cfg";
export const KEY_GAME = "poeFilterGen.game";
export const loadCfg = (): Record<string, any> => readJson(KEY_CFG, {});
export const saveCfg = (cfg: unknown): boolean => store.set(KEY_CFG, JSON.stringify(cfg));

// ---- IndexedDB: "sounds" (label -> {name,type,bytes}) and "handles" (game -> FileSystemDirectoryHandle) ----

export type IdbStore = "sounds" | "handles";
let idbOk = true;
const memIdb: Record<IdbStore, Map<string, any>> = { sounds: new Map(), handles: new Map() };

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open("poe-filter-gen", 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("sounds")) db.createObjectStore("sounds");
        if (!db.objectStoreNames.contains("handles")) db.createObjectStore("handles");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("indexedDB error"));
      req.onblocked = () => reject(new Error("indexedDB blocked"));
    } catch (e) {
      reject(e);
    }
  });
}

async function idbDo<T>(storeName: IdbStore, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await idbOpen();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const out = fn(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(out ? out.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("aborted"));
    });
  } finally {
    db.close();
  }
}

export const idb = {
  async get(storeName: IdbStore, key: string): Promise<any> {
    if (idbOk) {
      try {
        const v = await idbDo(storeName, "readonly", (s) => s.get(key));
        if (v !== undefined) return v;
      } catch {
        idbOk = false;
      }
    }
    return memIdb[storeName].get(key);
  },
  async put(storeName: IdbStore, key: string, value: unknown): Promise<boolean> {
    memIdb[storeName].set(key, value);
    if (!idbOk) return false;
    try {
      await idbDo(storeName, "readwrite", (s) => s.put(value, key));
      return true;
    } catch {
      idbOk = false;
      return false;
    }
  },
  async del(storeName: IdbStore, key: string): Promise<void> {
    memIdb[storeName].delete(key);
    if (!idbOk) return;
    try {
      await idbDo(storeName, "readwrite", (s) => s.delete(key));
    } catch {
      idbOk = false;
    }
  },
  /** every key of a store (the in-memory fallback included) */
  async keys(storeName: IdbStore): Promise<string[]> {
    const out = new Set<string>(memIdb[storeName].keys());
    if (idbOk) {
      try {
        ((await idbDo(storeName, "readonly", (s) => s.getAllKeys())) ?? []).forEach((k) => out.add(String(k)));
      } catch {
        idbOk = false;
      }
    }
    return [...out];
  },
  get ok(): boolean {
    return idbOk;
  },
};
