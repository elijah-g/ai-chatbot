import { createClient } from '@supabase/supabase-js';
import { appendResponseMessages, UIMessage } from 'ai';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const BATCH_SIZE = 50;
const INSERT_BATCH_SIZE = 100;

type NewMessageInsert = {
  id: string;
  chatId: string;
  parts: any[];
  role: string;
  attachments: any[];
  createdAt: Date;
};

type NewVoteInsert = {
  messageId: string;
  chatId: string;
  isUpvoted: boolean;
};

async function createNewTable() {
  const { data: chats, error: chatError } = await supabase.from('Chat').select('*');
  if (chatError) throw chatError;
  let processedCount = 0;

  for (let i = 0; i < (chats?.length || 0); i += BATCH_SIZE) {
    const chatBatch = chats!.slice(i, i + BATCH_SIZE);
    const chatIds = chatBatch.map((chat) => chat.id);

    const { data: allMessages, error: msgError } = await supabase.from('Message').select('*').in('chatId', chatIds);
    if (msgError) throw msgError;
    const { data: allVotes, error: voteError } = await supabase.from('Vote').select('*').in('chatId', chatIds);
    if (voteError) throw voteError;

    const newMessagesToInsert = [];
    const newVotesToInsert = [];

    for (const chat of chatBatch) {
      processedCount++;
      console.info(`Processed ${processedCount}/${chats!.length} chats`);
      const messages = (allMessages || []).filter((msg) => msg.chatId === chat.id);
      const votes = (allVotes || []).filter((v) => v.chatId === chat.id);
      const messageSection = [];
      const messageSections = [];
      for (const message of messages) {
        const { role } = message;
        if (role === 'user' && messageSection.length > 0) {
          messageSections.push([...messageSection]);
          messageSection.length = 0;
        }
        messageSection.push(message);
      }
      if (messageSection.length > 0) messageSections.push([...messageSection]);
      for (const section of messageSections) {
        const [userMessage, ...assistantMessages] = section;
        const [firstAssistantMessage] = assistantMessages;
        try {
          const uiSection = appendResponseMessages({
            messages: [userMessage],
            responseMessages: assistantMessages,
            _internal: { currentDate: () => firstAssistantMessage?.createdAt ?? new Date() },
          });
          const projectedUISection = uiSection
            .map((message) => {
              if (message.role === 'user') {
                return {
                  id: message.id,
                  chatId: chat.id,
                  parts: [{ type: 'text', text: message.content }],
                  role: message.role,
                  createdAt: message.createdAt,
                  attachments: [],
                };
              } else if (message.role === 'assistant') {
                const cleanParts = sanitizeParts(
                  dedupeParts(message.parts || []),
                );

                return {
                  id: message.id,
                  chatId: chat.id,
                  parts: cleanParts,
                  role: message.role,
                  createdAt: message.createdAt,
                  attachments: [],
                };
              }
              return null;
            })
            .filter((msg) => msg !== null);
          for (const msg of projectedUISection) {
            newMessagesToInsert.push(msg);
            if (msg.role === 'assistant') {
              const voteByMessage = votes.find((v) => v.messageId === msg.id);
              if (voteByMessage) {
                newVotesToInsert.push({
                  messageId: msg.id,
                  chatId: msg.chatId,
                  isUpvoted: voteByMessage.isUpvoted,
                });
              }
            }
          }
        } catch (error) {
          console.error(`Error processing chat ${chat.id}: ${error}`);
        }
      }
    }
    for (let j = 0; j < newMessagesToInsert.length; j += INSERT_BATCH_SIZE) {
      const messageBatch = newMessagesToInsert.slice(j, j + INSERT_BATCH_SIZE);
      if (messageBatch.length > 0) {
        await supabase.from('Message_v2').insert(messageBatch);
      }
    }
    for (let j = 0; j < newVotesToInsert.length; j += INSERT_BATCH_SIZE) {
      const voteBatch = newVotesToInsert.slice(j, j + INSERT_BATCH_SIZE);
      if (voteBatch.length > 0) {
        await supabase.from('Vote_v2').insert(voteBatch);
      }
    }
  }
  console.info(`Migration completed: ${processedCount} chats processed`);
}

migrateMessages()
  .then(() => {
    console.info('Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
