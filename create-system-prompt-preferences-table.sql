-- Create SystemPromptPreferences table
CREATE TABLE IF NOT EXISTS "SystemPromptPreferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "userId" uuid NOT NULL REFERENCES "User"("id") UNIQUE,
  
  -- Outlook/Organization Assistant Configuration
  "isOutlookAssistant" boolean NOT NULL DEFAULT false,
  
  -- Calendar behavior preferences
  "includeCancelledEvents" boolean NOT NULL DEFAULT false,
  "includeTentativeEvents" boolean NOT NULL DEFAULT true,
  "includePrivateEvents" boolean NOT NULL DEFAULT false,
  "showEventDetails" boolean NOT NULL DEFAULT true,
  
  -- Email behavior preferences
  "requireDraftConfirmation" boolean NOT NULL DEFAULT true,
  "autoSuggestMeetingTimes" boolean NOT NULL DEFAULT true,
  "includeEmailSignature" boolean NOT NULL DEFAULT true,
  "prioritizeInternalEmails" boolean NOT NULL DEFAULT false,
  
  -- Meeting behavior preferences
  "requireMeetingConfirmation" boolean NOT NULL DEFAULT true,
  "suggestMeetingRooms" boolean NOT NULL DEFAULT true,
  "addDefaultMeetingDuration" boolean NOT NULL DEFAULT true,
  "includeTeamsLink" boolean NOT NULL DEFAULT true,
  
  -- Task and productivity preferences
  "createFollowUpTasks" boolean NOT NULL DEFAULT false,
  "suggestPriorities" boolean NOT NULL DEFAULT true,
  "trackDeadlines" boolean NOT NULL DEFAULT true,
  
  -- Communication style preferences
  "formalTone" boolean NOT NULL DEFAULT false,
  "includeGreetings" boolean NOT NULL DEFAULT true,
  "useActiveVoice" boolean NOT NULL DEFAULT true,
  
  -- Custom text fields
  "customInstructions" text,
  "emailSignature" text,
  "organizationContext" text,
  "defaultMeetingDuration" varchar(10) DEFAULT '30',
  
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

-- Create index on userId for faster lookups
CREATE INDEX IF NOT EXISTS "SystemPromptPreferences_userId_idx" ON "SystemPromptPreferences"("userId");

-- Create trigger to update updatedAt timestamp
CREATE OR REPLACE FUNCTION update_system_prompt_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_system_prompt_preferences_updated_at
  BEFORE UPDATE ON "SystemPromptPreferences"
  FOR EACH ROW
  EXECUTE FUNCTION update_system_prompt_preferences_updated_at(); 