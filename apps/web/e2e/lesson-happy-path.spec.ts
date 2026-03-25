import { expect, test } from '@playwright/test';

const seededTrack = {
  id: 'track-1',
  slug: 'sql-fundamentals',
  title: 'SQL Fundamentals',
  description:
    'Master the basics of SQL from SELECT queries to JOINs and aggregations. Perfect for beginners.',
  difficulty: 'beginner' as const,
  lessonCount: 1,
  status: 'published' as const,
  createdAt: '2026-03-24T09:00:00.000Z',
  updatedAt: '2026-03-24T09:00:00.000Z',
};

const seededLesson = {
  id: 'lesson-1',
  trackId: seededTrack.id,
  slug: 'intro-to-select',
  title: 'Introduction to SELECT',
  description: 'Learn the most fundamental SQL command to retrieve data from tables.',
  difficulty: 'beginner' as const,
  estimatedMinutes: 15,
  sortOrder: 1,
  publishedVersionId: 'version-1',
  status: 'published' as const,
  createdAt: '2026-03-24T09:00:00.000Z',
  updatedAt: '2026-03-24T09:00:00.000Z',
};

const seededLessonVersion = {
  id: 'version-1',
  lessonId: seededLesson.id,
  versionNo: 1,
  title: seededLesson.title,
  content: '# Introduction to SELECT\n\nUse `SELECT` to read rows from a table.',
  starterQuery: 'SELECT * FROM products LIMIT 10;',
  isPublished: true,
  schemaTemplateId: 'schema-1',
  datasetTemplateId: null,
  publishedAt: '2026-03-24T09:00:00.000Z',
  createdAt: '2026-03-24T09:00:00.000Z',
  lesson: {
    id: seededLesson.id,
    trackId: seededTrack.id,
    slug: seededLesson.slug,
    title: seededLesson.title,
    difficulty: seededLesson.difficulty,
    estimatedMinutes: seededLesson.estimatedMinutes,
  },
  challenges: [],
  schemaTemplate: {
    id: 'schema-1',
    name: 'Ecommerce',
    description: 'Seeded ecommerce schema',
    version: 1,
    definition: {
      tables: [{ name: 'products' }, { name: 'orders' }, { name: 'users' }],
    },
    status: 'published' as const,
    createdAt: '2026-03-24T09:00:00.000Z',
    updatedAt: '2026-03-24T09:00:00.000Z',
  },
};

const activeSession = {
  id: 'session-1',
  userId: 'user-1',
  lessonVersionId: seededLessonVersion.id,
  challengeVersionId: null,
  status: 'active' as const,
  sandboxStatus: 'ready',
  lessonTitle: seededLesson.title,
  sandbox: {
    id: 'sandbox-1',
    status: 'ready',
    dbName: 'sandbox_session_1',
    expiresAt: '2026-03-24T11:00:00.000Z',
    updatedAt: '2026-03-24T09:00:00.000Z',
  },
  startedAt: '2026-03-24T09:00:00.000Z',
  lastActivityAt: '2026-03-24T09:00:00.000Z',
  createdAt: '2026-03-24T09:00:00.000Z',
};

function ok(data: unknown, message = 'OK') {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      code: 'SUCCESS',
      message,
      data,
    }),
  };
}

test('opens a track, opens a lesson, starts a lab, and carries starter SQL into the editor', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'sqlcraft-auth',
      JSON.stringify({
        state: {
          user: {
            id: 'user-1',
            username: 'testuser',
            email: 'user@sqlcraft.dev',
            displayName: 'SQLCraft User',
            role: 'user',
            roles: ['user'],
            createdAt: '2026-03-24T09:00:00.000Z',
          },
          tokens: {
            accessToken: 'test-access-token',
            refreshToken: 'test-refresh-token',
            expiresIn: 900,
          },
        },
        version: 0,
      }),
    );
  });

  let createdSessionPayload: unknown = null;

  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;

    if (request.method() === 'GET' && pathname === '/v1/tracks') {
      return route.fulfill(
        ok({
          items: [seededTrack],
          meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
        }, 'Tracks retrieved successfully'),
      );
    }

    if (request.method() === 'GET' && pathname === `/v1/tracks/${seededTrack.id}`) {
      return route.fulfill(
        ok(
          {
            ...seededTrack,
            lessons: [seededLesson],
            userProgress: {
              completedLessons: 0,
              lastAccessedAt: '2026-03-24T09:00:00.000Z',
            },
          },
          'Track retrieved successfully',
        ),
      );
    }

    if (request.method() === 'GET' && pathname === `/v1/lessons/${seededLesson.id}`) {
      return route.fulfill(ok(seededLesson, 'Lesson retrieved successfully'));
    }

    if (request.method() === 'GET' && pathname === `/v1/lesson-versions/${seededLessonVersion.id}`) {
      return route.fulfill(
        ok(seededLessonVersion, 'Lesson version retrieved successfully'),
      );
    }

    if (request.method() === 'GET' && pathname === '/v1/learning-sessions') {
      return route.fulfill(ok([], 'Sessions retrieved'));
    }

    if (request.method() === 'POST' && pathname === '/v1/learning-sessions') {
      createdSessionPayload = request.postDataJSON();
      return route.fulfill(
        ok(
          {
            session: activeSession,
            sandbox: {
              id: activeSession.sandbox.id,
              status: activeSession.sandbox.status,
            },
          },
          'Learning session created',
        ),
      );
    }

    if (request.method() === 'GET' && pathname === `/v1/learning-sessions/${activeSession.id}`) {
      return route.fulfill(ok(activeSession, 'Session retrieved successfully'));
    }

    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        code: 'UNMOCKED_ROUTE',
        message: `Unmocked ${request.method()} ${pathname}`,
        data: null,
      }),
    });
  });

  await page.goto('/tracks');

  await expect(page.getByRole('heading', { name: 'Learning Tracks' })).toBeVisible();
  await page.locator(`a[href="/tracks/${seededTrack.id}"]`).click();

  await expect(page).toHaveURL(/\/tracks\/track-1$/);
  await expect(page.getByRole('heading', { name: seededTrack.title })).toBeVisible();

  await page.getByRole('button', { name: 'Open lesson' }).click();

  await expect(page).toHaveURL(/\/tracks\/track-1\/lessons\/lesson-1$/);
  await expect(page.getByRole('heading', { name: seededLesson.title }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Start Lab' }).click();

  await expect(page).toHaveURL(/\/lab\/session-1$/);
  await expect(page.locator('header').getByText(seededLesson.title)).toBeVisible();
  await expect(page.getByTestId('lab-sql-editor').locator('.cm-content')).toContainText(
    seededLessonVersion.starterQuery,
  );
  expect(createdSessionPayload).toEqual({ lessonVersionId: seededLessonVersion.id });
});
