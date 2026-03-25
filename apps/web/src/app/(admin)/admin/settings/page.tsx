import { redirect } from 'next/navigation';

export default function AdminSettingsRedirectPage() {
  redirect('/admin/system?tab=config');
}
