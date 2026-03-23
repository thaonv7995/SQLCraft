import { AdminPlaceholderPage } from '@/components/admin/admin-placeholder-page';

export default function AdminSettingsPage() {
  return (
    <AdminPlaceholderPage
      title="Admin Settings"
      description="Centralize deployment defaults, operator safeguards, and notification rules for privileged workflows."
      icon="settings"
      highlights={[
        { label: 'Focus', value: 'Operator controls' },
        { label: 'Primary Flow', value: 'Runtime defaults' },
        { label: 'Next Step', value: 'Policy configuration' },
      ]}
      primaryHref="/admin"
      primaryLabel="Back to Overview"
      secondaryHref="/admin/health"
      secondaryLabel="Open System Health"
      note="This route replaces the previous dead sidebar link so the admin shell remains navigable while settings are still being designed."
    />
  );
}
