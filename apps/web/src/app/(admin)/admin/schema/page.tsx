import { redirect } from 'next/navigation';

export default function AdminSchemaPage() {
  redirect('/admin/databases');
}
