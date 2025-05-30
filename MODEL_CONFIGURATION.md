# Model Configuration

The AI chatbot now supports configurable model IDs through environment variables, allowing you to easily switch between different AI models without changing code.

## Environment Variables

Add these environment variables to your `.env.local` file:

### Required Model Configuration

```bash
# Primary chat model for general purpose conversations
MODEL_ID_CHAT=anthropic.claude-3-5-sonnet-20241022-v2:0

# Fast model for quick responses and reasoning tasks  
MODEL_ID_FAST=anthropic.claude-3-5-haiku-20241022-v1:0
```

## Model Usage

- **MODEL_ID_CHAT**: Used for the main chat model, title generation, and artifact creation
- **MODEL_ID_FAST**: Used for the reasoning model (chat-model-reasoning)

## Default Values

If environment variables are not set, the system will use these defaults:
- `MODEL_ID_CHAT`: `anthropic.claude-3-5-sonnet-20241022-v2:0` (Claude 3.5 Sonnet)
- `MODEL_ID_FAST`: `anthropic.claude-3-5-haiku-20241022-v1:0` (Claude 3.5 Haiku)

## Example Configuration

For a cost-optimized setup using faster models:
```bash
MODEL_ID_CHAT=anthropic.claude-3-5-haiku-20241022-v1:0
MODEL_ID_FAST=anthropic.claude-3-5-haiku-20241022-v1:0
```

For maximum quality:
```bash
MODEL_ID_CHAT=anthropic.claude-3-5-sonnet-20241022-v2:0
MODEL_ID_FAST=anthropic.claude-3-5-sonnet-20241022-v2:0
```

## Model Mapping

The environment variables map to these internal model IDs:
- `chat-model` → `MODEL_ID_CHAT`
- `chat-model-reasoning` → `MODEL_ID_FAST`
- `title-model` → `MODEL_ID_CHAT`
- `artifact-model` → `MODEL_ID_CHAT` 