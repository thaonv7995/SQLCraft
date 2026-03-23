import { AdminPlaceholderPage } from '@/components/admin/admin-placeholder-page';

export default function AdminSchemaPage() {
  return (
    <AdminPlaceholderPage
      title="Schema Management"
      description="Coordinate dataset models, relationship integrity, and rollout readiness before learner-facing publication."
      icon="schema"
      highlights={[
        { label: 'Focus', value: 'Model governance' },
        { label: 'Primary Flow', value: 'Review schema revisions' },
        { label: 'Next Step', value: 'Connect dataset publishing' },
      ]}
      primaryHref="/admin/content"
      primaryLabel="Open Content Operations"
      secondaryHref="/admin/health/logs"
      secondaryLabel="Review Audit Logs"
      note="The current docs emphasize admin content operations and auditability. This shell keeps the sidebar route live until schema workflows are wired to the backend."
    />
  );
}
