import { redirect } from 'next/navigation';

export default function AdminLessonsPage() {
  redirect('/admin/content?tab=lessons');
}
