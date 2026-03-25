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

export const DEFAULT_LAB_QUERY =
  '-- Welcome to SQLCraft!\n-- Start writing your SQL query here...\n\nSELECT * FROM employees LIMIT 10;';

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

export function createDefaultLabEditorState(initialSql: string = DEFAULT_LAB_QUERY): PersistedLabEditorState {
  const tab = createLabEditorTab({
    name: 'query.sql',
    sql: initialSql,
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

export function writeLabEditorState(sessionId: string, state: PersistedLabEditorState): void {
  if (typeof window === 'undefined' || !sessionId || state.tabs.length === 0) {
    return;
  }

  window.localStorage.setItem(getStorageKey(sessionId), JSON.stringify(state));
}
