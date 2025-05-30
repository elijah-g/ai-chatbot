# AWS Polly Text-to-Speech Setup

This document explains how to set up AWS Polly for the text-to-speech functionality in the AI chatbot.

## Prerequisites

1. An AWS account with access to Amazon Polly
2. AWS credentials (Access Key ID and Secret Access Key) specifically for Polly

## Setup Instructions

### 1. Create Dedicated AWS IAM User for Polly

For security best practices, create a dedicated IAM user specifically for Polly access:

1. Go to the AWS IAM console
2. Create a new user named something like `ai-chatbot-polly-user`
3. Create and attach the following minimal policy to the user:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "polly:SynthesizeSpeech"
            ],
            "Resource": "*"
        }
    ]
}
```

4. Generate access keys for this user and save them securely

### 2. Configure Environment Variables

Add the following environment variables to your `.env.local` file:

```bash
# AWS Polly Configuration for Text-to-Speech
AWS_POLLY_ACCESS_KEY_ID=your_polly_specific_access_key_id
AWS_POLLY_SECRET_ACCESS_KEY=your_polly_specific_secret_access_key
AWS_POLLY_REGION=us-east-1
AWS_POLLY_VOICE_ID=Joanna

# Optional: Fallback to general AWS region if Polly region not specified
AWS_REGION=us-east-1
```

### 3. Voice Configuration Options

You can customize the voice by setting the `AWS_POLLY_VOICE_ID` environment variable. Available options include:

#### Neural Voices (Recommended)
- **Joanna** (Female, US English) - Default
- **Matthew** (Male, US English)
- **Amy** (Female, British English)
- **Brian** (Male, British English)
- **Emma** (Female, British English)
- **Olivia** (Female, Australian English)

#### Standard Voices
- **Ivy** (Female, US English)
- **Justin** (Male, US English)
- **Kendra** (Female, US English)
- **Kimberly** (Female, US English)
- **Salli** (Female, US English)
- **Joey** (Male, US English)

### 4. Regional Configuration

You can specify a different AWS region for Polly by setting `AWS_POLLY_REGION`. If not set, it will fall back to `AWS_REGION`, and finally default to `us-east-1`.

Popular regions for Polly:
- `us-east-1` (N. Virginia) - Default, supports all voices
- `us-west-2` (Oregon)
- `eu-west-1` (Ireland)
- `ap-southeast-2` (Sydney)

## Usage

Once configured, users will see a speaker icon next to assistant messages. Clicking this button will:

1. Extract the text content from the message
2. Send it to AWS Polly for speech synthesis using your dedicated credentials
3. Play the generated audio in the browser

## Features

- **Dedicated Security**: Uses separate AWS credentials specifically for Polly
- **Neural Voice Engine**: Uses AWS Polly's neural engine for natural-sounding speech
- **Configurable Voice**: Choose from multiple voice options via environment variables
- **Regional Flexibility**: Configure specific region for Polly service
- **Loading States**: Shows loading and playing states in the UI
- **Error Handling**: Graceful error handling with user-friendly messages
- **Audio Management**: Automatically stops previous audio when starting new playback
- **Stream Handling**: Robust handling of AWS SDK v3 stream types

## Security Benefits

Using dedicated Polly credentials provides several security advantages:

1. **Principle of Least Privilege**: The credentials only have access to Polly's SynthesizeSpeech action
2. **Isolation**: Polly access is isolated from other AWS services
3. **Audit Trail**: Easier to track and monitor Polly usage specifically
4. **Credential Rotation**: Can rotate Polly credentials independently
5. **Cost Control**: Easier to monitor and control Polly-specific costs

## Troubleshooting

### Common Issues

1. **"Text-to-speech service not configured" Error**: 
   - Check that `AWS_POLLY_ACCESS_KEY_ID` and `AWS_POLLY_SECRET_ACCESS_KEY` are set
   - Verify the environment variables are loaded correctly

2. **"Unauthorized" Error**: 
   - Verify your AWS Polly user has the `polly:SynthesizeSpeech` permission
   - Check that the access key ID and secret access key are correct

3. **"Failed to generate speech" Error**: 
   - Verify the specified region supports the selected voice
   - Check AWS service status for Polly in your region

4. **Audio Not Playing**: 
   - Check browser permissions for audio playback
   - Verify the audio format (MP3) is supported by the browser

5. **Stream Processing Errors**:
   - The implementation handles multiple AWS SDK stream types automatically
   - If you see "stream.getReader is not a function" errors, this has been fixed in the latest version
   - The system now properly handles AWS SDK v3's `transformToByteArray()` method

### Technical Details

The text-to-speech implementation:
- Uses AWS SDK v3 for Polly integration
- Handles multiple stream types (Web ReadableStream, Node.js Readable, AWS SDK streams)
- Converts audio streams to MP3 format for browser compatibility
- Implements proper error handling and user feedback
- Uses TypeScript for type safety

### Testing the Setup

You can test the AWS Polly integration by:

1. Starting a conversation with the AI assistant
2. Looking for the speaker icon next to assistant responses
3. Clicking the speaker icon to hear the message read aloud

### Verifying Configuration

To verify your configuration is working:

1. Check the browser's developer console for any error messages
2. Monitor AWS CloudTrail logs for Polly API calls
3. Check AWS billing for Polly usage

## Cost Considerations

AWS Polly charges per character processed:
- **Neural voices**: $16.00 per 1 million characters
- **Standard voices**: $4.00 per 1 million characters

### Cost Optimization Tips

1. Monitor usage through AWS Cost Explorer
2. Set up billing alerts for unexpected usage
3. Consider using standard voices for cost savings if quality difference is acceptable
4. Implement client-side text length limits if needed

## Security Best Practices

1. **Store credentials securely** in environment variables, never in code
2. **Rotate access keys regularly** (every 90 days recommended)
3. **Monitor usage** through AWS CloudTrail and billing alerts
4. **Use IAM roles** instead of access keys when deploying to AWS infrastructure
5. **Implement rate limiting** to prevent abuse
6. **Validate input text** to prevent potential security issues 