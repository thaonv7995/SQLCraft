export interface LabEditorTab {
  id: string;
  name: string;
  sql: string;
  updatedAt: number;
}

export interface PersistedLabEditorState {
  tabs: LabEditorTab[];
  activeTabId: string;
}

const LAB_EDITOR_TABS_PREFIX = 'sqlcraft-lab-editor:';

/** Default: keep at most this many lab editor snapshots across sessions. */
export const LAB_EDITOR_STORAGE_MAX_ENTRIES_DEFAULT = 30;

/** Default: drop snapshots whose latest tab activity is older than this (ms). */
export const LAB_EDITOR_STORAGE_MAX_AGE_MS_DEFAULT = 30 * 24 * 60 * 60 * 1000; // 30 days

function collectLabEditorStorageKeys(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const k = window.localStorage.key(i);
    if (k?.startsWith(LAB_EDITOR_TABS_PREFIX)) {
      keys.push(k);
    }
  }
  return keys;
}

function getLastTabUpdatedAtFromRaw(raw: string): number | null {
  try {
    const parsed = JSON.parse(raw) as { tabs?: Array<{ updatedAt?: unknown }> };
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) {
      return null;
    }
    let max = 0;
    for (const tab of parsed.tabs) {
      if (
        tab &&
        typeof tab === 'object' &&
        typeof tab.updatedAt === 'number' &&
        Number.isFinite(tab.updatedAt)
      ) {
        max = Math.max(max, tab.updatedAt);
      }
    }
    return max > 0 ? max : null;
  } catch {
    return null;
  }
}

/**
 * Removes stale or excess `sqlcraft-lab-editor:*` entries from localStorage.
 * - Drops corrupt / empty payloads.
 * - Drops entries whose newest `tab.updatedAt` is older than `maxAgeMs`.
 * - Keeps only the `maxEntries` most recently touched sessions (by max tab `updatedAt`).
 */
export function pruneLabEditorLocalStorage(options?: {
  maxEntries?: number;
  maxAgeMs?: number;
}): void {
  if (typeof window === 'undefined') {
    return;
  }

  const maxEntries = options?.maxEntries ?? LAB_EDITOR_STORAGE_MAX_ENTRIES_DEFAULT;
  const maxAgeMs = options?.maxAgeMs ?? LAB_EDITOR_STORAGE_MAX_AGE_MS_DEFAULT;
  const now = Date.now();
  const cutoff = now - maxAgeMs;

  const keys = collectLabEditorStorageKeys();
  const survivors: { key: string; lastUpdated: number }[] = [];

  for (const key of keys) {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      continue;
    }
    const lastUpdated = getLastTabUpdatedAtFromRaw(raw);
    if (lastUpdated === null) {
      window.localStorage.removeItem(key);
      continue;
    }
    if (lastUpdated < cutoff) {
      window.localStorage.removeItem(key);
      continue;
    }
    survivors.push({ key, lastUpdated });
  }

  survivors.sort((a, b) => b.lastUpdated - a.lastUpdated);
  if (survivors.length > maxEntries) {
    for (let i = maxEntries; i < survivors.length; i += 1) {
      window.localStorage.removeItem(survivors[i].key);
    }
  }
}

/** Dialect-neutral probe: valid on PostgreSQL, MySQL/MariaDB, SQL Server (no LIMIT/TOP, no real table). */
export const DEFAULT_LAB_QUERY =
  '-- Welcome to SQLCraft!\n-- Write your SQL below. This line is a harmless probe on any supported engine.\n\nSELECT 1 AS ok;';

function getStorageKey(sessionId: string): string {
  return `${LAB_EDITOR_TABS_PREFIX}${sessionId}`;
}

function createTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function buildNextEditorTabName(existingTabs: Pick<LabEditorTab, 'name'>[]): string {
  const existingNames = new Set(existingTabs.map((tab) => tab.name.trim().toLowerCase()));

  if (!existingNames.has('query.sql')) {
    return 'query.sql';
  }

  let index = 2;
  while (existingNames.has(`query-${index}.sql`)) {
    index += 1;
  }

  return `query-${index}.sql`;
}

export function createLabEditorTab(params?: Partial<Pick<LabEditorTab, 'name' | 'sql'>>): LabEditorTab {
  return {
    id: createTabId(),
    name: params?.name?.trim() || 'query.sql',
    sql: params?.sql ?? '',
    updatedAt: Date.now(),
  };
}

export function createDefaultLabEditorState(initialSql?: string | null): PersistedLabEditorState {
  const sql =
    typeof initialSql === 'string' && initialSql.trim().length > 0 ? initialSql : DEFAULT_LAB_QUERY;
  const tab = createLabEditorTab({
    name: 'query.sql',
    sql,
  });

  return {
    tabs: [tab],
    activeTabId: tab.id,
  };
}

function isPersistedTab(value: unknown): value is LabEditorTab {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as LabEditorTab).id === 'string' &&
    typeof (value as LabEditorTab).name === 'string' &&
    typeof (value as LabEditorTab).sql === 'string' &&
    typeof (value as LabEditorTab).updatedAt === 'number' &&
    Number.isFinite((value as LabEditorTab).updatedAt)
  );
}

export function readLabEditorState(sessionId: string): PersistedLabEditorState | null {
  if (typeof window === 'undefined' || !sessionId) {
    return null;
  }

  const raw = window.localStorage.getItem(getStorageKey(sessionId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedLabEditorState>;
    if (!Array.isArray(parsed.tabs) || typeof parsed.activeTabId !== 'string') {
      return null;
    }

    const tabs = parsed.tabs.filter(isPersistedTab);
    if (tabs.length === 0) {
      return null;
    }

    const activeTabId = tabs.some((tab) => tab.id === parsed.activeTabId)
      ? parsed.activeTabId
      : tabs[0].id;

    return {
      tabs,
      activeTabId,
    };
  } catch {
    return null;
  }
}

/** Remove persisted editor tabs for a session (e.g. session ended). */
export function clearLabEditorState(sessionId: string): void {
  if (typeof window === 'undefined' || !sessionId) {
    return;
  }
  window.localStorage.removeItem(getStorageKey(sessionId));
}

export function writeLabEditorState(sessionId: string, state: PersistedLabEditorState): void {
  if (typeof window === 'undefined' || !sessionId) {
    return;
  }
  if (state.tabs.length === 0) {
    clearLabEditorState(sessionId);
    return;
  }

  window.localStorage.setItem(getStorageKey(sessionId), JSON.stringify(state));
}
