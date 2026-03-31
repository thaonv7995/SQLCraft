'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  databasesApi,
  type Database,
  type SandboxGoldenStatus,
  type InviteUserSearchItem,
} from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { UserInviteMultiSelect } from '@/components/user/user-invite-multi-select';
import { cn } from '@/lib/utils';

function goldenBadgeVariant(status: SandboxGoldenStatus): 'success' | 'pending' | 'error' | 'idle' {
  if (status === 'ready') return 'success';
  if (status === 'pending') return 'pending';
  if (status === 'failed') return 'error';
  return 'idle';
}

function goldenLabel(status: SandboxGoldenStatus): string {
  if (status === 'ready') return 'Ready';
  if (status === 'pending') return 'Baking';
  if (status === 'failed') return 'Failed';
  return 'Not started';
}

type ExploreDatabaseOwnerPanelProps = {
  database: Database;
};

export function ExploreDatabaseOwnerPanel({ database }: ExploreDatabaseOwnerPanelProps) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [description, setDescription] = useState(database.description ?? '');
  const [inviteUsers, setInviteUsers] = useState<InviteUserSearchItem[]>([]);

  const status = database.sandboxGoldenStatus ?? 'none';

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['database', database.id] });
    void queryClient.invalidateQueries({ queryKey: ['catalog-databases'] });
    void queryClient.invalidateQueries({ queryKey: ['databases'] });
  };

  const retriggerMutation = useMutation({
    mutationFn: () => databasesApi.retriggerGoldenBake(database.id),
    onSuccess: () => {
      toast.success('Golden snapshot bake queued');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patchMutation = useMutation({
    mutationFn: () => databasesApi.patchOwner(database.id, { description: description.trim() }),
    onSuccess: () => {
      toast.success('Description updated');
      setEditOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => databasesApi.deleteOwner(database.id),
    onSuccess: () => {
      toast.success('Database removed');
      setDeleteOpen(false);
      window.location.href = '/explore';
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      databasesApi.addOwnerInvites(
        database.id,
        inviteUsers.map((u) => u.id),
      ),
    onSuccess: () => {
      toast.success('Invites sent');
      setInviteOpen(false);
      setInviteUsers([]);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isPrivateOwner = database.catalogKind === 'private_owner';

  return (
    <>
      <Card className="overflow-hidden rounded-2xl border border-outline-variant/10 bg-surface-container-low">
        <CardHeader className="border-b border-outline-variant/10 px-5 py-4 sm:px-6 sm:py-5">
          <CardTitle className="text-lg">Your upload</CardTitle>
          <CardDescription className="mt-1 max-w-2xl text-sm leading-relaxed">
            Golden snapshots power sandbox restores at each scale. When status is not ready, you can
            retry the bake after fixing upstream issues.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-3 rounded-xl border border-outline-variant/10 bg-surface-container/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">
                Golden snapshot
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={goldenBadgeVariant(status)} dot>
                  {goldenLabel(status)}
                </Badge>
                {status === 'ready' ? (
                  <span className="text-xs text-on-surface-variant">Sandboxes use this snapshot.</span>
                ) : null}
              </div>
              {database.sandboxGoldenError ? (
                <p className="mt-2 text-xs leading-relaxed text-error">{database.sandboxGoldenError}</p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={retriggerMutation.isPending}
              onClick={() => retriggerMutation.mutate()}
              leftIcon={<span className="material-symbols-outlined text-base">restart_alt</span>}
            >
              Retry bake
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setDescription(database.description ?? '');
                setEditOpen(true);
              }}
              leftIcon={<span className="material-symbols-outlined text-base">edit</span>}
            >
              Edit description
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setDeleteOpen(true)}
              leftIcon={<span className="material-symbols-outlined text-base">delete</span>}
            >
              Delete
            </Button>
            {isPrivateOwner ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setInviteOpen(true)}
                leftIcon={<span className="material-symbols-outlined text-base">person_add</span>}
              >
                Invite users
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {editOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
          onClick={() => !patchMutation.isPending && setEditOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="owner-db-edit-title"
            className="w-full max-w-lg rounded-xl border border-outline-variant/15 bg-surface-container-low p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="owner-db-edit-title" className="text-lg font-semibold text-on-surface">
              Edit description
            </h2>
            <textarea
              className={cn(
                'mt-4 w-full rounded-lg border border-outline-variant/20 bg-surface-container px-3 py-2 text-sm text-on-surface',
                'min-h-[120px] resize-y',
              )}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={4000}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" type="button" onClick={() => setEditOpen(false)} disabled={patchMutation.isPending}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="button"
                loading={patchMutation.isPending}
                onClick={() => patchMutation.mutate()}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {inviteOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
          onClick={() => !inviteMutation.isPending && setInviteOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="owner-db-invite-title"
            className="w-full max-w-lg rounded-xl border border-outline-variant/15 bg-surface-container-low p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="owner-db-invite-title" className="text-lg font-semibold text-on-surface">
              Invite to private database
            </h2>
            <p className="mt-2 text-sm text-on-surface-variant">
              Search active users and add them to this database. They will see it in Explorer like
              other shared private catalogs.
            </p>
            <div className="mt-4">
              <UserInviteMultiSelect value={inviteUsers} onChange={setInviteUsers} />
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" type="button" onClick={() => setInviteOpen(false)} disabled={inviteMutation.isPending}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="button"
                loading={inviteMutation.isPending}
                disabled={inviteUsers.length === 0}
                onClick={() => inviteMutation.mutate()}
              >
                Send invites
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        open={deleteOpen}
        eyebrow="Database"
        title="Delete this database?"
        description={[
          `Remove “${database.name}” from your catalog?`,
          'This deletes uploaded artifacts and dataset templates.',
          'Deletion is blocked if any challenge still references this database.',
        ].join(' ')}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        icon="delete_forever"
        confirmVariant="destructive"
        isPending={deleteMutation.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        titleId="owner-db-delete-title"
      />
    </>
  );
}
