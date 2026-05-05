/**
 * IndexedDB-backed outbox for the mobile capture page.
 *
 * When the LAN drops mid-capture (parent walked out of WiFi range), we still
 * want the photo + note to land safely. The outbox stores `{id, blob, mime,
 * note, ts_event, created_at}` rows, exposes `count()` for the UI badge,
 * and `flush()` to drain everything that's queued.
 *
 * `flush` is idempotent: only successfully-uploaded items are deleted.
 */

const DB_NAME = "diary-mobile";
const STORE = "outbox";
const VERSION = 1;

export interface OutboxItem {
  id: string;
  blob: Blob;
  mime: string;
  note: string;
  ts_event: string;
  created_at: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        const r = fn(store);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        t.onerror = () => reject(t.error);
      })
  );
}

export const outbox = {
  async enqueue(item: Omit<OutboxItem, "id" | "created_at">): Promise<OutboxItem> {
    const full: OutboxItem = {
      ...item,
      id: crypto.randomUUID(),
      created_at: Date.now(),
    };
    await tx("readwrite", (s) => s.add(full));
    listeners.forEach((l) => l());
    return full;
  },
  async count(): Promise<number> {
    return tx("readonly", (s) => s.count());
  },
  async list(): Promise<OutboxItem[]> {
    return tx("readonly", (s) => s.getAll() as IDBRequest<OutboxItem[]>);
  },
  async remove(id: string): Promise<void> {
    await tx("readwrite", (s) => s.delete(id));
    listeners.forEach((l) => l());
  },
  /**
   * Drain queued items by sending each through `sender`. Items that
   * `sender` resolves are removed; failures are left for next flush.
   * Returns counts {sent, failed}.
   */
  async flush(sender: (item: OutboxItem) => Promise<void>): Promise<{ sent: number; failed: number }> {
    const items = await this.list();
    let sent = 0;
    let failed = 0;
    for (const item of items) {
      try {
        await sender(item);
        await tx("readwrite", (s) => s.delete(item.id));
        sent += 1;
      } catch {
        failed += 1;
      }
    }
    listeners.forEach((l) => l());
    return { sent, failed };
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

const listeners = new Set<() => void>();
