'use client';

import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
} from '@/components/ui/table';
import {
  usersApi,
  type AdminCreateUserPayload,
  type AdminUpdateUserPayload,
  type User,
  type UserRole,
} from '@/lib/api';
import { formatDate, generateInitials } from '@/lib/utils';
import toast from 'react-hot-toast';

interface AdminUser extends User {
  isActive?: boolean;
}

type AdminRoleFilter = 'all' | UserRole;
type ManagedRole = UserRole;
type ManagedStatus = 'active' | 'disabled' | 'invited';

interface UserEditorFormState {
  email: string;
  username: string;
  displayName: string;
  password: string;
  bio: string;
  role: ManagedRole;
  status: ManagedStatus;
}

type UserEditorState =
  | { mode: 'create' }
  | { mode: 'edit'; user: AdminUser };

const ROLE_TABS = [
  { value: 'all', label: 'All Users' },
  { value: 'user', label: 'Users' },
  { value: 'admin', label: 'Admins' },
] satisfies Array<{ value: AdminRoleFilter; label: string }>;

const ROLE_OPTIONS = [
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
] satisfies Array<{ value: ManagedRole; label: string }>;

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'invited', label: 'Invited' },
] satisfies Array<{ value: ManagedStatus; label: string }>;

const ROLE_STYLES: Record<ManagedRole, string> = {
  admin: 'text-error bg-error/10',
  user: 'text-on-surface-variant bg-surface-container-high',
};

const ROLE_LABELS: Record<ManagedRole, string> = {
  admin: 'Admin',
  user: 'User',
};

function getManagedRole(user: AdminUser): ManagedRole {
  return user.role === 'admin' || (user.roles?.includes('admin') ?? false) ? 'admin' : 'user';
}

function getManagedStatus(user: AdminUser): ManagedStatus {
  if (user.status === 'disabled') {
    return 'disabled';
  }

  if (user.status === 'invited') {
    return 'invited';
  }

  return 'active';
}

function buildEditorFormState(user?: AdminUser): UserEditorFormState {
  return {
    email: user?.email ?? '',
    username: user?.username ?? '',
    displayName: user?.displayName ?? '',
    password: '',
    bio: user?.bio ?? '',
    role: user ? getManagedRole(user) : 'user',
    status: user ? getManagedStatus(user) : 'active',
  };
}

function UserEditorCard({
  editorState,
  loading,
  onCancel,
  onSubmit,
}: {
  editorState: UserEditorState;
  loading: boolean;
  onCancel: () => void;
  onSubmit: (form: UserEditorFormState) => void;
}) {
  const [form, setForm] = useState<UserEditorFormState>(
    buildEditorFormState(editorState.mode === 'edit' ? editorState.user : undefined),
  );
  const isEdit = editorState.mode === 'edit';

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!form.email.trim()) {
      toast.error('Email is required');
      return;
    }

    if (!form.username.trim()) {
      toast.error('Username is required');
      return;
    }

    if (!isEdit && !form.password.trim()) {
      toast.error('Password is required for new users');
      return;
    }

    onSubmit(form);
  };

  return (
    <Card className="border border-outline-variant/10">
      <CardHeader className="flex-col items-start gap-3">
        <div className="flex w-full items-start justify-between gap-3">
          <div>
            <CardTitle>{isEdit ? 'Edit User' : 'Create User'}</CardTitle>
            <CardDescription className="mt-1">
              {isEdit
                ? 'Update profile fields, access level, status, or reset the password for this account.'
                : 'Provision a new account directly from the admin console.'}
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label="Email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="name@example.com"
              autoComplete="off"
            />
            <Input
              label="Username"
              value={form.username}
              onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
              placeholder="username"
              autoComplete="off"
            />
            <Input
              label="Display Name"
              value={form.displayName}
              onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
              placeholder="Optional display name"
            />
            <Input
              label={isEdit ? 'Reset Password' : 'Password'}
              type="password"
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              placeholder={isEdit ? 'Leave blank to keep existing password' : 'Minimum 8 characters'}
              hint={isEdit ? 'Only fill this field if you want to replace the current password.' : undefined}
              autoComplete="new-password"
            />
            <Select
              label="Role"
              value={form.role}
              onChange={(event) =>
                setForm((current) => ({ ...current, role: event.target.value as ManagedRole }))
              }
              options={ROLE_OPTIONS}
            />
            <Select
              label="Status"
              value={form.status}
              onChange={(event) =>
                setForm((current) => ({ ...current, status: event.target.value as ManagedStatus }))
              }
              options={STATUS_OPTIONS}
            />
          </div>

          <Textarea
            label="Bio"
            value={form.bio}
            onChange={(event) => setForm((current) => ({ ...current, bio: event.target.value }))}
            rows={3}
            placeholder="Optional internal profile bio"
          />

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-container-low px-4 py-3">
            <p className="text-xs text-on-surface-variant">
              Delete actions are soft deletes. They disable sign-in and anonymize the account while
              keeping historical records intact.
            </p>
            <Button type="submit" loading={loading}>
              {isEdit ? 'Save Changes' : 'Create User'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<AdminRoleFilter>('all');
  const [page, setPage] = useState(1);
  const [editorState, setEditorState] = useState<UserEditorState | null>(null);
  const [userPendingDelete, setUserPendingDelete] = useState<AdminUser | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', search, roleFilter, page],
    queryFn: () =>
      usersApi.list({
        search: search || undefined,
        role: roleFilter === 'all' ? undefined : roleFilter,
        page,
      }),
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: (payload: AdminCreateUserPayload) => usersApi.createAdmin(payload),
    onSuccess: () => {
      toast.success('User created');
      setEditorState(null);
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create user');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ userId, payload }: { userId: string; payload: AdminUpdateUserPayload }) =>
      usersApi.updateAdmin(userId, payload),
    onSuccess: () => {
      toast.success('User updated');
      setEditorState(null);
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update user');
    },
  });

  const disableMutation = useMutation({
    mutationFn: (userId: string) => usersApi.disable(userId),
    onSuccess: () => {
      toast.success('User disabled');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: () => toast.error('Failed to disable user'),
  });

  const enableMutation = useMutation({
    mutationFn: (userId: string) => usersApi.enable(userId),
    onSuccess: () => {
      toast.success('User enabled');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: () => toast.error('Failed to enable user'),
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => usersApi.deleteAdmin(userId),
    onSuccess: (_data, userId) => {
      toast.success('User deleted');
      if (editorState?.mode === 'edit' && editorState.user.id === userId) {
        setEditorState(null);
      }
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete user');
    },
  });

  const displayUsers: AdminUser[] = (data?.items as AdminUser[] | undefined) ?? [];

  const handleEditorSubmit = (form: UserEditorFormState) => {
    if (editorState?.mode === 'edit') {
      updateMutation.mutate({
        userId: editorState.user.id,
        payload: {
          email: form.email.trim(),
          username: form.username.trim(),
          displayName: form.displayName.trim() || null,
          password: form.password.trim() || undefined,
          bio: form.bio.trim() || null,
          role: form.role,
          status: form.status,
        },
      });
      return;
    }

    createMutation.mutate({
      email: form.email.trim(),
      username: form.username.trim(),
      displayName: form.displayName.trim() || undefined,
      password: form.password,
      bio: form.bio.trim() || null,
      role: form.role,
      status: form.status,
    });
  };

  return (
    <div className="page-shell-wide page-stack">
      <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low p-6 lg:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] uppercase tracking-[0.24em] text-outline">Admin Directory</p>
            <h1 className="mt-3 page-title">Users</h1>
            <p className="page-lead mt-2 max-w-2xl">
              Create accounts, set access levels, disable access, and retire users without losing
              their historical records.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,180px)_auto]">
            <div className="rounded-2xl border border-outline-variant/10 bg-surface-container px-5 py-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-outline">Total Users</p>
              <p className="mt-3 text-3xl font-semibold text-on-surface">{data?.total ?? 0}</p>
              <p className="mt-1 text-xs text-on-surface-variant">Accounts currently indexed</p>
            </div>

            <Button
              variant="secondary"
              size="lg"
              onClick={() =>
                setEditorState((current) => (current?.mode === 'create' ? null : { mode: 'create' }))
              }
              leftIcon={
                <span className="material-symbols-outlined text-[18px]">
                  {editorState?.mode === 'create' ? 'close' : 'person_add'}
                </span>
              }
              className="min-h-[88px] min-w-[196px] justify-start border-outline-variant/20 bg-surface-container-high px-5 text-left text-on-surface hover:bg-surface-container-highest"
            >
              {editorState?.mode === 'create' ? 'Close Create' : 'Create User'}
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="w-full max-w-md">
            <Input
              placeholder="Search by name, email, or username..."
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              leftIcon={<span className="material-symbols-outlined text-sm">search</span>}
              className="h-11 bg-surface-container"
            />
          </div>

          <div className="scrollbar-none -mx-1 overflow-x-auto px-1">
            <div className="flex min-w-max items-center gap-1 rounded-xl bg-surface-container p-1">
              {ROLE_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => {
                    setRoleFilter(tab.value);
                    setPage(1);
                  }}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                    roleFilter === tab.value
                      ? 'bg-surface-container-high text-on-surface shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {editorState ? (
        <UserEditorCard
          key={editorState.mode === 'create' ? 'create-user' : editorState.user.id}
          editorState={editorState}
          loading={createMutation.isPending || updateMutation.isPending}
          onCancel={() => setEditorState(null)}
          onSubmit={handleEditorSubmit}
        />
      ) : null}

      <div className="overflow-hidden rounded-xl bg-surface-container-low">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Queries</TableHead>
              <TableHead>Solved</TableHead>
              <TableHead>Points</TableHead>
              <TableHead>Last Active</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={5} cols={8} />
            ) : displayUsers.length === 0 ? (
              <TableEmpty message="No users found" colSpan={8} />
            ) : (
              displayUsers.map((user) => {
                const managedRole = getManagedRole(user);
                const managedStatus = getManagedStatus(user);

                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-outline-variant bg-surface-container-highest text-xs font-bold font-headline text-on-surface">
                          {generateInitials(user.displayName ?? user.username)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-on-surface">
                            {user.displayName ?? user.username}
                          </p>
                          <p className="truncate text-xs text-on-surface-variant">{user.email}</p>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_STYLES[managedRole]}`}
                      >
                        {ROLE_LABELS[managedRole]}
                      </span>
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant={
                          managedStatus === 'active'
                            ? 'active'
                            : managedStatus === 'disabled'
                              ? 'archived'
                              : 'pending'
                        }
                        dot
                      >
                        {managedStatus}
                      </Badge>
                    </TableCell>

                    <TableCell className="font-mono text-xs text-on-surface-variant">
                      {user.stats?.queriesRun?.toLocaleString() ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-on-surface-variant">
                      {user.stats?.completedChallenges ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-on-surface-variant">
                      {user.stats?.totalPoints?.toLocaleString() ?? '—'}
                    </TableCell>

                    <TableCell className="text-xs text-on-surface-variant">
                      {user.lastLoginAt ? formatDate(user.lastLoginAt) : '—'}
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditorState({ mode: 'edit', user })}
                          title="Edit user"
                        >
                          <span className="material-symbols-outlined text-sm">edit</span>
                        </Button>

                        {managedStatus === 'disabled' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => enableMutation.mutate(user.id)}
                            loading={enableMutation.isPending && enableMutation.variables === user.id}
                            title="Enable user"
                          >
                            <span className="material-symbols-outlined text-sm text-secondary">check_circle</span>
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => disableMutation.mutate(user.id)}
                            loading={disableMutation.isPending && disableMutation.variables === user.id}
                            title="Disable user"
                          >
                            <span className="material-symbols-outlined text-sm text-error">block</span>
                          </Button>
                        )}

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setUserPendingDelete(user)}
                          loading={deleteMutation.isPending && deleteMutation.variables === user.id}
                          title="Delete user"
                        >
                          <span className="material-symbols-outlined text-sm text-error">delete</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {(data?.totalPages ?? 1) > 1 ? (
          <div className="flex items-center justify-between bg-surface-container/30 px-5 py-3">
            <p className="text-xs text-on-surface-variant">
              Page {page} of {data?.totalPages}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={page === (data?.totalPages ?? 1)}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <ConfirmModal
        open={userPendingDelete !== null}
        eyebrow="Admin"
        title="Delete user?"
        description={
          userPendingDelete
            ? `Soft delete ${userPendingDelete.displayName ?? userPendingDelete.username}? This disables sign-in and anonymizes the account, but keeps historical records.`
            : ''
        }
        confirmLabel="Delete user"
        cancelLabel="Cancel"
        icon="delete_forever"
        isPending={
          Boolean(userPendingDelete) &&
          deleteMutation.isPending &&
          deleteMutation.variables === userPendingDelete?.id
        }
        onCancel={() => setUserPendingDelete(null)}
        onConfirm={() => {
          if (!userPendingDelete) return;
          deleteMutation.mutate(userPendingDelete.id, {
            onSettled: () => setUserPendingDelete(null),
          });
        }}
        titleId="admin-delete-user-title"
      />
    </div>
  );
}
