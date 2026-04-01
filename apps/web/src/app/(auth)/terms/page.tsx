import Link from 'next/link';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-sm text-on-surface-variant hover:text-on-surface transition-colors mb-6"
          >
            <span className="material-symbols-outlined text-base">arrow_back</span>
            Back
          </Link>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-surface-container-high border border-outline-variant flex items-center justify-center">
              <span className="material-symbols-outlined text-xl text-on-surface">database</span>
            </div>
            <h1 className="font-headline text-2xl font-semibold text-on-surface tracking-tight">
              Terms of Service
            </h1>
          </div>
          <p className="text-sm text-on-surface-variant">Last updated: April 2026</p>
        </div>

        {/* Content */}
        <div className="bg-surface-container-low rounded-xl p-8 shadow-2xl shadow-black/40 space-y-8 text-sm text-on-surface-variant leading-relaxed">
          <section>
            <h2 className="font-headline text-base font-semibold text-on-surface mb-3">1. Acceptance of Terms</h2>
            <p>
              By accessing or using SQLCraft, you agree to be bound by these Terms of Service. If you do not agree to these terms, you may not use the platform. These terms apply to all users, including learners, contributors, and administrators.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-base font-semibold text-on-surface mb-3">2. Use of the Platform</h2>
            <p className="mb-3">
              SQLCraft is an educational platform for learning and practicing SQL. You agree to use it only for lawful purposes and in a manner that does not infringe the rights of others.
            </p>
            <ul className="space-y-2 list-none">
              {[
                'You must not attempt to gain unauthorized access to any part of the platform.',
                'You must not use the platform to distribute harmful, offensive, or illegal content.',
                'You must not attempt to disrupt, overload, or impair the platform\'s infrastructure.',
                'Each account is for individual use only and may not be shared.',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-sm text-primary mt-0.5 shrink-0">check_circle</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-headline text-base font-semibold text-on-surface mb-3">3. Accounts and Security</h2>
            <p>
              You are responsible for maintaining the confidentiality of your account credentials. You agree to notify your administrator immediately upon becoming aware of any unauthorized use of your account. SQLCraft is not liable for any loss or damage arising from unauthorized access due to your failure to protect your credentials.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-base font-semibold text-on-surface mb-3">4. Sandbox Environments</h2>
            <p>
              SQLCraft provides isolated sandbox database environments for practice. These environments are temporary and may be reset or removed at any time. Do not store sensitive or production data in sandbox environments. SQLCraft is not responsible for any data loss within sandbox instances.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-base font-semibold text-on-surface mb-3">5. Intellectual Property</h2>
            <p>
              All content on the platform, including challenges, datasets, documentation, and interface elements, is the property of SQLCraft or its licensors. You may not reproduce, distribute, or create derivative works without prior written permission.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-base font-semibold text-on-surface mb-3">6. Limitation of Liability</h2>
            <p>
              SQLCraft is provided &quot;as is&quot; without warranty of any kind. To the fullest extent permitted by law, SQLCraft shall not be liable for any indirect, incidental, or consequential damages arising from your use of the platform.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-base font-semibold text-on-surface mb-3">7. Changes to Terms</h2>
            <p>
              We reserve the right to update these terms at any time. Continued use of the platform after changes constitutes acceptance of the updated terms. We will endeavor to notify users of material changes.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-base font-semibold text-on-surface mb-3">8. Contact</h2>
            <p>
              If you have any questions regarding these terms, please contact your platform administrator.
            </p>
          </section>
        </div>

        <p className="text-center text-xs text-outline mt-6">
          <Link href="/privacy" className="hover:text-on-surface-variant transition-colors">Privacy Policy</Link>
          {' '}·{' '}
          <Link href="/login" className="hover:text-on-surface-variant transition-colors">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
