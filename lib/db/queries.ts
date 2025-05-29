import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { desc, eq, and, gte, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import type {
  User,
  Suggestion,
  DBMessage,
  SystemPromptPreferences,
} from './schema';
import type { ArtifactKind } from '@/components/artifact';
import { generateUUID } from '../utils';
import { generateHashedPassword } from './utils';
import { logger } from '../utils/logger';

// Optionally, if not using email/pass login, you can
// use the Drizzle adapter for Auth.js / NextAuth
// https://authjs.dev/reference/adapter/drizzle

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function getUser(email: string): Promise<Array<User>> {
  const { data, error } = await supabase.from('User').select('*').eq('email', email);
  if (error) {
    logger.error('Failed to get user from database', error);
    throw error;
  }
  return data || [];
}

export async function createUser(email: string, password: string) {
  const hashedPassword = generateHashedPassword(password);
  const { data, error } = await supabase
    .from('User')
    .insert([{ 
      email, 
      password: hashedPassword,
      created_at: new Date(),
      updated_at: new Date()
    }]);
  if (error) {
    logger.error('Failed to create user in database', error);
    throw error;
  }
  return data;
}

export async function saveChat({ id, userId, title }: { id: string; userId: string; title: string; }) {
  const { data, error } = await supabase
    .from('Chat')
    .insert([{ 
      id, 
      createdAt: new Date(), 
      userId, 
      title,
      updated_at: new Date()
    }]);
  if (error) {
    logger.error('Failed to save chat in database', error);
    throw error;
  }
  return data;
}

export async function deleteChatById({ id }: { id: string }) {
  const { error: voteError } = await supabase.from('Vote_v2').delete().eq('chatId', id);
  if (voteError) {
    logger.error('Failed to delete votes by chat id', voteError);
    throw voteError;
  }
  const { error: messageError } = await supabase.from('Message_v2').delete().eq('chatId', id);
  if (messageError) {
    logger.error('Failed to delete messages by chat id', messageError);
    throw messageError;
  }
  const { data, error } = await supabase.from('Chat').delete().eq('id', id).select();
  if (error) {
    logger.error('Failed to delete chat by id from database', error);
    throw error;
  }
  return data?.[0];
}

export async function getChatsByUserId({ id, limit, startingAfter, endingBefore }: { id: string; limit: number; startingAfter: string | null; endingBefore: string | null; }) {
  const extendedLimit = limit + 1;
  let query = supabase.from('Chat').select('*').eq('userId', id).order('createdAt', { ascending: false }).limit(extendedLimit);
  if (startingAfter) {
    // For cursor-based pagination, you may need to fetch the createdAt of the startingAfter chat
    const { data: startChat, error: startError } = await supabase.from('Chat').select('createdAt').eq('id', startingAfter).single();
    if (startError || !startChat) throw new Error(`Chat with id ${startingAfter} not found`);
    query = query.gt('createdAt', startChat.createdAt);
  } else if (endingBefore) {
    const { data: endChat, error: endError } = await supabase.from('Chat').select('createdAt').eq('id', endingBefore).single();
    if (endError || !endChat) throw new Error(`Chat with id ${endingBefore} not found`);
    query = query.lt('createdAt', endChat.createdAt);
  }
  const { data, error } = await query;
  if (error) {
    logger.error('Failed to get chats by user from database', error);
    throw error;
  }
  const hasMore = (data?.length || 0) > limit;
  return {
    chats: hasMore ? data?.slice(0, limit) : data || [],
    hasMore,
  };
}

export async function getChatById({ id }: { id: string }) {
  const { data, error } = await supabase.from('Chat').select('*').eq('id', id).single();
  if (error) {
    if (error.code === 'PGRST116') {
      // No rows found
      return null;
    }
    logger.error('Failed to get chat by id from database', error);
    throw error;
  }
  return data;
}

export async function saveMessages({ messages }: { messages: Array<DBMessage>; }) {
  const { data, error } = await supabase.from('Message_v2').insert(messages);
  if (error) {
    logger.error('Failed to save messages in database', error);
    throw error;
  }
  return data;
}

export async function getMessagesByChatId({ id }: { id: string }) {
  const { data, error } = await supabase.from('Message_v2').select('*').eq('chatId', id).order('createdAt', { ascending: true });
  if (error) {
    logger.error('Failed to get messages by chat id from database', error);
    throw error;
  }
  return data || [];
}

export async function voteMessage({ chatId, messageId, type }: { chatId: string; messageId: string; type: 'up' | 'down'; }) {
  const { data: existingVote, error: voteError } = await supabase.from('Vote_v2').select('*').eq('messageId', messageId).eq('chatId', chatId).single();
  if (voteError && voteError.code !== 'PGRST116') { // PGRST116: No rows found
    throw voteError;
  }
  if (existingVote) {
    const { data, error } = await supabase.from('Vote_v2').update({ isUpvoted: type === 'up' }).eq('messageId', messageId).eq('chatId', chatId);
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase.from('Vote_v2').insert([{ chatId, messageId, isUpvoted: type === 'up' }]);
  if (error) throw error;
  return data;
}

export async function getVotesByChatId({ id }: { id: string }) {
  const { data, error } = await supabase.from('Vote_v2').select('*').eq('chatId', id);
  if (error) {
    logger.error('Failed to get votes by chat id from database', error);
    throw error;
  }
  return data || [];
}

export async function saveDocument({ id, title, kind, content, userId }: { id: string; title: string; kind: ArtifactKind; content: string; userId: string; }) {
  const { data, error } = await supabase.from('Document').insert([{ id, title, kind, content, userId, createdAt: new Date() }]);
  if (error) {
    logger.error('Failed to save document in database', error);
    throw error;
  }
  return data;
}

export async function getDocumentsById({ id }: { id: string }) {
  const { data, error } = await supabase.from('Document').select('*').eq('id', id).order('createdAt', { ascending: true });
  if (error) {
    logger.error('Failed to get documents by id from database', error);
    throw error;
  }
  return data || [];
}

export async function getDocumentById({ id }: { id: string }) {
  const { data, error } = await supabase.from('Document').select('*').eq('id', id).order('createdAt', { ascending: false }).single();
  if (error) {
    logger.error('Failed to get document by id from database', error);
    throw error;
  }
  return data;
}

export async function deleteDocumentsByIdAfterTimestamp({ id, timestamp }: { id: string; timestamp: Date; }) {
  const { error: suggestionError } = await supabase.from('Suggestion').delete().eq('documentId', id).gt('documentCreatedAt', timestamp);
  if (suggestionError) {
    logger.error('Failed to delete suggestions by document id after timestamp', suggestionError);
    throw suggestionError;
  }
  const { data, error } = await supabase.from('Document').delete().eq('id', id).gt('createdAt', timestamp);
  if (error) {
    logger.error('Failed to delete documents by id after timestamp from database', error);
    throw error;
  }
  return data;
}

export async function saveSuggestions({ suggestions }: { suggestions: Array<Suggestion>; }) {
  const { data, error } = await supabase.from('Suggestion').insert(suggestions);
  if (error) {
    logger.error('Failed to save suggestions in database', error);
    throw error;
  }
  return data;
}

export async function getSuggestionsByDocumentId({ documentId }: { documentId: string; }) {
  const { data, error } = await supabase.from('Suggestion').select('*').eq('documentId', documentId);
  if (error) {
    logger.error('Failed to get suggestions by document id from database', error);
    throw error;
  }
  return data || [];
}

export async function getMessageById({ id }: { id: string }) {
  const { data, error } = await supabase.from('Message_v2').select('*').eq('id', id).single();
  if (error) {
    logger.error('Failed to get message by id from database', error);
    throw error;
  }
  return data;
}

export async function messageExists({ id }: { id: string }): Promise<boolean> {
  const { data, error } = await supabase.from('Message_v2').select('id').eq('id', id).single();
  if (error) {
    // If error code is PGRST116, it means no rows found (message doesn't exist)
    if (error.code === 'PGRST116') {
      return false;
    }
    logger.error('Failed to check if message exists in database', error);
    throw error;
  }
  return !!data;
}

export async function deleteMessagesByChatIdAfterTimestamp({ chatId, timestamp }: { chatId: string; timestamp: Date; }) {
  const { data: messagesToDelete, error: selectError } = await supabase.from('Message_v2').select('id').eq('chatId', chatId).gte('createdAt', timestamp);
  if (selectError) {
    logger.error('Failed to select messages for deletion', selectError);
    throw selectError;
  }
  const messageIds = (messagesToDelete || []).map((message) => message.id);
  if (messageIds.length > 0) {
    const { error: voteError } = await supabase.from('Vote_v2').delete().eq('chatId', chatId).in('messageId', messageIds);
    if (voteError) {
      logger.error('Failed to delete votes for messages', voteError);
      throw voteError;
    }
    const { data, error } = await supabase.from('Message_v2').delete().eq('chatId', chatId).in('id', messageIds);
    if (error) {
      logger.error('Failed to delete messages', error);
      throw error;
    }
    return data;
  }
  return [];
}

export async function updateChatVisiblityById({ chatId, visibility }: { chatId: string; visibility: 'private' | 'public'; }) {
  const { data, error } = await supabase.from('Chat').update({ visibility }).eq('id', chatId);
  if (error) {
    logger.error('Failed to update chat visibility in database', error);
    throw error;
  }
  return data;
}

export async function getMessageCountByUserId({ id, differenceInHours }: { id: string; differenceInHours: number }) {
  const twentyFourHoursAgo = new Date(Date.now() - differenceInHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from('Message_v2').select('id', { count: 'exact' }).eq('role', 'user').gte('createdAt', twentyFourHoursAgo);
  if (error) {
    logger.error('Failed to get message count by user id', error);
    throw error;
  }
  return data?.length || 0;
}

export async function findOrCreateAzureADUser(email: string) {
  try {
    // First try to find the user by email
    const { data: existingUsers, error: findError } = await supabase
      .from('User')
      .select('*')
      .eq('email', email);
    
    if (findError) {
      logger.error('Failed to find user in database', findError);
      throw findError;
    }
    
    // If user exists, return it
    if (existingUsers && existingUsers.length > 0) {
      logger.log(`Found existing user with email ${email}`);
      return existingUsers[0];
    }
    
    // If user doesn't exist, create a new one without password (SSO user)
    logger.log(`Creating new user for email ${email}`);
    const now = new Date();
    const { data: newUsers, error: createError } = await supabase
      .from('User')
      .insert([{ 
        email,
        created_at: now,
        updated_at: now
      }])
      .select('*');
    
    if (createError) {
      logger.error('Failed to create user in database', createError);
      throw createError;
    }
    
    if (!newUsers || newUsers.length === 0) {
      throw new Error('Failed to create user: No user returned from database');
    }
    
    return newUsers[0];
  } catch (error) {
    logger.error('Error in findOrCreateAzureADUser:', error);
    throw error;
  }
}

export async function createStreamId({ chatId }: { chatId: string }) {
  try {
    const streamId = generateUUID();
    const { data, error } = await supabase
      .from('Stream')
      .insert([{ 
        id: streamId, 
        chatId, 
        createdAt: new Date() 
      }]);
    if (error) {
      logger.error('Failed to create stream id in database', error);
      // If the error is because the table doesn't exist, just return the generated ID
      if (error.code === '42P01') { // PostgreSQL code for "relation does not exist"
        logger.log('Stream table does not exist yet, returning generated ID without saving');
        return streamId;
      }
      throw error;
    }
    return streamId;
  } catch (error) {
    logger.error('Error in createStreamId:', error);
    // Return a newly generated UUID as a fallback to prevent app crashing
    return generateUUID();
  }
}

export async function getStreamIdsByChatId({ id }: { id: string }) {
  try {
    // Check if id is valid
    if (!id || id === "undefined") {
      logger.log('Invalid chatId provided to getStreamIdsByChatId:', id);
      return [];
    }
    
    const { data, error } = await supabase
      .from('Stream')
      .select('id')
      .eq('chatId', id)
      .order('createdAt', { ascending: true });
    if (error) {
      logger.error('Failed to get stream ids by chat id from database', error);
      // If the error is because the table doesn't exist, return an empty array
      if (error.code === '42P01') { // PostgreSQL code for "relation does not exist"
        logger.log('Stream table does not exist yet, returning empty array');
        return [];
      }
      throw error;
    }
    return data?.map(stream => stream.id) || [];
  } catch (error) {
    logger.error('Error in getStreamIdsByChatId:', error);
    // Return an empty array as a fallback to prevent app crashing
    return [];
  }
}

// System Prompt Preferences functions
export async function getSystemPromptPreferences({ userId }: { userId: string }): Promise<SystemPromptPreferences | null> {
  const { data, error } = await supabase
    .from('SystemPromptPreferences')
    .select('*')
    .eq('userId', userId)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      // No rows found - return null to indicate no preferences set
      return null;
    }
    logger.error('Failed to get system prompt preferences from database', error);
    throw error;
  }
  
  return data;
}

export async function createSystemPromptPreferences({ 
  userId, 
  preferences 
}: { 
  userId: string; 
  preferences: Partial<Omit<SystemPromptPreferences, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>; 
}): Promise<SystemPromptPreferences> {
  const now = new Date();
  const { data, error } = await supabase
    .from('SystemPromptPreferences')
    .insert([{
      userId,
      ...preferences,
      createdAt: now,
      updatedAt: now,
    }])
    .select('*')
    .single();
  
  if (error) {
    logger.error('Failed to create system prompt preferences in database', error);
    throw error;
  }
  
  return data;
}

export async function updateSystemPromptPreferences({ 
  userId, 
  preferences 
}: { 
  userId: string; 
  preferences: Partial<Omit<SystemPromptPreferences, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>; 
}): Promise<SystemPromptPreferences> {
  const { data, error } = await supabase
    .from('SystemPromptPreferences')
    .update({
      ...preferences,
      updatedAt: new Date(),
    })
    .eq('userId', userId)
    .select('*')
    .single();
  
  if (error) {
    logger.error('Failed to update system prompt preferences in database', error);
    throw error;
  }
  
  return data;
}

export async function getOrCreateSystemPromptPreferences({ userId }: { userId: string }): Promise<SystemPromptPreferences> {
  const existing = await getSystemPromptPreferences({ userId });
  
  if (existing) {
    return existing;
  }
  
  // Create with default values
  return await createSystemPromptPreferences({ 
    userId, 
    preferences: {
      isOutlookAssistant: false,
      includeCancelledEvents: false,
      includeTentativeEvents: true,
      includePrivateEvents: false,
      showEventDetails: true,
      requireDraftConfirmation: true,
      autoSuggestMeetingTimes: true,
      includeEmailSignature: true,
      prioritizeInternalEmails: false,
      requireMeetingConfirmation: true,
      suggestMeetingRooms: true,
      addDefaultMeetingDuration: true,
      includeTeamsLink: true,
      createFollowUpTasks: false,
      suggestPriorities: true,
      trackDeadlines: true,
      formalTone: false,
      includeGreetings: true,
      useActiveVoice: true,
      defaultMeetingDuration: '30',
    }
  });
}
