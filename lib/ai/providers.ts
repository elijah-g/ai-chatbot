import {
  customProvider,
} from 'ai';
import { bedrock } from '@ai-sdk/amazon-bedrock';
import { isTestEnvironment } from '../constants';
import {
  artifactModel,
  chatModel,
  reasoningModel,
  titleModel,
} from './models.test';

// Environment variables for configurable model IDs
const MODEL_ID_CHAT = process.env.MODEL_ID_CHAT || 'anthropic.claude-3-5-sonnet-20241022-v2:0';
const MODEL_ID_FAST = process.env.MODEL_ID_FAST || 'anthropic.claude-3-5-haiku-20241022-v1:0';

export const myProvider = isTestEnvironment
  ? customProvider({
      languageModels: {
        'chat-model': chatModel,
        'chat-model-reasoning': reasoningModel,
        'title-model': titleModel,
        'artifact-model': artifactModel,
      },
    })
  : customProvider({
      languageModels: {
        'chat-model': bedrock(MODEL_ID_CHAT),
        'chat-model-reasoning': bedrock(MODEL_ID_FAST),
        'title-model': bedrock(MODEL_ID_CHAT),
        'artifact-model': bedrock(MODEL_ID_CHAT),
      },
      imageModels: {
        // No Claude 3.5 image model, so leave empty or add if needed
      },
    });
