# AWS Setup for Text-to-Speech

This guide covers setting up AWS services for text-to-speech (Polly) functionality.

## Overview

The AI chatbot uses the following AWS services:

1. **AWS Polly** - For converting text to speech

## Prerequisites

1. AWS Account with appropriate permissions
2. AWS CLI installed and configured (optional)
3. Environment variables configured

## Setup Instructions

### 1. AWS Account Setup

1. Create an AWS account if you don't have one
2. Create an IAM user with programmatic access
3. Attach the following policies to the user:
   - `AmazonPollyFullAccess` (or create a custom policy with minimal required permissions)

### 2. Get AWS Credentials

1. In the AWS Console, go to IAM > Users
2. Select your user and go to "Security credentials"
3. Create a new access key
4. Save the Access Key ID and Secret Access Key

### 3. Environment Variables

Create a `.env.local` file in your project root with the following variables:

```env
# AWS Polly Configuration
AWS_POLLY_ACCESS_KEY_ID=your_access_key_id
AWS_POLLY_SECRET_ACCESS_KEY=your_secret_access_key
AWS_POLLY_REGION=us-east-1
```

### 4. Test the Setup

1. **Test Text-to-Speech**: Use the speaker icon next to messages to hear them read aloud

## Troubleshooting

### Common Issues

1. **403 Forbidden Error**: Check that your IAM user has the correct permissions
2. **Region Issues**: Ensure the region in your environment variables matches your AWS setup
3. **Credential Issues**: Verify your access keys are correct and active

### AWS Polly Limits

- **Character Limit**: 3,000 characters per request
- **Rate Limits**: Varies by region, typically 100 requests per second

## Security Best Practices

1. **Use IAM Roles**: In production, use IAM roles instead of access keys
2. **Minimal Permissions**: Only grant the minimum required permissions
3. **Rotate Keys**: Regularly rotate your access keys
4. **Environment Variables**: Never commit credentials to version control

## Cost Optimization

- **AWS Polly**: Pay per character synthesized
- **Free Tier**: 5 million characters per month for the first 12 months

## Support

For AWS-specific issues, refer to the [AWS Documentation](https://docs.aws.amazon.com/) or contact AWS Support. 