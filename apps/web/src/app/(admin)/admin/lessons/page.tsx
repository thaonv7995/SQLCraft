import { AdminPlaceholderPage } from '@/components/admin/admin-placeholder-page';

export default function AdminLessonsPage() {
  return (
    <AdminPlaceholderPage
      title="Lesson Management"
      description="Sequence lessons, verify attached challenges, and prepare release batches for learner tracks."
      icon="menu_book"
      highlights={[
        { label: 'Focus', value: 'Publishing workflow' },
        { label: 'Primary Flow', value: 'Track-level lesson review' },
        { label: 'Next Step', value: 'Versioned lesson editor' },
      ]}
      primaryHref="/admin/content"
      primaryLabel="Review Content Queue"
      secondaryHref="/admin/users"
      secondaryLabel="Check Contributors"
      note="Contributor documentation and the admin content screen both point to track-centric editing. This route now stays consistent with the sidebar while the dedicated lesson workflow is still being built."
    />
  );
}
