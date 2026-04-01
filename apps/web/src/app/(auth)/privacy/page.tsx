import Link from 'next/link';

export default function PrivacyPage() {
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
              Privacy Policy
            </h1>
          </div>
          <p className="text-sm text-on-surface-variant">Last updated: April 2026</p>
        </div>

        {/* Content */}
        <div className="bg-surface-container-low rounded-xl p-8 shadow-2xl shadow-black/40 space-y-8 text-sm text-on-surface-variant leading-relaxed">
          <section>
            <h2 className="font-headline text-base font-semibold text-on-surface mb-3">1. Information We Collect</h2>
            <p className="mb-3">When you use SQLCraft, we collect the following types of information:</p>
            <ul className="space-y-2 list-none">
              {[
                { label: 'Account information', detail: 'email address, username, and password (stored as a secure hash).' },
                { label: 'Usage data', detail: 'SQL queries you submit, challenge attempts, session activity, and performance metrics.' },
                { label: 'Technical data', detail: 'IP address, browser type, and access timestamps for security and operational purposes.' },
              ].map(({ label, detail }) => (
                <li key={label} className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-sm text-primary mt-0.5 shrink-0">circle</span>
                  <span><strong className="text-on-surface">{label}</strong> — {detail}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-headline text-base font-semibold text-on-surface mb-3">2. How We Use Your Information</h2>
            <p className="mb-3">We use the information we collect to:</p>
            <ul className="space-y-2 list-none">
              {[
                'Provide, operate, and maintain the SQLCraft platform.',
                'Authenticate your identity and secure your account.',
                'Track your learning progress and display personalized statistics.',
                'Improve the quality of challenges, datasets, and platform features.',
                'Detect and prevent unauthorized access or abuse.',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-sm text-primary mt-0.5 shrink-0">check_circle</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-headline text-base font-semibold text-on-surface mb-3">3. Data Storage and Security</h2>
            <p>
              Your data is stored securely within the infrastructure managed by your platform administrator. Passwords are never stored in plain text. Access to your data is restricted to authorized personnel and automated systems required for platform operation. We use industry-standard practices to protect your information from unauthorized access.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-base font-semibold text-on-surface mb-3">4. Sandbox Data</h2>
            <p>
              SQL queries you run in sandbox environments are logged for purposes of challenge evaluation, debugging, and platform improvement. Sandbox environments are ephemeral — any data you load into them may be erased upon reset or expiry. Do not use sandbox environments to store personal or sensitive information.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-base font-semibold text-on-surface mb-3">5. Data Sharing</h2>
            <p>
              We do not sell or rent your personal information to third parties. Your data may be accessible to your organization&apos;s administrators for management and compliance purposes. We may disclose information if required by law or to protect the rights and safety of the platform and its users.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-base font-semibold text-on-surface mb-3">6. Cookies and Local Storage</h2>
            <p>
              SQLCraft uses browser local storage to maintain your authentication session. No third-party tracking cookies are used. Clearing your browser storage will sign you out of the platform.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-base font-semibold text-on-surface mb-3">7. Your Rights</h2>
            <p>
              You may request access to, correction of, or deletion of your personal data by contacting your platform administrator. Account deletion will remove your profile and progress data from the system.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-base font-semibold text-on-surface mb-3">8. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify users of significant changes. Continued use of the platform after updates constitutes your acceptance of the revised policy.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-base font-semibold text-on-surface mb-3">9. Contact</h2>
            <p>
              For questions or concerns about this Privacy Policy, please contact your platform administrator.
            </p>
          </section>
        </div>

        <p className="text-center text-xs text-outline mt-6">
          <Link href="/terms" className="hover:text-on-surface-variant transition-colors">Terms of Service</Link>
          {' '}·{' '}
          <Link href="/login" className="hover:text-on-surface-variant transition-colors">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
