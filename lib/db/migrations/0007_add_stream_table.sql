-- Migration to create the Stream table
DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create the Stream table that matches the schema in schema.ts
CREATE TABLE IF NOT EXISTS "Stream" (
  "id" UUID PRIMARY KEY NOT NULL DEFAULT uuid_generate_v4(),
  "chatId" UUID NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "Stream_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE
);

-- Create an index for faster queries
CREATE INDEX IF NOT EXISTS "Stream_chatId_idx" ON "Stream" ("chatId"); 