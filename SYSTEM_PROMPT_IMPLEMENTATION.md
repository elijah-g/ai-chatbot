# System Prompt Implementation - Outlook/Organization Assistant

## Overview

This implementation adds a comprehensive system prompt configuration system specifically designed for an Outlook/organization assistant. Users can configure various behavioral preferences through checkboxes and text fields, which are then used to customize the AI assistant's behavior.

## Features Implemented

### 1. Database Schema
- **Table**: `SystemPromptPreferences`
- **Location**: `lib/db/schema.ts`
- **Features**:
  - User-specific preferences with foreign key to User table
  - Boolean flags for various behaviors
  - Text fields for custom instructions and signatures
  - Automatic timestamps with update triggers

### 2. Database Queries
- **Location**: `lib/db/queries.ts`
- **Functions**:
  - `getSystemPromptPreferences()` - Fetch user preferences
  - `createSystemPromptPreferences()` - Create new preferences
  - `updateSystemPromptPreferences()` - Update existing preferences
  - `getOrCreateSystemPromptPreferences()` - Helper function with defaults

### 3. System Prompt Logic
- **Location**: `lib/ai/prompts.ts`
- **Features**:
  - `outlookAssistantPrompt()` - Generates dynamic system prompt based on user preferences
  - Updated `systemPrompt()` function to use user preferences
  - Conditional prompt sections based on user settings

### 4. UI Components
- **Main Component**: `components/system-prompt-settings.tsx`
- **Features**:
  - Comprehensive settings interface with organized cards
  - Checkbox controls for boolean preferences
  - Text areas for custom instructions and signatures
  - Real-time preview of settings
  - Save/load functionality with loading states

### 5. API Endpoints
- **Location**: `app/(chat)/api/system-prompt-preferences/route.ts`
- **Methods**:
  - `GET` - Retrieve user preferences
  - `POST` - Create or update preferences
  - Authentication and error handling

### 6. Settings Page
- **Location**: `app/(chat)/settings/page.tsx`
- **Features**:
  - Protected route requiring authentication
  - Clean interface for system prompt configuration

### 7. Navigation Integration
- **Location**: `components/sidebar-user-nav.tsx`
- **Features**:
  - Added "System Prompt Settings" option to user dropdown menu
  - Direct navigation to settings page

## Configuration Categories

### Assistant Mode
- **Enable Outlook/Organization Assistant Mode**: Master toggle that activates all specialized features

### Calendar Management
- Include cancelled events when reviewing calendar
- Include tentative events when reviewing calendar
- Include private events when reviewing calendar
- Show detailed event information including attendees, location, and agenda

### Email Management
- Always provide a draft for user confirmation before sending emails
- Automatically suggest meeting times when scheduling
- Include email signature in drafts
- Prioritize internal company emails over external communications
- Custom email signature field

### Meeting Management
- Always provide meeting details for user confirmation before creating
- Suggest appropriate meeting rooms based on attendee count and requirements
- Use default meeting duration (configurable in minutes)
- Include Microsoft Teams link for virtual meetings

### Task & Productivity
- Automatically create follow-up tasks from meeting notes and email conversations
- Suggest priority levels for tasks and meetings based on context
- Actively track and remind about upcoming deadlines

### Communication Style
- Use formal, professional language vs. friendly, approachable tone
- Include appropriate greetings and closings in emails and messages
- Use active voice in all written communications

### Custom Configuration
- **Organization Context**: Free text field for describing organization, team structure, processes
- **Custom Instructions**: Free text field for specific instructions or preferences

## Technical Implementation Details

### Database Integration
The system uses Supabase as the database backend. The `SystemPromptPreferences` table includes:
- Proper foreign key relationships
- Default values for all boolean preferences
- Automatic timestamp management
- Unique constraint on userId to prevent duplicates

### Prompt Generation
The system dynamically generates prompts based on user preferences:
```typescript
const basePrompt = userPreferences?.isOutlookAssistant 
  ? outlookAssistantPrompt(userPreferences)
  : regularPrompt;
```

### Error Handling
- Graceful fallback to default behavior if preferences can't be loaded
- Comprehensive error logging
- User-friendly error messages in the UI

### Performance Considerations
- Preferences are cached during chat sessions
- Database queries are optimized with proper indexing
- Minimal impact on chat response times

## Usage Instructions

### For Users
1. Click on your profile in the sidebar
2. Select "System Prompt Settings"
3. Toggle "Enable Outlook/Organization Assistant Mode"
4. Configure specific preferences using checkboxes and text fields
5. Add custom instructions and organization context
6. Save preferences

### For Developers
1. Run the SQL migration to create the database table:
   ```sql
   -- Execute the contents of create-system-prompt-preferences-table.sql
   ```
2. The system will automatically use user preferences in chat sessions
3. Preferences are fetched once per chat session for performance

## Example System Prompt Output

When a user enables Outlook assistant mode with specific preferences, the system generates a prompt like:

```
You are an intelligent Outlook and organization assistant designed to help users manage their email, calendar, meetings, and tasks efficiently. You have access to Microsoft 365 tools and should help users stay organized and productive.

**Calendar Management:**
- Exclude cancelled events from calendar reviews
- Include tentative events when reviewing calendar
- Exclude private events from calendar reviews
- Show detailed event information including attendees, location, and agenda

**Email Management:**
- Always provide a draft for user confirmation before sending emails
- Automatically suggest meeting times when scheduling
- Include email signature in drafts
- Treat all emails with equal priority
- Use this email signature: "Best regards, John Doe | Senior Manager | Acme Corp"

[... additional sections based on user preferences ...]
```

## Future Enhancements

### Potential Additions
1. **Template System**: Pre-defined preference templates for different roles
2. **Team Settings**: Organization-wide default preferences
3. **Advanced Scheduling**: Integration with calendar APIs for real-time availability
4. **Learning Mode**: AI learns from user corrections and adjusts preferences
5. **Export/Import**: Share preference configurations between users
6. **A/B Testing**: Test different prompt variations for effectiveness

### Integration Opportunities
1. **Microsoft Graph API**: Direct integration with Outlook, Teams, and SharePoint
2. **Calendar Sync**: Real-time calendar integration for better scheduling
3. **Email Templates**: Pre-built email templates based on organization needs
4. **Meeting Analytics**: Track meeting effectiveness and suggest improvements

## Security Considerations

- All preferences are user-specific and private
- Authentication required for all preference operations
- Input validation on all text fields
- SQL injection protection through parameterized queries
- XSS protection through proper input sanitization

## Testing

### Manual Testing Checklist
- [ ] Enable/disable Outlook assistant mode
- [ ] Configure various preference combinations
- [ ] Test custom instructions and organization context
- [ ] Verify preferences persist across sessions
- [ ] Test error handling with invalid inputs
- [ ] Verify authentication requirements

### Automated Testing
- Unit tests for preference validation
- Integration tests for database operations
- End-to-end tests for the complete user flow
- Performance tests for prompt generation

This implementation provides a solid foundation for a highly customizable Outlook/organization assistant that can adapt to different user needs and organizational contexts. 