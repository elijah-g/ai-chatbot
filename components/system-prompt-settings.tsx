'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/components/toast';
import { LoaderIcon } from '@/components/icons';
import type { SystemPromptPreferences } from '@/lib/db/schema';

interface SystemPromptSettingsProps {
  onClose?: () => void;
}

export function SystemPromptSettings({ onClose }: SystemPromptSettingsProps) {
  const { data: session } = useSession();
  const [preferences, setPreferences] = useState<Partial<SystemPromptPreferences>>({
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
    useBritishEnglish: true,
    useEmoji: false,
    verbosityLevel: 'balanced',
    useHumor: false,
    useAcademicStyle: false,
    defaultMeetingDuration: '30',
    customInstructions: '',
    emailSignature: '',
    organizationContext: '',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (session?.user?.id) {
      fetchPreferences();
    }
  }, [session?.user?.id]);

  const fetchPreferences = async () => {
    try {
      const response = await fetch('/api/system-prompt-preferences');
      if (response.ok) {
        const data = await response.json();
        if (data) {
          setPreferences(data);
        }
      }
    } catch (error) {
      console.error('Failed to fetch preferences:', error);
      toast({
        type: 'error',
        description: 'Failed to load preferences',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const savePreferences = async () => {
    if (!session?.user?.id) return;

    setIsSaving(true);
    try {
      const response = await fetch('/api/system-prompt-preferences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(preferences),
      });

      if (response.ok) {
        toast({
          type: 'success',
          description: 'Preferences saved successfully',
        });
        if (onClose) onClose();
      } else {
        throw new Error('Failed to save preferences');
      }
    } catch (error) {
      console.error('Failed to save preferences:', error);
      toast({
        type: 'error',
        description: 'Failed to save preferences',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const updatePreference = (key: keyof SystemPromptPreferences, value: boolean | string) => {
    setPreferences(prev => ({ ...prev, [key]: value }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin">
          <LoaderIcon />
        </div>
        <span className="ml-2">Loading preferences...</span>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">System Prompt Settings</h1>
          <p className="text-muted-foreground">
            Configure your AI assistant behaviour and preferences
          </p>
        </div>
        {onClose && (
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Assistant Mode</CardTitle>
          <CardDescription>
            Choose your primary assistant mode and behaviour
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="isOutlookAssistant"
              checked={preferences.isOutlookAssistant}
              onCheckedChange={(checked) => updatePreference('isOutlookAssistant', checked)}
            />
            <Label htmlFor="isOutlookAssistant" className="font-medium">
              Enable Outlook/Organization Assistant Mode
            </Label>
          </div>
          <p className="text-sm text-muted-foreground ml-6">
            Transforms the assistant into a specialised Outlook and productivity helper with advanced email, calendar, and meeting management capabilities.
          </p>
        </CardContent>
      </Card>

      {preferences.isOutlookAssistant && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Calendar Management</CardTitle>
              <CardDescription>
                Configure how the assistant handles calendar events and scheduling
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="includeCancelledEvents"
                    checked={preferences.includeCancelledEvents}
                    onCheckedChange={(checked) => updatePreference('includeCancelledEvents', checked)}
                  />
                  <Label htmlFor="includeCancelledEvents">Include cancelled events</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="includeTentativeEvents"
                    checked={preferences.includeTentativeEvents}
                    onCheckedChange={(checked) => updatePreference('includeTentativeEvents', checked)}
                  />
                  <Label htmlFor="includeTentativeEvents">Include tentative events</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="includePrivateEvents"
                    checked={preferences.includePrivateEvents}
                    onCheckedChange={(checked) => updatePreference('includePrivateEvents', checked)}
                  />
                  <Label htmlFor="includePrivateEvents">Include private events</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="showEventDetails"
                    checked={preferences.showEventDetails}
                    onCheckedChange={(checked) => updatePreference('showEventDetails', checked)}
                  />
                  <Label htmlFor="showEventDetails">Show detailed event information</Label>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Email Management</CardTitle>
              <CardDescription>
                Configure email drafting and sending behaviour
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="requireDraftConfirmation"
                    checked={preferences.requireDraftConfirmation}
                    onCheckedChange={(checked) => updatePreference('requireDraftConfirmation', checked)}
                  />
                  <Label htmlFor="requireDraftConfirmation">Always provide draft for confirmation</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="autoSuggestMeetingTimes"
                    checked={preferences.autoSuggestMeetingTimes}
                    onCheckedChange={(checked) => updatePreference('autoSuggestMeetingTimes', checked)}
                  />
                  <Label htmlFor="autoSuggestMeetingTimes">Auto-suggest meeting times</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="includeEmailSignature"
                    checked={preferences.includeEmailSignature}
                    onCheckedChange={(checked) => updatePreference('includeEmailSignature', checked)}
                  />
                  <Label htmlFor="includeEmailSignature">Include email signature</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="prioritizeInternalEmails"
                    checked={preferences.prioritizeInternalEmails}
                    onCheckedChange={(checked) => updatePreference('prioritizeInternalEmails', checked)}
                  />
                  <Label htmlFor="prioritizeInternalEmails">Prioritise internal emails</Label>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="emailSignature">Email Signature</Label>
                <Textarea
                  id="emailSignature"
                  placeholder="Enter your email signature..."
                  value={preferences.emailSignature || ''}
                  onChange={(e) => updatePreference('emailSignature', e.target.value)}
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Meeting Management</CardTitle>
              <CardDescription>
                Configure meeting creation and scheduling preferences
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="requireMeetingConfirmation"
                    checked={preferences.requireMeetingConfirmation}
                    onCheckedChange={(checked) => updatePreference('requireMeetingConfirmation', checked)}
                  />
                  <Label htmlFor="requireMeetingConfirmation">Require meeting confirmation</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="suggestMeetingRooms"
                    checked={preferences.suggestMeetingRooms}
                    onCheckedChange={(checked) => updatePreference('suggestMeetingRooms', checked)}
                  />
                  <Label htmlFor="suggestMeetingRooms">Suggest meeting rooms</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="addDefaultMeetingDuration"
                    checked={preferences.addDefaultMeetingDuration}
                    onCheckedChange={(checked) => updatePreference('addDefaultMeetingDuration', checked)}
                  />
                  <Label htmlFor="addDefaultMeetingDuration">Use default meeting duration</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="includeTeamsLink"
                    checked={preferences.includeTeamsLink}
                    onCheckedChange={(checked) => updatePreference('includeTeamsLink', checked)}
                  />
                  <Label htmlFor="includeTeamsLink">Include Teams link</Label>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="defaultMeetingDuration">Default Meeting Duration (minutes)</Label>
                <Input
                  id="defaultMeetingDuration"
                  type="number"
                  min="15"
                  max="480"
                  step="15"
                  value={preferences.defaultMeetingDuration || '30'}
                  onChange={(e) => updatePreference('defaultMeetingDuration', e.target.value)}
                  className="w-32"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Task & Productivity</CardTitle>
              <CardDescription>
                Configure task management and productivity features
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="createFollowUpTasks"
                    checked={preferences.createFollowUpTasks}
                    onCheckedChange={(checked) => updatePreference('createFollowUpTasks', checked)}
                  />
                  <Label htmlFor="createFollowUpTasks">Auto-create follow-up tasks</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="suggestPriorities"
                    checked={preferences.suggestPriorities}
                    onCheckedChange={(checked) => updatePreference('suggestPriorities', checked)}
                  />
                  <Label htmlFor="suggestPriorities">Suggest task priorities</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="trackDeadlines"
                    checked={preferences.trackDeadlines}
                    onCheckedChange={(checked) => updatePreference('trackDeadlines', checked)}
                  />
                  <Label htmlFor="trackDeadlines">Track deadlines</Label>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Communication Style</CardTitle>
              <CardDescription>
                Configure the assistant's communication tone and style
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="formalTone"
                    checked={preferences.formalTone}
                    onCheckedChange={(checked) => updatePreference('formalTone', checked)}
                  />
                  <Label htmlFor="formalTone">Use formal tone</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="includeGreetings"
                    checked={preferences.includeGreetings}
                    onCheckedChange={(checked) => updatePreference('includeGreetings', checked)}
                  />
                  <Label htmlFor="includeGreetings">Include greetings and closings</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="useActiveVoice"
                    checked={preferences.useActiveVoice}
                    onCheckedChange={(checked) => updatePreference('useActiveVoice', checked)}
                  />
                  <Label htmlFor="useActiveVoice">Use active voice</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="useBritishEnglish"
                    checked={preferences.useBritishEnglish}
                    onCheckedChange={(checked) => updatePreference('useBritishEnglish', checked)}
                  />
                  <Label htmlFor="useBritishEnglish">Use British English</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="useEmoji"
                    checked={preferences.useEmoji}
                    onCheckedChange={(checked) => updatePreference('useEmoji', checked)}
                  />
                  <Label htmlFor="useEmoji">Include emoji in responses</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="useHumor"
                    checked={preferences.useHumor}
                    onCheckedChange={(checked) => updatePreference('useHumor', checked)}
                  />
                  <Label htmlFor="useHumor">Use light humour when appropriate</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="useAcademicStyle"
                    checked={preferences.useAcademicStyle}
                    onCheckedChange={(checked) => updatePreference('useAcademicStyle', checked)}
                  />
                  <Label htmlFor="useAcademicStyle">Use academic writing style</Label>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="verbosityLevel">Response Length</Label>
                <select
                  id="verbosityLevel"
                  value={preferences.verbosityLevel}
                  onChange={(e) => updatePreference('verbosityLevel', e.target.value)}
                  className="w-full p-2 border rounded-md bg-background"
                >
                  <option value="concise">Concise - Brief and to the point</option>
                  <option value="balanced">Balanced - Moderate detail</option>
                  <option value="detailed">Detailed - Comprehensive explanations</option>
                </select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Custom Configuration</CardTitle>
              <CardDescription>
                Add custom instructions and organisation context
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="organizationContext">Organisation Context</Label>
                <Textarea
                  id="organizationContext"
                  placeholder="Describe your organisation, team structure, common processes, etc..."
                  value={preferences.organizationContext || ''}
                  onChange={(e) => updatePreference('organizationContext', e.target.value)}
                  rows={3}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="customInstructions">Custom Instructions</Label>
                <Textarea
                  id="customInstructions"
                  placeholder="Add any specific instructions or preferences for the assistant..."
                  value={preferences.customInstructions || ''}
                  onChange={(e) => updatePreference('customInstructions', e.target.value)}
                  rows={4}
                />
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <div className="flex justify-end space-x-2">
        <Button
          onClick={savePreferences}
          disabled={isSaving}
          className="min-w-24"
        >
          {isSaving ? (
            <>
              <div className="animate-spin mr-2">
                <LoaderIcon />
              </div>
              Saving...
            </>
          ) : (
            'Save Preferences'
          )}
        </Button>
      </div>
    </div>
  );
} 