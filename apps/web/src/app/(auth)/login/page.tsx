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

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData): Promise<void> => {
    try {
      const { user, tokens } = await authApi.login(data);
      const hydratedUser = await authApi.me(tokens.accessToken).catch(() => user);
      setAuth(hydratedUser, tokens);
      toast.success('Welcome back!');
      router.push('/dashboard');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid credentials';
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
          <p className="text-sm text-on-surface-variant mt-1">Sign in to continue</p>
        </div>

        {/* Card */}
        <div className="bg-surface-container-low rounded-xl p-6 shadow-2xl shadow-black/40">
          <h2 className="font-headline text-lg font-semibold text-on-surface mb-6">
            Welcome back
          </h2>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <Input
              label="Email address"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
              error={errors.email?.message}
              leftIcon={
                <span className="material-symbols-outlined text-base">mail</span>
              }
              {...register('email')}
            />

            <Input
              label="Password"
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter your password"
              autoComplete="current-password"
              error={errors.password?.message}
              leftIcon={
                <span className="material-symbols-outlined text-base">lock</span>
              }
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

            <div className="flex items-center justify-end">
              <Link
                href="/forgot-password"
                className="text-xs text-primary hover:text-primary/80 transition-colors"
              >
                Forgot password?
              </Link>
            </div>

            <Button
              type="submit"
              variant="primary"
              fullWidth
              loading={isSubmitting}
              size="md"
            >
              {isSubmitting ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-outline-variant/30" />
            <span className="text-xs text-outline">or</span>
            <div className="flex-1 h-px bg-outline-variant/30" />
          </div>

          <p className="text-center text-sm text-on-surface-variant">
            Don&apos;t have an account?{' '}
            <Link href="/register" className="text-primary hover:text-primary/80 font-medium transition-colors">
              Create one
            </Link>
          </p>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-outline mt-6">
          By signing in, you agree to our{' '}
          <Link href="/terms" className="hover:text-on-surface-variant transition-colors">Terms</Link>
          {' '}and{' '}
          <Link href="/privacy" className="hover:text-on-surface-variant transition-colors">Privacy Policy</Link>
        </p>
      </div>
    </div>
  );
}
