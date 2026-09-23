import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from '@htownautos/prisma';
import { PLATFORM_LIMITS } from '@htownautos/social';
import { AiComposeDto, AiReplyDto, GenerateIdeasDto } from './dto';

const MAX_ALTERNATIVES = 2;
const REPLY_SUGGESTION_COUNT = 3;
const CONVERSATION_HISTORY_MESSAGES = 10;
const COMMENT_THREAD_REPLIES = 10;
const DEFAULT_IDEA_COUNT = 5;

const ACTION_INSTRUCTIONS: Record<AiComposeDto['action'], string> = {
  generate: 'Write a fresh social media post from the prompt below.',
  rephrase: 'Rephrase the text below, keeping its meaning and length roughly the same.',
  shorten: 'Shorten the text below while keeping its key message.',
  expand: 'Expand the text below with more detail, keeping the same tone.',
  fix: 'Fix any spelling, grammar, or punctuation mistakes in the text below. Keep the wording otherwise.',
  hashtags: 'Add relevant hashtags to the end of the text below. Keep the original text unchanged above the hashtags.',
  translate: 'Translate the text below.',
  tone: 'Rewrite the text below in a different tone, keeping the same meaning.',
};

export interface AiComposeResult {
  text: string;
  alternatives: string[];
}

export interface AiReplyResult {
  suggestions: string[];
}

export interface IdeaSuggestionResult {
  title: string;
  content: string;
}

@Injectable()
export class SocialAiService {
  private readonly logger = new Logger(SocialAiService.name);
  private readonly openai: OpenAI | null;
  private readonly model = process.env.SOCIAL_AI_MODEL || process.env.AI_CHAT_MODEL || 'gpt-4o-mini';

  constructor(private readonly prisma: PrismaService) {
    const apiKey = process.env.OPENAI_API_KEY || process.env.TTS_API_KEY;
    this.openai = apiKey ? new OpenAI({ apiKey }) : null;
    if (!apiKey) this.logger.warn('[SocialAi] Sin OPENAI_API_KEY ni TTS_API_KEY: el asistente respondera con error');
  }

  async compose(dto: AiComposeDto): Promise<AiComposeResult> {
    if (dto.action === 'generate') {
      if (!dto.prompt) throw new BadRequestException('prompt es requerido para action=generate');
    } else if (!dto.text) {
      throw new BadRequestException('text es requerido para esta accion');
    }

    const maxChars = dto.platform ? PLATFORM_LIMITS[dto.platform].maxChars : undefined;
    const parts: string[] = [ACTION_INSTRUCTIONS[dto.action]];
    if (dto.action === 'translate' && dto.language) parts.push(`Target language (BCP-47): ${dto.language}.`);
    if (dto.action === 'tone' && dto.tone) parts.push(`Target tone: ${dto.tone}.`);
    if (dto.tone && dto.action !== 'tone') parts.push(`Tone: ${dto.tone}.`);
    if (maxChars) parts.push(`Hard limit: ${maxChars} characters — never exceed it.`);
    parts.push(
      `Respond with ONLY a JSON object: {"text": string, "alternatives": string[]} — "text" is the best result, "alternatives" is up to ${MAX_ALTERNATIVES} different variations. No preamble, no markdown fences.`,
    );

    const userContent = dto.action === 'generate' ? `Write about: ${dto.prompt}` : dto.text!;

    const json = await this.callJson(parts.join(' '), userContent);
    const text = typeof json.text === 'string' ? json.text : '';
    if (!text) throw new InternalServerErrorException('El asistente de IA no devolvio texto');
    const alternatives = Array.isArray(json.alternatives) ? json.alternatives.filter((a): a is string => typeof a === 'string').slice(0, MAX_ALTERNATIVES) : [];
    return { text, alternatives };
  }

  async replySuggestion(tenantId: string, dto: AiReplyDto): Promise<AiReplyResult> {
    if (!dto.conversationId && !dto.commentId) throw new BadRequestException('conversationId o commentId es requerido');

    const transcript = dto.conversationId ? await this.buildConversationTranscript(tenantId, dto.conversationId) : await this.buildCommentTranscript(tenantId, dto.commentId!);

    const system = `You are drafting quick reply suggestions for a customer-facing social/messaging inbox. Read the conversation below and propose ${REPLY_SUGGESTION_COUNT} short, distinct reply options (1-2 sentences each) written in the SAME language the conversation is in. Respond with ONLY a JSON object: {"suggestions": string[]}. No preamble, no markdown fences.`;
    const json = await this.callJson(system, transcript);
    const suggestions = Array.isArray(json.suggestions) ? json.suggestions.filter((s): s is string => typeof s === 'string').slice(0, REPLY_SUGGESTION_COUNT) : [];
    return { suggestions };
  }

  async generateIdeas(dto: GenerateIdeasDto): Promise<IdeaSuggestionResult[]> {
    const count = dto.count ?? DEFAULT_IDEA_COUNT;
    const platformHint = dto.platform ? ` for ${PLATFORM_LIMITS[dto.platform].label}` : '';
    const system = `Generate ${count} social media content ideas${platformHint} for a used-car dealership, based on the prompt below. Respond with ONLY a JSON object: {"ideas": [{"title": string, "content": string}]} with exactly ${count} items. "content" is a short draft post, in the same language as the prompt. No preamble, no markdown fences.`;

    const json = await this.callJson(system, dto.prompt);
    const ideas = Array.isArray(json.ideas) ? json.ideas : [];
    return ideas
      .filter((i): i is { title: unknown; content: unknown } => typeof i === 'object' && i !== null)
      .map((i) => ({ title: typeof i.title === 'string' ? i.title : '', content: typeof i.content === 'string' ? i.content : '' }))
      .filter((i) => i.title && i.content)
      .slice(0, count);
  }

  private async buildConversationTranscript(tenantId: string, conversationId: string): Promise<string> {
    const conversation = await this.prisma.inboxConversation.findFirst({ where: { id: conversationId, tenantId } });
    if (!conversation) throw new NotFoundException('Conversacion no encontrada');

    const messages = await this.prisma.inboxMessage.findMany({
      where: { conversationId, tenantId },
      orderBy: { platformCreatedAt: 'desc' },
      take: CONVERSATION_HISTORY_MESSAGES,
    });
    return messages
      .reverse()
      .map((m) => `${m.direction === 'inbound' ? 'Customer' : 'Us'}: ${m.body ?? '[attachment]'}`)
      .join('\n');
  }

  private async buildCommentTranscript(tenantId: string, commentId: string): Promise<string> {
    const comment = await this.prisma.socialComment.findFirst({ where: { id: commentId, tenantId } });
    if (!comment) throw new NotFoundException('Comentario no encontrado');

    const replies = await this.prisma.socialComment.findMany({
      where: { parentId: commentId, tenantId },
      orderBy: { platformCreatedAt: 'asc' },
      take: COMMENT_THREAD_REPLIES,
    });
    const lines = [`${comment.authorName}: ${comment.body}`, ...replies.map((r) => `${r.fromUs ? 'Us' : r.authorName}: ${r.body}`)];
    return lines.join('\n');
  }

  private async callJson(system: string, user: string): Promise<Record<string, unknown>> {
    if (!this.openai) throw new InternalServerErrorException('El asistente de IA no esta configurado (falta OPENAI_API_KEY)');

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        response_format: { type: 'json_object' },
        temperature: 0.7,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      const raw = response.choices[0]?.message?.content?.trim();
      if (!raw) throw new InternalServerErrorException('El asistente de IA devolvio una respuesta vacia');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof InternalServerErrorException || err instanceof BadRequestException) throw err;
      this.logger.error(`OpenAI call failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new InternalServerErrorException('El asistente de IA fallo. Intenta de nuevo.');
    }
  }
}
