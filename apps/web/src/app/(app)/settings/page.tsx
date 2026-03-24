'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { toastError } from '@/lib/toast-error';
import { usersApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/stores/auth';
import { generateInitials } from '@/lib/utils';

const profileSchema = z.object({
  displayName: z.string().min(2, 'Name must be at least 2 characters').max(100),
  bio: z.string().max(500, 'Bio must be 500 characters or less').optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

export default function SettingsPage() {
  const router = useRouter();
  const { user, clearAuth, isAuthenticated, updateUser } = useAuthStore();
  const authed = isAuthenticated();
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: user?.displayName ?? '',
      bio: user?.bio ?? '',
    },
  });

  if (!authed || !user) {
    return (
      <div className="page-shell-narrow page-stack">
        <h1 className="page-title-lg">Settings</h1>
        <p className="page-lead">Sign in to manage your account.</p>
        <Link href="/login">
          <Button variant="primary">Sign In</Button>
        </Link>
      </div>
    );
  }

  const initials = generateInitials(user.displayName ?? user.username);

  const onSaveProfile = async (data: ProfileFormData): Promise<void> => {
    try {
      const updated = await usersApi.updateMe({
        displayName: data.displayName,
        bio: data.bio || undefined,
      });
      updateUser(updated);
      reset({ displayName: updated.displayName, bio: updated.bio ?? '' });
      setIsEditingProfile(false);
      toast.success('Profile updated');
    } catch (err) {
      toastError('Failed to update profile', err);
    }
  };

  return (
    <div className="page-shell-narrow page-stack">
      <div>
        <h1 className="page-title-lg">Settings</h1>
        <p className="page-lead mt-2">Account details and app preferences.</p>
      </div>

      {/* Profile section */}
      <section className="section-card card-padding">
        <div className="flex items-center justify-between">
          <h2 className="page-section-title">Profile</h2>
          {!isEditingProfile && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsEditingProfile(true)}
            >
              <span className="material-symbols-outlined text-sm mr-1">edit</span>
              Edit
            </Button>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              className="h-16 w-16 rounded-full border border-outline-variant object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-outline-variant bg-surface-container-high text-lg font-bold text-on-surface shrink-0">
              {initials}
            </div>
          )}
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium text-on-surface">{user.displayName ?? user.username}</p>
            <p className="text-sm text-on-surface-variant">{user.email}</p>
            <p className="text-xs text-on-surface-variant">
              @{user.username} ·{' '}
              <span className={`capitalize font-medium ${
                user.role === 'admin'
                  ? 'text-error'
                  : user.role === 'contributor'
                  ? 'text-primary'
                  : 'text-on-surface-variant'
              }`}>
                {user.role}
              </span>
            </p>
          </div>
        </div>

        {isEditingProfile ? (
          <form onSubmit={handleSubmit(onSaveProfile)} className="mt-5 space-y-4" noValidate>
            <Input
              label="Display name"
              type="text"
              error={errors.displayName?.message}
              leftIcon={<span className="material-symbols-outlined text-base">badge</span>}
              {...register('displayName')}
            />
            <div className="space-y-1">
              <label className="text-xs font-medium text-on-surface-variant uppercase tracking-wide">
                Bio
              </label>
              <textarea
                className="w-full rounded-xl border border-outline-variant bg-surface-container px-3 py-2 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                rows={3}
                placeholder="Tell others a bit about yourself..."
                {...register('bio')}
              />
              {errors.bio && (
                <p className="text-xs text-error">{errors.bio.message}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={isSubmitting}
                disabled={!isDirty}
              >
                Save changes
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  reset();
                  setIsEditingProfile(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          user.bio && (
            <p className="mt-4 text-sm text-on-surface leading-relaxed">{user.bio}</p>
          )
        )}
      </section>

      {/* Notifications */}
      <section className="section-card card-padding">
        <h2 className="page-section-title">Notifications</h2>
        <p className="mt-2 text-sm text-on-surface-variant">
          Email and push preferences are in progress. In-app toasts are currently supported.
        </p>
      </section>

      {/* Danger zone */}
      <section className="section-card border-error/20 bg-error/5 card-padding">
        <h2 className="page-section-title text-error">Session</h2>
        <p className="mt-2 text-sm text-on-surface-variant">
          Sign out from this device. You will need to sign in again to continue.
        </p>
        <Button
          variant="ghost"
          className="mt-4 text-error hover:bg-error/10"
          onClick={() => {
            clearAuth();
            router.push('/login');
          }}
        >
          Sign Out
        </Button>
      </section>

      <p className="text-center text-xs text-on-surface-variant">
        <Link href="/docs" className="underline-offset-2 hover:underline">
          Documentation
        </Link>
        {' · '}
        <Link href="/dashboard" className="underline-offset-2 hover:underline">
          Back to Dashboard
        </Link>
      </p>
    </div>
  );
}
