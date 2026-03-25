import { redirect } from 'next/navigation';

export default function AdminSchemaPage() {
  redirect('/admin/databases?tab=schema-templates');
}
