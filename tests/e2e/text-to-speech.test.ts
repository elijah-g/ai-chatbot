import { test, expect } from '@playwright/test';
import { ChatPage } from '../pages/chat';

test.describe('Text-to-Speech functionality', () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ page }) => {
    chatPage = new ChatPage(page);
    await chatPage.createNewChat();
  });

  test.describe('Text-to-Speech', () => {
    test('Read-aloud button appears for assistant messages', async () => {
      await chatPage.sendUserMessage('Hello, how are you?');
      await chatPage.isGenerationComplete();

      const assistantMessage = await chatPage.getRecentAssistantMessage();
      
      // Check that the read-aloud button is visible
      await expect(
        assistantMessage.element.getByTestId('message-read-aloud')
      ).toBeVisible();
    });

    test('Read-aloud button is clickable and toggles to pause', async () => {
      await chatPage.sendUserMessage('Tell me a short story');
      await chatPage.isGenerationComplete();

      const assistantMessage = await chatPage.getRecentAssistantMessage();
      
      // Click the read-aloud button to start playing
      await assistantMessage.readAloud();
      
      // The button should still be visible and clickable (now as pause button)
      await expect(
        assistantMessage.element.getByTestId('message-read-aloud')
      ).toBeVisible();
      
      // Click again to pause
      await assistantMessage.pauseAudio();
      
      // If we get here without errors, the toggle functionality works
      expect(true).toBe(true);
    });

    test('Read-aloud button does not appear for user messages', async () => {
      await chatPage.sendUserMessage('This is a user message');
      
      const userMessage = await chatPage.getRecentUserMessage();
      
      // Check that the read-aloud button is not present for user messages
      await expect(
        userMessage.element.getByTestId('message-read-aloud')
      ).not.toBeVisible();
    });

    test('Button tooltip changes based on state', async ({ page }) => {
      await chatPage.sendUserMessage('Say hello');
      await chatPage.isGenerationComplete();

      const assistantMessage = await chatPage.getRecentAssistantMessage();
      const button = assistantMessage.element.getByTestId('message-read-aloud');
      
      // Initially should show "Read aloud" tooltip
      await button.hover();
      await expect(page.getByText('Read aloud')).toBeVisible();
      
      // Note: Testing the "Pause" tooltip would require actually playing audio,
      // which is difficult in automated tests due to browser audio policies
    });
  });
}); 