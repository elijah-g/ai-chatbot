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
        'chat-model': bedrock('anthropic.claude-3-5-sonnet-20241022-v2:0'),
        'chat-model-reasoning': bedrock('anthropic.claude-3-5-haiku-20241022-v1:0'),
        'title-model': bedrock('anthropic.claude-3-5-sonnet-20241022-v2:0'),
        'artifact-model': bedrock('anthropic.claude-3-5-sonnet-20241022-v2:0'),
      },
      imageModels: {
        // No Claude 3.5 image model, so leave empty or add if needed
      },
    });
