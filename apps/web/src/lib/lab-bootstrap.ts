const LAB_BOOTSTRAP_PREFIX = 'sqlcraft-lab-bootstrap:';

export interface LabBootstrapPayload {
  mode?: 'lesson' | 'challenge';
  lessonPath?: string;
  lessonTitle?: string;
  challengePath?: string;
  challengeTitle?: string;
  starterQuery?: string | null;
  starterQueryConsumed?: boolean;
}

function getStorageKey(sessionId: string): string {
  return `${LAB_BOOTSTRAP_PREFIX}${sessionId}`;
}

export function saveLabBootstrap(sessionId: string, payload: LabBootstrapPayload): void {
  if (typeof window === 'undefined' || !sessionId) {
    return;
  }

  window.sessionStorage.setItem(getStorageKey(sessionId), JSON.stringify(payload));
}

export function readLabBootstrap(sessionId: string): LabBootstrapPayload | null {
  if (typeof window === 'undefined' || !sessionId) {
    return null;
  }

  const raw = window.sessionStorage.getItem(getStorageKey(sessionId));

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as LabBootstrapPayload;
  } catch {
    return null;
  }
}

export function consumeLabBootstrap(sessionId: string): LabBootstrapPayload | null {
  const payload = readLabBootstrap(sessionId);

  if (!payload) {
    return null;
  }

  if (!payload.starterQueryConsumed && payload.starterQuery) {
    saveLabBootstrap(sessionId, {
      ...payload,
      starterQueryConsumed: true,
    });
  }

  return payload;
}

export function markLabBootstrapConsumed(sessionId: string): void {
  const payload = readLabBootstrap(sessionId);

  if (!payload || payload.starterQueryConsumed) {
    return;
  }

  saveLabBootstrap(sessionId, {
    ...payload,
    starterQueryConsumed: true,
  });
}
