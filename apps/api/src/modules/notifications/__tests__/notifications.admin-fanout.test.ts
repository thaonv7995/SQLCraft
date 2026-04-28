import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportCanonicalDatabaseResult } from '../../admin/admin.types';

const insertSpy = vi.hoisted(() => vi.fn());
const adminRowsRef = vi.hoisted<{ value: Array<{ userId: string }> }>(() => ({ value: [] }));

vi.mock('../../../db/repositories/notifications.repository', () => ({
  notificationsRepository: {
    insert: insertSpy,
  },
}));

vi.mock('../../../db', () => {
  const make = () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => Promise.resolve(adminRowsRef.value),
        }),
      }),
    }),
  });
  return {
    getDb: () => make(),
    schema: {
      userRoles: { userId: 'userId', roleId: 'roleId' },
      roles: { id: 'id', name: 'name' },
    },
  };
});

vi.mock('drizzle-orm', () => ({
  eq: (..._args: unknown[]) => undefined,
}));

import { notifyAdminsDatasetReviewPending } from '../notifications.service';

const baseResult: ImportCanonicalDatabaseResult = {
  databaseId: 'db-1',
  schemaTemplate: {
    id: 'tpl-1',
    name: 'Acme Orders',
  } as unknown as ImportCanonicalDatabaseResult['schemaTemplate'],
} as unknown as ImportCanonicalDatabaseResult;

describe('notifyAdminsDatasetReviewPending', () => {
  beforeEach(() => {
    insertSpy.mockReset();
    adminRowsRef.value = [];
  });

  it('inserts one notification per admin, excluding the uploader', async () => {
    adminRowsRef.value = [
      { userId: 'admin-1' },
      { userId: 'admin-2' },
      { userId: 'uploader-1' },
    ];

    await notifyAdminsDatasetReviewPending(
      { id: 'uploader-1', displayName: 'Alice' },
      baseResult,
    );

    expect(insertSpy).toHaveBeenCalledTimes(2);
    const recipients = insertSpy.mock.calls.map((c) => c[0].userId);
    expect(recipients).toEqual(expect.arrayContaining(['admin-1', 'admin-2']));
    expect(recipients).not.toContain('uploader-1');
    // Title + uploader name must be in the body so admins know who submitted.
    expect(insertSpy.mock.calls[0]?.[0].body).toContain('Alice');
  });

  it('deduplicates admins that appear multiple times (e.g. via multiple roles)', async () => {
    adminRowsRef.value = [
      { userId: 'admin-1' },
      { userId: 'admin-1' },
      { userId: 'admin-2' },
    ];

    await notifyAdminsDatasetReviewPending(
      { id: 'uploader-1', displayName: 'Alice' },
      baseResult,
    );

    expect(insertSpy).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when no admins exist (other than the uploader)', async () => {
    adminRowsRef.value = [{ userId: 'uploader-1' }];

    await notifyAdminsDatasetReviewPending(
      { id: 'uploader-1', displayName: 'Alice' },
      baseResult,
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });
});
