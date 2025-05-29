const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

// Add timestamp utility function
const formatTimestamp = () => {
  return new Date().toISOString();
};

const timestampedLog = (...args) => {
  console.log(`[${formatTimestamp()}]`, ...args);
};

const timestampedError = (...args) => {
  console.error(`[${formatTimestamp()}]`, ...args);
};

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  timestampedError('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const createSystemPromptPreferencesTable = async () => {
  timestampedLog('Creating SystemPromptPreferences table...');
  
  try {
    // First, let's check if the table already exists
    const { data: existingTable, error: checkError } = await supabase
      .from('SystemPromptPreferences')
      .select('id')
      .limit(1);
    
    if (!checkError) {
      timestampedLog('✅ SystemPromptPreferences table already exists');
      return true;
    }
    
    // If table doesn't exist, we need to create it using a different approach
    timestampedLog('Table does not exist. Please create it manually in Supabase dashboard with the following SQL:');
    timestampedLog(`
CREATE TABLE "SystemPromptPreferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "userId" uuid NOT NULL REFERENCES "User"("id"),
  
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
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  
  -- Add unique constraint on userId
  UNIQUE("userId")
);

-- Create index on userId for faster lookups
CREATE INDEX "SystemPromptPreferences_userId_idx" ON "SystemPromptPreferences"("userId");

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
    `);
    
    return false;
  } catch (err) {
    timestampedError('Failed to check table existence:', err);
    return false;
  }
};

const testConnection = async () => {
  timestampedLog('Testing Supabase connection...');
  
  try {
    // Test connection by checking if User table exists
    const { data, error } = await supabase
      .from('User')
      .select('id')
      .limit(1);
    
    if (error) {
      timestampedError('Connection test failed:', error);
      return false;
    }
    
    timestampedLog('✅ Supabase connection successful');
    return true;
  } catch (err) {
    timestampedError('Failed to connect to Supabase:', err);
    return false;
  }
};

const main = async () => {
  timestampedLog('🚀 Starting SystemPromptPreferences table setup...\n');
  
  const connectionOk = await testConnection();
  if (!connectionOk) {
    timestampedError('❌ Failed to connect to Supabase. Check your environment variables.');
    process.exit(1);
  }
  
  const tableExists = await createSystemPromptPreferencesTable();
  if (tableExists) {
    timestampedLog('\n🎉 SystemPromptPreferences table is ready for use!');
    timestampedLog('You can now use the system prompt settings in your application.');
  } else {
    timestampedLog('\n📋 Please create the table manually in Supabase dashboard using the SQL above.');
    timestampedLog('After creating the table, the system prompt settings will be ready to use.');
  }
  
  process.exit(0);
};

main().catch((error) => {
  timestampedError('❌ Migration failed:', error);
  process.exit(1);
}); 