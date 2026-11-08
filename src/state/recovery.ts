/**
 * Local recovery snapshots of unsaved edits.
 *
 * Scope is intentionally narrow so recovery is reliable and safe:
 *  - keyed by (sanitised page path, Monaco model URI); restore is only offered when the
 *    same page and the same file are open again;
 *  - stored in the app sandbox (not AsyncStorage) and never included in diagnostics;
 *  - restore is always user-confirmed and applied as one undoable Monaco edit;
 *  - snapshots expire after 7 days and at most 20 are kept.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { fnv1a } from '../shared/hash';

export interface Snapshot {
  location: string;
  modelUri: string;
  content: string;
  savedAt: number;
}

const MAX_SNAPSHOTS = 20;
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export function snapshotKey(location: string, modelUri: string): string {
  return fnv1a(`${location}\u0000${modelUri}`);
}

export interface SnapshotStorage {
  write(key: string, data: string): Promise<void>;
  read(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
  list(): Promise<string[]>;
}

export function fileSnapshotStorage(): SnapshotStorage {
  const dir = new Directory(Paths.document, 'recovery');
  const ensure = () => {
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  };
  return {
    async write(key, data) {
      ensure();
      const f = new File(dir, `${key}.json`);
      if (!f.exists) f.create();
      await f.write(data);
    },
    async read(key) {
      const f = new File(dir, `${key}.json`);
      return f.exists ? f.text() : null;
    },
    async remove(key) {
      const f = new File(dir, `${key}.json`);
      if (f.exists) f.delete();
    },
    async list() {
      if (!dir.exists) return [];
      return dir
        .list()
        .filter((e): e is File => e instanceof File && e.name.endsWith('.json'))
        .map((f) => f.name.replace(/\.json$/, ''));
    },
  };
}

export class RecoveryStore {
  constructor(private storage: SnapshotStorage, private now: () => number = Date.now) {}

  async save(location: string, modelUri: string, content: string): Promise<void> {
    const snap: Snapshot = { location, modelUri, content, savedAt: this.now() };
    await this.storage.write(snapshotKey(location, modelUri), JSON.stringify(snap));
    await this.prune();
  }

  async get(location: string, modelUri: string): Promise<Snapshot | null> {
    const key = snapshotKey(location, modelUri);
    const raw = await this.storage.read(key).catch(() => null);
    if (!raw) return null;
    try {
      const s = JSON.parse(raw) as Snapshot;
      if (s.location !== location || s.modelUri !== modelUri || typeof s.content !== 'string') return null;
      if (this.now() - s.savedAt > MAX_AGE_MS) {
        await this.storage.remove(key);
        return null;
      }
      return s;
    } catch {
      return null;
    }
  }

  /** Deletes every snapshot (Settings → Sign out and clear data). */
  async clearAll(): Promise<void> {
    const keys = await this.storage.list();
    for (const key of keys) await this.storage.remove(key);
  }

  async discard(location: string, modelUri: string): Promise<void> {
    await this.storage.remove(snapshotKey(location, modelUri));
  }

  async prune(): Promise<void> {
    const keys = await this.storage.list();
    const entries: { key: string; savedAt: number }[] = [];
    for (const key of keys) {
      const raw = await this.storage.read(key).catch(() => null);
      let savedAt = 0;
      try {
        savedAt = raw ? (JSON.parse(raw) as Snapshot).savedAt : 0;
      } catch {
        savedAt = 0;
      }
      if (this.now() - savedAt > MAX_AGE_MS) await this.storage.remove(key);
      else entries.push({ key, savedAt });
    }
    entries.sort((a, b) => b.savedAt - a.savedAt);
    for (const e of entries.slice(MAX_SNAPSHOTS)) await this.storage.remove(e.key);
  }
}
