import Link from 'next/link';

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo + Brand */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-lg bg-surface-container-high border border-outline-variant flex items-center justify-center mx-auto mb-4">
            <span className="material-symbols-outlined text-2xl text-on-surface">database</span>
          </div>
          <h1 className="font-headline text-xl font-semibold text-on-surface tracking-tight">
            SQLCraft
          </h1>
        </div>

        {/* Card */}
        <div className="bg-surface-container-low rounded-xl p-6 shadow-2xl shadow-black/40">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-secondary-container mx-auto mb-4">
            <span className="material-symbols-outlined text-2xl text-on-secondary-container">lock_reset</span>
          </div>

          <h2 className="font-headline text-lg font-semibold text-on-surface mb-2 text-center">
            Forgot your password?
          </h2>

          <p className="text-sm text-on-surface-variant text-center mb-6">
            Password reset is managed by your administrator. Please reach out to them directly to regain access to your account.
          </p>

          <div className="bg-surface-container rounded-lg px-4 py-3 flex items-start gap-3 mb-6">
            <span className="material-symbols-outlined text-base text-on-surface-variant mt-0.5 shrink-0">info</span>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              If you&apos;re unsure who your admin is, check the invitation email you received when your account was created.
            </p>
          </div>

          <Link
            href="/login"
            className="flex items-center justify-center gap-2 w-full text-sm text-primary hover:text-primary/80 transition-colors font-medium"
          >
            <span className="material-symbols-outlined text-base">arrow_back</span>
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
