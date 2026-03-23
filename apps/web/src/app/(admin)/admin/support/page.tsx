import { AdminPlaceholderPage } from '@/components/admin/admin-placeholder-page';

export default function AdminSupportPage() {
  return (
    <AdminPlaceholderPage
      title="Operator Support"
      description="Collect escalation paths, runbook entry points, and troubleshooting surfaces for administrators and maintainers."
      icon="help_outline"
      highlights={[
        { label: 'Focus', value: 'Escalation routing' },
        { label: 'Primary Flow', value: 'Runbook lookup' },
        { label: 'Next Step', value: 'Integrated support hub' },
      ]}
      primaryHref="/admin/health/logs"
      primaryLabel="Open System Logs"
      secondaryHref="/docs"
      secondaryLabel="View Docs"
      note="The sidebar support action now lands on a real page instead of a missing route. It also connects back to docs, which already exist in the main product navigation."
    />
  );
}
