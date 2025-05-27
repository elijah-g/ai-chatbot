// DEPRECATED: This file is no longer used for migrations or queries. Supabase manages schema via its dashboard or CLI.
// Type definitions may be kept for reference if used elsewhere in the codebase.
// Remove Drizzle-specific imports if not needed.
import type { InferSelectModel } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  timestamp,
  json,
  uuid,
  text,
  primaryKey,
  foreignKey,
  boolean,
} from 'drizzle-orm/pg-core';

export const user = pgTable('User', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  email: varchar('email', { length: 64 }).notNull(),
  password: varchar('password', { length: 64 }),
});

export type User = InferSelectModel<typeof user>;

export const chat = pgTable('Chat', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  createdAt: timestamp('createdAt').notNull(),
  title: text('title').notNull(),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),
  visibility: varchar('visibility', { enum: ['public', 'private'] })
    .notNull()
    .default('private'),
});

export type Chat = InferSelectModel<typeof chat>;

// DEPRECATED: The following schema is deprecated and will be removed in the future.
// Read the migration guide at https://github.com/vercel/ai-chatbot/blob/main/docs/04-migrate-to-parts.md
export const messageDeprecated = pgTable('Message', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  chatId: uuid('chatId')
    .notNull()
    .references(() => chat.id),
  role: varchar('role').notNull(),
  content: json('content').notNull(),
  createdAt: timestamp('createdAt').notNull(),
});

export type MessageDeprecated = InferSelectModel<typeof messageDeprecated>;

export const message = pgTable('Message_v2', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  chatId: uuid('chatId')
    .notNull()
    .references(() => chat.id),
  role: varchar('role').notNull(),
  parts: json('parts').notNull(),
  attachments: json('attachments').notNull(),
  createdAt: timestamp('createdAt').notNull(),
});

export type DBMessage = InferSelectModel<typeof message>;

// DEPRECATED: The following schema is deprecated and will be removed in the future.
// Read the migration guide at https://github.com/vercel/ai-chatbot/blob/main/docs/04-migrate-to-parts.md
export const voteDeprecated = pgTable(
  'Vote',
  {
    chatId: uuid('chatId')
      .notNull()
      .references(() => chat.id),
    messageId: uuid('messageId')
      .notNull()
      .references(() => messageDeprecated.id),
    isUpvoted: boolean('isUpvoted').notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.chatId, table.messageId] }),
    };
  },
);

export type VoteDeprecated = InferSelectModel<typeof voteDeprecated>;

export const vote = pgTable(
  'Vote_v2',
  {
    chatId: uuid('chatId')
      .notNull()
      .references(() => chat.id),
    messageId: uuid('messageId')
      .notNull()
      .references(() => message.id),
    isUpvoted: boolean('isUpvoted').notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.chatId, table.messageId] }),
    };
  },
);

export type Vote = InferSelectModel<typeof vote>;

export const document = pgTable(
  'Document',
  {
    id: uuid('id').notNull().defaultRandom(),
    createdAt: timestamp('createdAt').notNull(),
    title: text('title').notNull(),
    content: text('content'),
    kind: varchar('text', { enum: ['text', 'code', 'image', 'sheet'] })
      .notNull()
      .default('text'),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.id, table.createdAt] }),
    };
  },
);

export type Document = InferSelectModel<typeof document>;

export const suggestion = pgTable(
  'Suggestion',
  {
    id: uuid('id').notNull().defaultRandom(),
    documentId: uuid('documentId').notNull(),
    documentCreatedAt: timestamp('documentCreatedAt').notNull(),
    originalText: text('originalText').notNull(),
    suggestedText: text('suggestedText').notNull(),
    description: text('description'),
    isResolved: boolean('isResolved').notNull().default(false),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('createdAt').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id] }),
    documentRef: foreignKey({
      columns: [table.documentId, table.documentCreatedAt],
      foreignColumns: [document.id, document.createdAt],
    }),
  }),
);

export type Suggestion = InferSelectModel<typeof suggestion>;

export const stream = pgTable(
  'Stream',
  {
    id: uuid('id').notNull().defaultRandom(),
    chatId: uuid('chatId').notNull(),
    createdAt: timestamp('createdAt').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id] }),
    chatRef: foreignKey({
      columns: [table.chatId],
      foreignColumns: [chat.id],
    }),
  }),
);

export type Stream = InferSelectModel<typeof stream>;

export const systemPromptPreferences = pgTable('SystemPromptPreferences', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id)
    .unique(),
  
  // Outlook/Organization Assistant Configuration
  isOutlookAssistant: boolean('isOutlookAssistant').notNull().default(false),
  
  // Calendar behavior preferences
  includeCancelledEvents: boolean('includeCancelledEvents').notNull().default(false),
  includeTentativeEvents: boolean('includeTentativeEvents').notNull().default(true),
  includePrivateEvents: boolean('includePrivateEvents').notNull().default(false),
  showEventDetails: boolean('showEventDetails').notNull().default(true),
  
  // Email behavior preferences
  requireDraftConfirmation: boolean('requireDraftConfirmation').notNull().default(true),
  autoSuggestMeetingTimes: boolean('autoSuggestMeetingTimes').notNull().default(true),
  includeEmailSignature: boolean('includeEmailSignature').notNull().default(true),
  prioritizeInternalEmails: boolean('prioritizeInternalEmails').notNull().default(false),
  
  // Meeting behavior preferences
  requireMeetingConfirmation: boolean('requireMeetingConfirmation').notNull().default(true),
  suggestMeetingRooms: boolean('suggestMeetingRooms').notNull().default(true),
  addDefaultMeetingDuration: boolean('addDefaultMeetingDuration').notNull().default(true),
  includeTeamsLink: boolean('includeTeamsLink').notNull().default(true),
  
  // Task and productivity preferences
  createFollowUpTasks: boolean('createFollowUpTasks').notNull().default(false),
  suggestPriorities: boolean('suggestPriorities').notNull().default(true),
  trackDeadlines: boolean('trackDeadlines').notNull().default(true),
  
  // Communication style preferences
  formalTone: boolean('formalTone').notNull().default(false),
  includeGreetings: boolean('includeGreetings').notNull().default(true),
  useActiveVoice: boolean('useActiveVoice').notNull().default(true),
  useBritishEnglish: boolean('useBritishEnglish').notNull().default(true),
  useEmoji: boolean('useEmoji').notNull().default(false),
  verbosityLevel: varchar('verbosityLevel', { enum: ['concise', 'balanced', 'detailed'] }).notNull().default('balanced'),
  useHumor: boolean('useHumor').notNull().default(false),
  useAcademicStyle: boolean('useAcademicStyle').notNull().default(false),
  
  // Custom text fields
  customInstructions: text('customInstructions'),
  emailSignature: text('emailSignature'),
  organizationContext: text('organizationContext'),
  defaultMeetingDuration: varchar('defaultMeetingDuration', { length: 10 }).default('30'),
  
  // Timestamps
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
});

export type SystemPromptPreferences = InferSelectModel<typeof systemPromptPreferences>;
