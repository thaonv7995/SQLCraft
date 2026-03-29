'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usersApi, type InviteUserSearchItem } from '@/lib/api';
import { cn } from '@/lib/utils';

const MAX_INVITES = 100;

function labelFor(u: InviteUserSearchItem) {
  const primary = u.displayName?.trim() || u.username;
  return `${primary} (@${u.username})`;
}

type UserInviteMultiSelectProps = {
  value: InviteUserSearchItem[];
  onChange: (next: InviteUserSearchItem[]) => void;
  disabled?: boolean;
};

/**
 * Searchable multi-select of active users (for private database / challenge invites).
 */
export function UserInviteMultiSelect({ value, onChange, disabled }: UserInviteMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const searchQuery = debouncedQ.length >= 2 ? debouncedQ : undefined;

  const queryEnabled =
    open && !disabled && (debouncedQ.length === 0 || debouncedQ.length >= 2);

  const { data: candidates = [], isLoading, isFetching } = useQuery({
    queryKey: ['users-invite-search', searchQuery ?? ''],
    queryFn: () =>
      usersApi.searchForInvite({
        q: searchQuery,
        limit: 30,
      }),
    enabled: queryEnabled,
    staleTime: 20_000,
  });

  const selectedIds = new Set(value.map((u) => u.id));

  const toggle = (u: InviteUserSearchItem) => {
    if (selectedIds.has(u.id)) {
      onChange(value.filter((x) => x.id !== u.id));
      return;
    }
    if (value.length >= MAX_INVITES) {
      return;
    }
    onChange([...value, u]);
  };

  return (
    <div ref={rootRef} className="space-y-2">
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((u) => (
            <span
              key={u.id}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-outline-variant/30 bg-surface-container-high px-2 py-0.5 text-xs text-on-surface"
            >
              <span className="max-w-[220px] truncate">{labelFor(u)}</span>
              <button
                type="button"
                className="rounded p-0.5 text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
                onClick={() => onChange(value.filter((x) => x.id !== u.id))}
                disabled={disabled}
                aria-label={`Remove ${labelFor(u)}`}
              >
                <span className="material-symbols-outlined text-sm leading-none">close</span>
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="relative">
        <Button
          type="button"
          variant="secondary"
          size="md"
          className="h-9 w-full justify-between gap-2 sm:w-auto sm:min-w-[12rem]"
          onClick={() => !disabled && setOpen((o) => !o)}
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="listbox"
          leftIcon={
            <span className="flex min-w-0 items-center gap-2">
              <span className="material-symbols-outlined shrink-0 text-lg leading-none" aria-hidden>
                person_add
              </span>
              <span className="truncate">Add people</span>
            </span>
          }
          rightIcon={
            <span className="material-symbols-outlined shrink-0 text-lg leading-none text-on-surface-variant" aria-hidden>
              {open ? 'expand_less' : 'expand_more'}
            </span>
          }
        />

        {open ? (
          <div className="absolute left-0 top-full z-20 mt-1 w-full min-w-[min(100%,20rem)] max-w-lg rounded-lg border border-outline-variant/20 bg-surface-container-low p-2 shadow-lg sm:w-96">
            <Input
              label="Search by name or username"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Leave empty to browse, or type 2+ characters…"
              className="w-full"
              disabled={disabled}
            />
            {debouncedQ.length === 1 ? (
              <p className="mt-2 text-xs text-on-surface-variant">
                Type at least two characters to filter the list.
              </p>
            ) : null}

            <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-outline-variant/15">
              {debouncedQ.length === 1 ? (
                <p className="p-3 text-xs text-on-surface-variant">
                  Add one more letter to search, or clear the box to browse users.
                </p>
              ) : isLoading || isFetching ? (
                <p className="p-3 text-xs text-on-surface-variant">Loading…</p>
              ) : candidates.length === 0 ? (
                <p className="p-3 text-xs text-on-surface-variant">No users found.</p>
              ) : (
                <ul className="divide-y divide-outline-variant/10" role="listbox" aria-multiselectable>
                  {candidates.map((u) => {
                    const checked = selectedIds.has(u.id);
                    return (
                      <li key={u.id} role="option" aria-selected={checked}>
                        <label
                          className={cn(
                            'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-surface-container-high',
                            checked && 'bg-surface-container-high/80',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="size-4 shrink-0 rounded border-outline-variant accent-primary"
                            checked={checked}
                            onChange={() => toggle(u)}
                            disabled={disabled || (!checked && value.length >= MAX_INVITES)}
                          />
                          <span className="min-w-0 font-medium text-on-surface">{labelFor(u)}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <p className="mt-2 text-[10px] text-on-surface-variant">
              Up to {MAX_INVITES} people. Only active accounts are shown (you are never listed).
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
