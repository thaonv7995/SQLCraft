import { redirect } from 'next/navigation';

/** Canonical URL is under Challenges (authoring flow). */
export default function SettingsDatabasesRedirectPage() {
  redirect('/explore?import=1');
}
