import { auth } from '@/app/(auth)/auth';
import {
  getSystemPromptPreferences,
  createSystemPromptPreferences,
  updateSystemPromptPreferences,
} from '@/lib/db/queries';
import type { SystemPromptPreferences } from '@/lib/db/schema';

export async function GET() {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return new Response('Unauthorized', { status: 401 });
    }

    const preferences = await getSystemPromptPreferences({ userId: session.user.id });
    
    return Response.json(preferences);
  } catch (error) {
    console.error('Failed to get system prompt preferences:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return new Response('Unauthorized', { status: 401 });
    }

    const body = await request.json();
    
    // Validate the request body
    if (!body || typeof body !== 'object') {
      return new Response('Invalid request body', { status: 400 });
    }

    // Check if preferences already exist
    const existingPreferences = await getSystemPromptPreferences({ userId: session.user.id });
    
    let savedPreferences: SystemPromptPreferences;
    
    if (existingPreferences) {
      // Update existing preferences
      savedPreferences = await updateSystemPromptPreferences({
        userId: session.user.id,
        preferences: body,
      });
    } else {
      // Create new preferences
      savedPreferences = await createSystemPromptPreferences({
        userId: session.user.id,
        preferences: body,
      });
    }

    return Response.json(savedPreferences);
  } catch (error) {
    console.error('Failed to save system prompt preferences:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
} 