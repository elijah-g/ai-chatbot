import { NextRequest, NextResponse } from 'next/server';
import { PollyClient, SynthesizeSpeechCommand, VoiceId } from '@aws-sdk/client-polly';
import { auth } from '@/app/(auth)/auth';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { text } = await request.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    // Check if Polly-specific credentials are configured
    if (!process.env.AWS_POLLY_ACCESS_KEY_ID || !process.env.AWS_POLLY_SECRET_ACCESS_KEY) {
      console.error('AWS Polly credentials not configured');
      return NextResponse.json({ error: 'Text-to-speech service not configured' }, { status: 503 });
    }

    // Initialize Polly client with dedicated credentials
    const pollyClient = new PollyClient({
      region: process.env.AWS_POLLY_REGION || process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_POLLY_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_POLLY_SECRET_ACCESS_KEY,
      },
    });

    // Create the speech synthesis command
    const command = new SynthesizeSpeechCommand({
      Text: text,
      OutputFormat: 'mp3',
      VoiceId: (process.env.AWS_POLLY_VOICE_ID as VoiceId) || VoiceId.Joanna, // Make voice configurable
      Engine: 'neural', // Use neural engine for better quality
    });

    // Execute the command
    const response = await pollyClient.send(command);

    if (!response.AudioStream) {
      return NextResponse.json({ error: 'Failed to generate audio' }, { status: 500 });
    }

    // Convert the audio stream to a buffer
    const audioBuffer = await streamToBuffer(response.AudioStream);

    // Return the audio as a response
    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.length.toString(),
      },
    });

  } catch (error) {
    console.error('Text-to-speech error:', error);
    return NextResponse.json(
      { error: 'Failed to generate speech' },
      { status: 500 }
    );
  }
}

// Helper function to convert AWS SDK stream to buffer
async function streamToBuffer(stream: any): Promise<Buffer> {
  // AWS SDK v3 streams can be converted to Uint8Array
  if (stream.transformToByteArray) {
    const uint8Array = await stream.transformToByteArray();
    return Buffer.from(uint8Array);
  }
  
  // Fallback for other stream types
  const chunks: Uint8Array[] = [];
  
  if (stream.getReader) {
    // Web ReadableStream
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  } else if (stream.on) {
    // Node.js Readable stream
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      
      stream.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
      
      stream.on('error', (error: Error) => {
        reject(error);
      });
    });
  } else {
    throw new Error('Unsupported stream type');
  }
  
  return Buffer.concat(chunks);
} 