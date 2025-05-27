import { auth } from '@/app/(auth)/auth';
import { SystemPromptSettings } from '@/components/system-prompt-settings';
import { redirect } from 'next/navigation';

export default async function SettingsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  return <SystemPromptSettings />;
} 