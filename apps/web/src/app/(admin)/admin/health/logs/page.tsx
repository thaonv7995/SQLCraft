import { redirect } from 'next/navigation';

export default function AdminSystemLogsPage() {
  redirect('/admin/system?tab=logs');
}
