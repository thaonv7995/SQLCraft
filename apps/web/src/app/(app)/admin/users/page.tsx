'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '@/lib/api';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmpty,
  TableSkeleton,
} from '@/components/ui/table';
import { formatDate, generateInitials } from '@/lib/utils';
import type { User } from '@/lib/api';
import toast from 'react-hot-toast';

/** Extends the API User type with extra fields that may come from admin endpoint or mock data */
interface AdminUser extends User {
  isActive?: boolean;
}

const ROLE_TABS = [
  { value: 'all', label: 'All Users' },
  { value: 'student', label: 'Students' },
  { value: 'contributor', label: 'Contributors' },
  { value: 'admin', label: 'Admins' },
];

const MOCK_USERS: AdminUser[] = [
  { id: '1', username: 'alice_dev', email: 'alice@example.com', displayName: 'Alice Johnson', role: 'admin', createdAt: '2024-01-15T10:00:00Z', isActive: true, stats: { queriesRun: 2847, completedChallenges: 52, activeSessions: 0, currentStreak: 0, totalPoints: 0 } },
  { id: '2', username: 'bob_sql', email: 'bob@example.com', displayName: 'Bob Chen', role: 'contributor', createdAt: '2024-02-20T08:30:00Z', isActive: true, stats: { queriesRun: 1243, completedChallenges: 38, activeSessions: 0, currentStreak: 0, totalPoints: 0 } },
  { id: '3', username: 'carol_data', email: 'carol@example.com', displayName: 'Carol Martinez', role: 'student', createdAt: '2024-03-10T14:15:00Z', isActive: true, stats: { queriesRun: 567, completedChallenges: 14, activeSessions: 0, currentStreak: 0, totalPoints: 0 } },
  { id: '4', username: 'dave_query', email: 'dave@example.com', displayName: 'Dave Wilson', role: 'student', createdAt: '2024-04-05T11:45:00Z', isActive: false, stats: { queriesRun: 89, completedChallenges: 3, activeSessions: 0, currentStreak: 0, totalPoints: 0 } },
  { id: '5', username: 'eva_joins', email: 'eva@example.com', displayName: 'Eva Brown', role: 'student', createdAt: '2024-04-18T16:00:00Z', isActive: true, stats: { queriesRun: 342, completedChallenges: 21, activeSessions: 0, currentStreak: 0, totalPoints: 0 } },
];

const ROLE_COLORS: Record<string, string> = {
  admin: 'text-error bg-error/10 border-error/20',
  contributor: 'text-primary bg-primary/10 border-primary/20',
  student: 'text-on-surface-variant bg-surface-container-high border-outline-variant',
};

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [page, setPage] = useState(1);

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

  const roleChangeMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      usersApi.updateRole(userId, role),
    onSuccess: () => {
      toast.success('Role updated');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: () => toast.error('Failed to update role'),
  });

  const displayUsers: AdminUser[] = (data?.items as AdminUser[] | undefined) ?? MOCK_USERS;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-headline text-2xl font-bold text-on-surface">User Management</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            {data?.total ?? MOCK_USERS.length} total users
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          leftIcon={<span className="material-symbols-outlined text-sm">person_add</span>}
        >
          Invite User
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          placeholder="Search by name, email, or username..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          leftIcon={<span className="material-symbols-outlined text-sm">search</span>}
          className="max-w-sm"
        />

        <div className="flex items-center gap-1 bg-surface-container-low rounded-xl p-1">
          {ROLE_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setRoleFilter(tab.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                roleFilter === tab.value
                  ? 'bg-surface-container-high text-on-surface'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Users table */}
      <div className="bg-surface-container-low rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Queries</TableHead>
              <TableHead>Challenges</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={5} cols={7} />
            ) : displayUsers.length === 0 ? (
              <TableEmpty message="No users found" colSpan={7} />
            ) : (
              displayUsers.map((user) => {
                const isActive = user.isActive !== false;
                return (
                  <TableRow key={user.id}>
                    {/* User cell */}
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/60 to-[#4453a7]/60 flex items-center justify-center text-xs font-bold font-headline text-[#00105b] shrink-0">
                          {generateInitials(user.displayName ?? user.username)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-on-surface truncate">
                            {user.displayName ?? user.username}
                          </p>
                          <p className="text-xs text-on-surface-variant truncate">{user.email}</p>
                        </div>
                      </div>
                    </TableCell>

                    {/* Role */}
                    <TableCell>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                          ROLE_COLORS[user.role] ?? ROLE_COLORS.student
                        }`}
                      >
                        {user.role}
                      </span>
                    </TableCell>

                    {/* Status */}
                    <TableCell>
                      <StatusBadge status={isActive ? 'active' : 'archived'} />
                    </TableCell>

                    {/* Stats */}
                    <TableCell className="font-mono text-xs text-on-surface-variant">
                      {user.stats?.queriesRun?.toLocaleString() ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-on-surface-variant">
                      {user.stats?.completedChallenges ?? '—'}
                    </TableCell>

                    {/* Joined */}
                    <TableCell className="text-xs text-on-surface-variant">
                      {formatDate(user.createdAt)}
                    </TableCell>

                    {/* Actions */}
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const newRole = user.role === 'student'
                              ? 'contributor'
                              : user.role === 'contributor'
                              ? 'admin'
                              : 'student';
                            roleChangeMutation.mutate({ userId: user.id, role: newRole });
                          }}
                          title="Change role"
                        >
                          <span className="material-symbols-outlined text-sm">manage_accounts</span>
                        </Button>

                        {isActive ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => disableMutation.mutate(user.id)}
                            loading={disableMutation.isPending}
                            title="Disable user"
                          >
                            <span className="material-symbols-outlined text-sm text-error">block</span>
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => enableMutation.mutate(user.id)}
                            loading={enableMutation.isPending}
                            title="Enable user"
                          >
                            <span className="material-symbols-outlined text-sm text-secondary">check_circle</span>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        {(data?.totalPages ?? 1) > 1 && (
          <div className="flex items-center justify-between px-5 py-3 bg-surface-container/30">
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
        )}
      </div>
    </div>
  );
}
