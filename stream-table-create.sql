-- Create the Stream table that matches the schema in schema.ts
CREATE TABLE IF NOT EXISTS "Stream" (
  "id" UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "chatId" UUID NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "Stream_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE
);

-- Create an index for faster queries
CREATE INDEX IF NOT EXISTS "Stream_chatId_idx" ON "Stream" ("chatId"); 