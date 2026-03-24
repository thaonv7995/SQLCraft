import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Account details and application preferences for SQLCraft.',
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
