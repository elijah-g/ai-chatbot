-- DEPRECATED: This migration file is no longer used. Supabase manages migrations via its dashboard or CLI.
ALTER TABLE "Chat" ADD COLUMN "visibility" varchar DEFAULT 'private' NOT NULL;