import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from '../prisma.service';

@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);
  private readonly openai: OpenAI;

  constructor(private readonly prisma: PrismaService) {
    const apiKey = process.env.OPENAI_API_KEY || process.env.TTS_API_KEY;
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY not configured - Transcription will not work');
    }
    this.openai = new OpenAI({ apiKey });
  }

  /**
   * Transcribe audio using GPT-4o Transcribe with speaker diarization
   * @param audioUrl - URL of the audio file (S3 URL)
   * @param twilioCallSid - Twilio Call SID to update the call record
   */
  async transcribeRecording(audioUrl: string, twilioCallSid: string): Promise<string | null> {
    this.logger.log(`Starting transcription for call ${twilioCallSid}`);

    // Update status to processing
    await this.prisma.phoneCall.update({
      where: { twilioCallSid },
      data: { transcriptionStatus: 'processing' },
    });

    try {
      // Download the audio file from S3
      const response = await fetch(audioUrl);
      if (!response.ok) {
        throw new Error(`Failed to download audio: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      this.logger.log(`Downloaded audio for transcription: ${buffer.length} bytes`);

      // Create a File-like object for OpenAI API
      const file = new File([buffer], 'recording.mp3', { type: 'audio/mpeg' });

      // Call GPT-4o Transcribe Diarize API for speaker identification
      const transcriptionResult = await this.openai.audio.transcriptions.create({
        file: file,
        model: 'gpt-4o-transcribe-diarize',
        response_format: 'diarized_json',
        chunking_strategy: 'auto',
      } as any); // Type assertion needed for new model parameters

      this.logger.log(`Transcription completed for call ${twilioCallSid}`);

      // Process the result to extract speaker segments
      const timelineData = this.processTranscriptionWithSpeakers(transcriptionResult as any);
      const transcriptionJson = JSON.stringify(timelineData);

      // Update call record with transcription
      await this.prisma.phoneCall.update({
        where: { twilioCallSid },
        data: {
          transcription: transcriptionJson,
          transcriptionStatus: 'completed',
        },
      });

      return transcriptionJson;
    } catch (error) {
      this.logger.error(`Transcription failed for call ${twilioCallSid}: ${error.message}`);
      this.logger.error(`Error stack: ${error.stack}`);

      // Update status to failed
      await this.prisma.phoneCall.update({
        where: { twilioCallSid },
        data: { transcriptionStatus: 'failed' },
      });

      return null;
    }
  }

  /**
   * Process GPT-4o transcription result to extract speaker-labeled segments
   * diarized_json format returns segments with speaker field directly
   */
  private processTranscriptionWithSpeakers(result: {
    text: string;
    language?: string;
    duration?: number;
    segments?: Array<{
      id?: number;
      seek?: number;
      text: string;
      start: number;
      end: number;
      speaker?: string;
    }>;
  }): {
    text: string;
    duration: number;
    segments: Array<{ start: number; end: number; text: string; speaker: string }>;
  } {
    // diarized_json format includes segments with speaker info
    if (result.segments && result.segments.length > 0) {
      // Map speaker names to consistent format (Speaker 1, Speaker 2, etc.)
      const speakerMap = new Map<string, string>();
      let speakerCount = 0;

      const segments = result.segments.map((seg) => {
        let speakerLabel = seg.speaker || 'unknown';

        // Map speaker identifiers to consistent "Speaker N" format
        if (!speakerMap.has(speakerLabel)) {
          speakerCount++;
          speakerMap.set(speakerLabel, `Speaker ${speakerCount}`);
        }

        return {
          start: seg.start,
          end: seg.end,
          text: seg.text.trim(),
          speaker: speakerMap.get(speakerLabel) || 'Speaker 1',
        };
      });

      // Calculate duration from last segment if not provided
      const duration = result.duration || (segments.length > 0 ? segments[segments.length - 1].end : 0);

      return {
        text: result.text,
        duration,
        segments,
      };
    }

    // Fallback: single segment with full text (no diarization available)
    return {
      text: result.text || '',
      duration: result.duration || 0,
      segments: [
        {
          start: 0,
          end: result.duration || 0,
          text: result.text || '',
          speaker: 'Speaker 1',
        },
      ],
    };
  }

  /**
   * Retry failed transcription
   */
  async retryTranscription(callId: string): Promise<string | null> {
    const call = await this.prisma.phoneCall.findUnique({
      where: { id: callId },
      select: { recordingUrl: true, twilioCallSid: true },
    });

    if (!call?.recordingUrl || !call?.twilioCallSid) {
      this.logger.warn(`Cannot retry transcription - no recording URL for call ${callId}`);
      return null;
    }

    return this.transcribeRecording(call.recordingUrl, call.twilioCallSid);
  }

  /**
   * Transcribe recording for a specific call segment (by call ID)
   * Used for conference-based calls where each segment has its own recording
   */
  async transcribeSegmentRecording(audioUrl: string, callId: string): Promise<string | null> {
    this.logger.log(`Starting transcription for call segment ${callId}`);

    // Update status to processing
    await this.prisma.phoneCall.update({
      where: { id: callId },
      data: { transcriptionStatus: 'processing' },
    });

    try {
      // Download the audio file from S3
      const response = await fetch(audioUrl);
      if (!response.ok) {
        throw new Error(`Failed to download audio: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      this.logger.log(`Downloaded audio for segment transcription: ${buffer.length} bytes`);

      // Create a File-like object for OpenAI API
      const file = new File([buffer], 'recording.mp3', { type: 'audio/mpeg' });

      // Call GPT-4o Transcribe Diarize API for speaker identification
      const transcriptionResult = await this.openai.audio.transcriptions.create({
        file: file,
        model: 'gpt-4o-transcribe-diarize',
        response_format: 'diarized_json',
        chunking_strategy: 'auto',
      } as any);

      this.logger.log(`Transcription completed for segment ${callId}`);

      // Process the result to extract speaker segments
      const timelineData = this.processTranscriptionWithSpeakers(transcriptionResult as any);
      const transcriptionJson = JSON.stringify(timelineData);

      // Update call record with transcription
      await this.prisma.phoneCall.update({
        where: { id: callId },
        data: {
          transcription: transcriptionJson,
          transcriptionStatus: 'completed',
        },
      });

      return transcriptionJson;
    } catch (error) {
      this.logger.error(`Transcription failed for segment ${callId}: ${error.message}`);

      // Update status to failed
      await this.prisma.phoneCall.update({
        where: { id: callId },
        data: { transcriptionStatus: 'failed' },
      });

      return null;
    }
  }
}
