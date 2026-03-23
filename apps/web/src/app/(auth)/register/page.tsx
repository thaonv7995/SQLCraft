'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const registerSchema = z
  .object({
    displayName: z.string().min(2, 'Name must be at least 2 characters').max(50),
    username: z
      .string()
      .min(3, 'Username must be at least 3 characters')
      .max(30)
      .regex(/^[a-zA-Z0-9_]+$/, 'Only letters, numbers, and underscores'),
    email: z.string().email('Please enter a valid email address'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
      .regex(/[0-9]/, 'Must contain at least one number'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type RegisterFormData = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    watch,
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  const password = watch('password', '');
  const passwordStrength = getPasswordStrength(password);

  const onSubmit = async (data: RegisterFormData): Promise<void> => {
    try {
      const { user, tokens } = await authApi.register({
        username: data.username,
        email: data.email,
        password: data.password,
        displayName: data.displayName,
      });
      setAuth(user, tokens);
      toast.success('Account created! Welcome to SQLCraft.');
      router.push('/dashboard');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      toast.error(message);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      {/* Background gradient */}
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(186,195,255,0.04)_0%,_transparent_60%)] pointer-events-none" />

      <div className="w-full max-w-sm relative">
        {/* Logo + Brand */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-[#4453a7] flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary/20">
            <span className="material-symbols-outlined text-2xl text-[#00105b]">database</span>
          </div>
          <h1 className="font-headline text-xl font-bold text-on-surface uppercase tracking-widest">
            The Architectural Lab
          </h1>
          <p className="text-sm text-on-surface-variant mt-1">Create your account</p>
        </div>

        {/* Card */}
        <div className="bg-surface-container-low rounded-xl p-6 shadow-2xl shadow-black/40">
          <h2 className="font-headline text-lg font-semibold text-on-surface mb-6">
            Get started for free
          </h2>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <Input
              label="Display name"
              type="text"
              placeholder="John Doe"
              autoComplete="name"
              autoFocus
              error={errors.displayName?.message}
              leftIcon={<span className="material-symbols-outlined text-base">badge</span>}
              {...register('displayName')}
            />

            <Input
              label="Username"
              type="text"
              placeholder="johndoe_42"
              autoComplete="username"
              error={errors.username?.message}
              leftIcon={<span className="material-symbols-outlined text-base">alternate_email</span>}
              {...register('username')}
            />

            <Input
              label="Email address"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              error={errors.email?.message}
              leftIcon={<span className="material-symbols-outlined text-base">mail</span>}
              {...register('email')}
            />

            <div className="space-y-2">
              <Input
                label="Password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Create a strong password"
                autoComplete="new-password"
                error={errors.password?.message}
                leftIcon={<span className="material-symbols-outlined text-base">lock</span>}
                rightIcon={
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="pointer-events-auto text-outline hover:text-on-surface-variant transition-colors"
                    tabIndex={-1}
                  >
                    <span className="material-symbols-outlined text-base">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                }
                {...register('password')}
              />
              {password && (
                <PasswordStrengthBar strength={passwordStrength} />
              )}
            </div>

            <Input
              label="Confirm password"
              type={showPassword ? 'text' : 'password'}
              placeholder="Repeat your password"
              autoComplete="new-password"
              error={errors.confirmPassword?.message}
              leftIcon={<span className="material-symbols-outlined text-base">lock_clock</span>}
              {...register('confirmPassword')}
            />

            <Button
              type="submit"
              variant="primary"
              fullWidth
              loading={isSubmitting}
              size="md"
              className="mt-2"
            >
              {isSubmitting ? 'Creating account...' : 'Create Account'}
            </Button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-outline-variant/30" />
            <span className="text-xs text-outline">or</span>
            <div className="flex-1 h-px bg-outline-variant/30" />
          </div>

          <p className="text-center text-sm text-on-surface-variant">
            Already have an account?{' '}
            <Link href="/login" className="text-primary hover:text-primary/80 font-medium transition-colors">
              Sign in
            </Link>
          </p>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-outline mt-6">
          By creating an account, you agree to our{' '}
          <Link href="/terms" className="hover:text-on-surface-variant transition-colors">Terms</Link>
          {' '}and{' '}
          <Link href="/privacy" className="hover:text-on-surface-variant transition-colors">Privacy Policy</Link>
        </p>
      </div>
    </div>
  );
}

function getPasswordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
}

const strengthLabels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
const strengthColors = [
  '',
  'bg-error',
  'bg-[#f5b942]',
  'bg-tertiary',
  'bg-secondary',
];

function PasswordStrengthBar({ strength }: { strength: 0 | 1 | 2 | 3 | 4 }) {
  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((level) => (
          <div
            key={level}
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
              strength >= level ? strengthColors[strength] : 'bg-surface-container-highest'
            }`}
          />
        ))}
      </div>
      {strength > 0 && (
        <p className="text-xs text-on-surface-variant">
          Password strength:{' '}
          <span
            className={
              strength <= 1
                ? 'text-error'
                : strength === 2
                ? 'text-[#f5b942]'
                : strength === 3
                ? 'text-tertiary'
                : 'text-secondary'
            }
          >
            {strengthLabels[strength]}
          </span>
        </p>
      )}
    </div>
  );
}
