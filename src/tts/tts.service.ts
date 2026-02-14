import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { createHash } from 'crypto';
import OpenAI from 'openai';
import { PrismaService } from '../prisma.service';
import { S3Service } from '../media/s3.service';
import { TtsVoice, TtsResponseDto } from './dto/tts.dto';

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly openai: OpenAI;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
  ) {
    const apiKey = process.env.TTS_API_KEY;
    if (!apiKey) {
      this.logger.warn('TTS_API_KEY not configured - TTS will not work');
    }
    this.openai = new OpenAI({ apiKey });
  }

  /**
   * Generate a SHA-256 hash of the text for caching
   */
  private hashText(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  /**
   * Generate TTS audio, with caching to avoid regenerating the same audio
   */
  async generateTts(text: string, voice: TtsVoice): Promise<TtsResponseDto> {
    const textHash = this.hashText(text);

    // Check cache first
    const cached = await this.prisma.ttsCache.findUnique({
      where: {
        textHash_voice: { textHash, voice },
      },
    });

    if (cached) {
      this.logger.log(`TTS cache hit for voice=${voice}, hash=${textHash.slice(0, 8)}...`);
      return {
        audioUrl: cached.audioUrl,
        cached: true,
      };
    }

    this.logger.log(`TTS cache miss - generating audio for voice=${voice}, hash=${textHash.slice(0, 8)}...`);

    try {
      // Call OpenAI TTS API
      const response = await this.openai.audio.speech.create({
        model: 'gpt-4o-mini-tts',
        voice: voice,
        input: text,
        response_format: 'mp3',
      });

      // Get the audio as a buffer
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Upload to S3
      const uploadResult = await this.s3Service.uploadBuffer(
        buffer,
        'tts-audio',
        'mp3',
        'audio/mpeg',
      );

      // Save to cache
      await this.prisma.ttsCache.create({
        data: {
          textHash,
          voice,
          text: text.slice(0, 500), // Store truncated text for debugging
          audioUrl: uploadResult.url,
          s3Key: uploadResult.key,
        },
      });

      this.logger.log(`TTS audio generated and cached: ${uploadResult.url}`);

      return {
        audioUrl: uploadResult.url,
        cached: false,
      };
    } catch (error) {
      this.logger.error('Failed to generate TTS audio', error);
      throw new InternalServerErrorException('Failed to generate TTS audio');
    }
  }
}
