-- DEPRECATED: This migration file is no longer used. Supabase manages migrations via its dashboard or CLI.
ALTER TABLE "Document" ADD COLUMN "text" varchar DEFAULT 'text' NOT NULL;