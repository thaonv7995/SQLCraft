'use client';

import { useRef, useState } from 'react';
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
import type { User } from '@/lib/api';
import { generateInitials } from '@/lib/utils';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const profileSchema = z.object({
  displayName: z.string().min(2, 'Name must be at least 2 characters').max(100),
  bio: z.string().max(500, 'Bio must be 500 characters or less').optional(),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'At least 8 characters')
      .regex(/[A-Z]/, 'Must contain an uppercase letter')
      .regex(/[0-9]/, 'Must contain a number'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type ProfileFormData = z.infer<typeof profileSchema>;
type PasswordFormData = z.infer<typeof passwordSchema>;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter();
  const { user, clearAuth, isAuthenticated, updateUser } = useAuthStore();
  const authed = isAuthenticated();

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

  return (
    <div className="page-shell-narrow page-stack">
      <div>
        <h1 className="page-title-lg">Settings</h1>
        <p className="page-lead mt-2">Account details and app preferences.</p>
      </div>

      <ProfileSection user={user} updateUser={updateUser} />
      <PasswordSection />
      <NotificationsSection />
      <DangerSection onSignOut={() => { clearAuth(); router.push('/login'); }} />

      <p className="text-center text-xs text-on-surface-variant">
        <Link href="/docs" className="underline-offset-2 hover:underline">Documentation</Link>
        {' · '}
        <Link href="/dashboard" className="underline-offset-2 hover:underline">Back to Dashboard</Link>
      </p>
    </div>
  );
}

// ─── Profile Section ─────────────────────────────────────────────────────────

function ProfileSection({
  user,
  updateUser,
}: {
  user: User;
  updateUser: (patch: Partial<User>) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: { displayName: user.displayName ?? '', bio: user.bio ?? '' },
  });

  const onSave = async (data: ProfileFormData) => {
    try {
      const updated = await usersApi.updateMe({ displayName: data.displayName, bio: data.bio || undefined });
      updateUser(updated);
      reset({ displayName: updated.displayName, bio: updated.bio ?? '' });
      setIsEditing(false);
      toast.success('Profile updated');
    } catch (err) {
      toastError('Failed to update profile', err);
    }
  };

  const onAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarLoading(true);
    try {
      const { avatarUrl } = await usersApi.uploadAvatar(file);
      updateUser({ avatarUrl });
      toast.success('Avatar updated');
    } catch (err) {
      toastError('Failed to upload avatar', err);
    } finally {
      setAvatarLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const initials = generateInitials(user.displayName ?? user.username);
  const isAdmin = user.role === 'admin' || (user.roles?.includes('admin') ?? false);
  const roleLabel = isAdmin ? 'Admin' : 'User';
  const roleClassName = isAdmin ? 'text-error' : 'text-on-surface-variant';

  return (
    <section className="section-card card-padding">
      <div className="flex items-center justify-between">
        <h2 className="page-section-title">Profile</h2>
        {!isEditing && (
          <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
            <span className="material-symbols-outlined text-sm mr-1">edit</span>Edit
          </Button>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
        {/* Avatar */}
        <div className="relative group shrink-0">
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- user-provided URL; arbitrary remote host
            <img
              src={user.avatarUrl}
              alt=""
              className="h-16 w-16 rounded-full border border-outline-variant object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-outline-variant bg-surface-container-high text-lg font-bold text-on-surface">
              {initials}
            </div>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={avatarLoading}
            className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Change avatar"
          >
            {avatarLoading ? (
              <span className="material-symbols-outlined text-white text-sm animate-spin">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-white text-sm">photo_camera</span>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={onAvatarChange}
          />
        </div>

        <div className="min-w-0 space-y-0.5">
          <p className="font-medium text-on-surface">{user.displayName ?? user.username}</p>
          <p className="text-sm text-on-surface-variant">{user.email}</p>
          <p className="text-xs text-on-surface-variant">
            @{user.username} ·{' '}
            <span className={`font-medium ${roleClassName}`}>{roleLabel}</span>
          </p>
        </div>
      </div>

      {isEditing ? (
        <form onSubmit={handleSubmit(onSave)} className="mt-5 space-y-4" noValidate>
          <Input
            label="Display name"
            type="text"
            error={errors.displayName?.message}
            leftIcon={<span className="material-symbols-outlined text-base">badge</span>}
            {...register('displayName')}
          />
          <div className="space-y-1">
            <label className="text-xs font-medium text-on-surface-variant uppercase tracking-wide">Bio</label>
            <textarea
              className="w-full rounded-xl border border-outline-variant bg-surface-container px-3 py-2 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
              rows={3}
              placeholder="Tell others a bit about yourself..."
              {...register('bio')}
            />
            {errors.bio && <p className="text-xs text-error">{errors.bio.message}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" size="sm" loading={isSubmitting} disabled={!isDirty}>
              Save changes
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { reset(); setIsEditing(false); }}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        user.bio && <p className="mt-4 text-sm text-on-surface leading-relaxed">{user.bio}</p>
      )}
    </section>
  );
}

// ─── Password Section ─────────────────────────────────────────────────────────

function PasswordSection() {
  const [isChanging, setIsChanging] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<PasswordFormData>({ resolver: zodResolver(passwordSchema) });

  const onSubmit = async (data: PasswordFormData) => {
    try {
      await usersApi.changePassword(data.currentPassword, data.newPassword);
      toast.success('Password changed successfully');
      reset();
      setIsChanging(false);
    } catch (err) {
      toastError('Failed to change password', err);
    }
  };

  return (
    <section className="section-card card-padding">
      <div className="flex items-center justify-between">
        <h2 className="page-section-title">Password</h2>
        {!isChanging && (
          <Button variant="ghost" size="sm" onClick={() => setIsChanging(true)}>
            <span className="material-symbols-outlined text-sm mr-1">lock_reset</span>Change
          </Button>
        )}
      </div>

      {isChanging ? (
        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4" noValidate>
          <Input
            label="Current password"
            type={showCurrent ? 'text' : 'password'}
            autoComplete="current-password"
            error={errors.currentPassword?.message}
            leftIcon={<span className="material-symbols-outlined text-base">lock</span>}
            rightIcon={
              <button type="button" onClick={() => setShowCurrent(!showCurrent)}
                className="pointer-events-auto text-outline hover:text-on-surface-variant transition-colors" tabIndex={-1}>
                <span className="material-symbols-outlined text-base">{showCurrent ? 'visibility_off' : 'visibility'}</span>
              </button>
            }
            {...register('currentPassword')}
          />
          <Input
            label="New password"
            type={showNew ? 'text' : 'password'}
            autoComplete="new-password"
            error={errors.newPassword?.message}
            leftIcon={<span className="material-symbols-outlined text-base">lock_open</span>}
            rightIcon={
              <button type="button" onClick={() => setShowNew(!showNew)}
                className="pointer-events-auto text-outline hover:text-on-surface-variant transition-colors" tabIndex={-1}>
                <span className="material-symbols-outlined text-base">{showNew ? 'visibility_off' : 'visibility'}</span>
              </button>
            }
            {...register('newPassword')}
          />
          <Input
            label="Confirm new password"
            type={showNew ? 'text' : 'password'}
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            leftIcon={<span className="material-symbols-outlined text-base">lock_clock</span>}
            {...register('confirmPassword')}
          />
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" size="sm" loading={isSubmitting}>
              Update password
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { reset(); setIsChanging(false); }}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-2 text-sm text-on-surface-variant">
          Keep your account secure with a strong password.
        </p>
      )}
    </section>
  );
}

// ─── Notifications Section ────────────────────────────────────────────────────

function NotificationsSection() {
  return (
    <section className="section-card card-padding">
      <h2 className="page-section-title">Notifications</h2>
      <p className="mt-2 text-sm text-on-surface-variant">
        Email and push preferences are in progress. In-app toasts are currently supported.
      </p>
    </section>
  );
}

// ─── Danger Section ───────────────────────────────────────────────────────────

function DangerSection({ onSignOut }: { onSignOut: () => void }) {
  return (
    <section className="section-card border-error/20 bg-error/5 card-padding">
      <h2 className="page-section-title text-error">Session</h2>
      <p className="mt-2 text-sm text-on-surface-variant">
        Sign out from this device. You will need to sign in again to continue.
      </p>
      <Button variant="ghost" className="mt-4 text-error hover:bg-error/10" onClick={onSignOut}>
        Sign Out
      </Button>
    </section>
  );
}
