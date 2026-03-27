import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test';

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:4000/v1';
const LEARNER_EMAIL = 'user@sqlcraft.dev';
const LEARNER_PASSWORD = 'user12345';
const ADMIN_EMAIL = 'admin@sqlcraft.dev';
const ADMIN_PASSWORD = 'admin123';
const STARTER_QUERY_COLUMNS = [
  'id',
  'name',
  'description',
  'price',
  'stock_quantity',
  'category_id',
  'created_at',
];

type AuthSession = {
  user: {
    id: string;
    email: string;
    username: string;
    displayName: string;
    role?: string;
    roles: string[];
    createdAt?: string;
  };
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
};

type TracksListResponse = {
  items: Array<{
    id: string;
    slug: string;
    title: string;
  }>;
};

type TrackDetail = {
  id: string;
  title: string;
  lessons: Array<{
    id: string;
    slug: string;
    title: string;
    publishedVersionId: string | null;
  }>;
};

type LessonVersion = {
  id: string;
  lessonId: string;
  starterQuery: string | null;
  challenges: Array<{
    id: string;
    title: string;
    publishedVersionId: string | null;
  }>;
};

type IntroLesson = {
  trackId: string;
  trackTitle: string;
  lessonId: string;
  lessonTitle: string;
  lessonVersionId: string;
  starterQuery: string;
};

type CreatedChallenge = {
  challengeId: string;
  challengeTitle: string;
  challengeVersionId: string;
};

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

async function parseApiData<T>(response: APIResponse): Promise<T> {
  const body = await response.text();

  if (!response.ok()) {
    throw new Error(`API ${response.url()} failed: ${response.status()} ${body}`);
  }

  const json = JSON.parse(body) as { data: T };
  return json.data;
}

async function loginViaApi(
  request: APIRequestContext,
  credentials: { email: string; password: string },
): Promise<AuthSession> {
  return parseApiData<AuthSession>(
    await request.post(`${API_BASE_URL}/auth/login`, {
      data: credentials,
    }),
  );
}

async function seedBrowserAuth(page: Page, auth: AuthSession): Promise<void> {
  await page.addInitScript(
    ({ user, tokens }) => {
      window.localStorage.setItem(
        'sqlcraft-auth',
        JSON.stringify({
          state: { user, tokens },
          version: 0,
        }),
      );
    },
    { user: auth.user, tokens: auth.tokens },
  );
}

async function getIntroLesson(
  request: APIRequestContext,
  accessToken: string,
): Promise<IntroLesson> {
  const tracks = await parseApiData<TracksListResponse>(
    await request.get(`${API_BASE_URL}/tracks`, {
      headers: authHeaders(accessToken),
    }),
  );

  const fundamentalsTrack = tracks.items.find((track) => track.slug === 'sql-fundamentals');
  if (!fundamentalsTrack) {
    throw new Error('Seeded SQL Fundamentals track is missing');
  }

  const trackDetail = await parseApiData<TrackDetail>(
    await request.get(`${API_BASE_URL}/tracks/${fundamentalsTrack.id}`, {
      headers: authHeaders(accessToken),
    }),
  );

  const introLesson = trackDetail.lessons.find(
    (lesson) => lesson.slug === 'intro-to-select' && lesson.publishedVersionId,
  );
  if (!introLesson?.publishedVersionId) {
    throw new Error('Seeded Introduction to SELECT lesson is missing a published version');
  }

  const lessonVersion = await parseApiData<LessonVersion>(
    await request.get(`${API_BASE_URL}/lesson-versions/${introLesson.publishedVersionId}`, {
      headers: authHeaders(accessToken),
    }),
  );

  if (!lessonVersion.starterQuery?.trim()) {
    throw new Error('Seeded Introduction to SELECT lesson is missing its starter query');
  }

  return {
    trackId: fundamentalsTrack.id,
    trackTitle: fundamentalsTrack.title,
    lessonId: introLesson.id,
    lessonTitle: introLesson.title,
    lessonVersionId: lessonVersion.id,
    starterQuery: lessonVersion.starterQuery,
  };
}

async function createPublishedChallenge(
  request: APIRequestContext,
  accessToken: string,
  lesson: IntroLesson,
): Promise<CreatedChallenge> {
  const slug = `playwright-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const challengeTitle = `Playwright Attempt ${slug}`;

  const creation = await parseApiData<{
    challenge: { id: string };
    version: { id: string };
  }>(
    await request.post(`${API_BASE_URL}/challenges`, {
      headers: authHeaders(accessToken),
      data: {
        lessonId: lesson.lessonId,
        slug,
        title: challengeTitle,
        description: 'Temporary real-stack challenge for Playwright validation.',
        difficulty: 'beginner',
        sortOrder: 999,
        points: 100,
        problemStatement: 'Run the starter query and submit the latest successful execution.',
        expectedResultColumns: STARTER_QUERY_COLUMNS,
        referenceSolution: lesson.starterQuery,
        validatorType: 'result_set',
        validatorConfig: {
          baselineDurationMs: 60_000,
          maxTotalCost: 1_000_000,
        },
      },
    }),
  );

  await parseApiData(
    await request.post(`${API_BASE_URL}/admin/challenge-versions/${creation.version.id}/review`, {
      headers: authHeaders(accessToken),
      data: {
        decision: 'approve',
        note: 'Published for Playwright end-to-end coverage',
      },
    }),
  );

  const refreshedLessonVersion = await parseApiData<LessonVersion>(
    await request.get(`${API_BASE_URL}/lesson-versions/${lesson.lessonVersionId}`, {
      headers: authHeaders(accessToken),
    }),
  );

  const publishedChallenge = refreshedLessonVersion.challenges.find(
    (challenge) => challenge.id === creation.challenge.id,
  );

  if (!publishedChallenge?.publishedVersionId) {
    throw new Error('Approved challenge did not appear on the published lesson version');
  }

  return {
    challengeId: publishedChallenge.id,
    challengeTitle,
    challengeVersionId: publishedChallenge.publishedVersionId,
  };
}

async function startFreshLessonLab(page: Page): Promise<void> {
  const startNewLabButton = page.getByRole('button', { name: /Start New Lab$/ });

  if (await startNewLabButton.isVisible().catch(() => false)) {
    await startNewLabButton.click();
    return;
  }

  await page.getByRole('button', { name: /Start Lab$/ }).click();
}

async function waitForLabReady(page: Page): Promise<void> {
  await expect(page.locator('header').getByText('Ready')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('button', { name: /Run$/ })).toBeEnabled({ timeout: 120_000 });
}

function hrefSelector(path: string): string {
  return `a[href="${path}"]`;
}

test.describe('lesson happy path on the real stack', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);

  test('opens a real lesson lab and carries starter SQL into the editor', async ({
    page,
    request,
  }) => {
    const learner = await loginViaApi(request, {
      email: LEARNER_EMAIL,
      password: LEARNER_PASSWORD,
    });
    const lesson = await getIntroLesson(request, learner.tokens.accessToken);

    await seedBrowserAuth(page, learner);
    await page.goto('/tracks');

    await expect(page.getByRole('heading', { name: 'Practice Collections' })).toBeVisible();
    const trackLink = page.locator(hrefSelector(`/tracks/${lesson.trackId}`)).first();
    await expect(trackLink).toBeVisible();
    await trackLink.click();

    await expect(page).toHaveURL(new RegExp(`/tracks/${lesson.trackId}$`));
    await expect(page.getByRole('heading', { name: lesson.trackTitle })).toBeVisible();
    await expect(page.getByRole('heading', { name: lesson.lessonTitle, level: 3 })).toBeVisible();
    await page.goto(`/tracks/${lesson.trackId}/lessons/${lesson.lessonId}`);

    await expect(page).toHaveURL(new RegExp(`/tracks/${lesson.trackId}/lessons/${lesson.lessonId}$`));
    await expect(page.getByRole('heading', { name: lesson.lessonTitle }).first()).toBeVisible();

    await startFreshLessonLab(page);

    await expect(page).toHaveURL(/\/lab\/[0-9a-f-]+$/);
    await waitForLabReady(page);
    await expect(page.locator('header').getByText(lesson.lessonTitle)).toBeVisible();
    await expect(page.getByTestId('lab-sql-editor').locator('.cm-content')).toContainText(
      lesson.starterQuery,
    );
  });

  test('runs a real query and submits a scored challenge attempt', async ({
    page,
    request,
  }) => {
    const admin = await loginViaApi(request, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    const learner = await loginViaApi(request, {
      email: LEARNER_EMAIL,
      password: LEARNER_PASSWORD,
    });
    const lesson = await getIntroLesson(request, admin.tokens.accessToken);
    const challenge = await createPublishedChallenge(request, admin.tokens.accessToken, lesson);

    await seedBrowserAuth(page, learner);
    await page.goto(`/tracks/${lesson.trackId}/lessons/${lesson.lessonId}`);

    await expect(page.getByRole('heading', { name: lesson.lessonTitle }).first()).toBeVisible();
    const challengeLink = page
      .locator(
        hrefSelector(
          `/tracks/${lesson.trackId}/lessons/${lesson.lessonId}/challenges/${challenge.challengeId}`,
        ),
      )
      .first();
    await expect(challengeLink).toBeVisible();
    await challengeLink.click();

    await expect(page).toHaveURL(
      new RegExp(`/tracks/${lesson.trackId}/lessons/${lesson.lessonId}/challenges/${challenge.challengeId}$`),
    );
    await expect(page.getByRole('heading', { name: challenge.challengeTitle })).toBeVisible();

    await page.getByRole('button', { name: /Start Challenge Lab$/ }).click();

    await expect(page).toHaveURL(/\/lab\/[0-9a-f-]+$/);
    await waitForLabReady(page);
    await expect(page.getByTestId('lab-sql-editor').locator('.cm-content')).toContainText(
      lesson.starterQuery,
    );

    await page.getByRole('button', { name: /Run$/ }).click();
    await expect(page.getByRole('button', { name: /Submit Attempt$/ })).toBeEnabled({
      timeout: 60_000,
    });

    await page.getByRole('button', { name: /Submit Attempt$/ }).click();

    await expect(page.locator('header').getByText('Best 100 pts')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('header').getByText('Correct result set.')).toBeVisible({
      timeout: 60_000,
    });
  });
});
