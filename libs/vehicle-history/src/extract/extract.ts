import OpenAI from 'openai';
import type { ReasoningEffort } from 'openai/resources/shared';
import { preprocessReport, PreprocessResult } from './preprocess';
import { EXTRACTION_SCHEMA } from './schema';
import { SYSTEM_PROMPT, PROMPT_VERSION } from './prompt';
import { VehicleHistoryReportExtract, ExtractionWrapper } from './types';
import { normalizeReportDates } from './normalize-dates';

/**
 * Only place in this module that touches the network — mirrors
 * `parse/llm-fallback.ts`'s key resolution (same env vars, same client
 * shape) but is its own client/module since this is a full extraction, not
 * a missing-section fallback.
 */
const API_KEY = process.env.OPENAI_API_KEY || process.env.TTS_API_KEY || '';
const TIMEOUT_MS = 120_000;
export const DEFAULT_MODEL = 'gpt-4o-mini';

export function isExtractEnabled(): boolean {
  return process.env.VH_EXTRACT_ENABLED !== 'false' && API_KEY.length > 0;
}

export function getExtractModel(): string {
  return process.env.VH_EXTRACT_MODEL || DEFAULT_MODEL;
}

export function getExtractFallbackModel(): string | null {
  return process.env.VH_EXTRACT_MODEL_FALLBACK || null;
}

/**
 * `VH_EXTRACT_MODEL_PDF` overrides the primary model for the inputs that
 * actually need a stronger model: a scanned/image PDF sent as a file
 * (`inputMode === 'pdf_file'`) or an AutoCheck report (noisier layout than
 * Carfax). An explicit `model` override (the consumer's fallback-model
 * retry) always wins over this.
 */
function resolveModel(opts: { inputMode: PreprocessResult['inputMode']; reportType?: string }): string {
  const pdfModel = process.env.VH_EXTRACT_MODEL_PDF;
  if (pdfModel && (opts.inputMode === 'pdf_file' || opts.reportType === 'autocheck')) return pdfModel;
  return getExtractModel();
}

let cachedClient: OpenAI | null = null;
function getClient(): OpenAI {
  if (!cachedClient) cachedClient = new OpenAI({ apiKey: API_KEY });
  return cachedClient;
}

/**
 * Reasoning models (o1/o3/o4, the gpt-6 family) don't support `temperature`
 * once reasoning is on, bill hidden chain-of-thought tokens as output
 * tokens (so need real headroom via `max_completion_tokens`), and use
 * `reasoning_effort` instead. Everything else (gpt-4o*, gpt-4.1*) keeps the
 * old temperature:0 behavior.
 */
function isReasoningModel(model: string): boolean {
  return /^o[1-9]([.-]|$)/.test(model) || /^gpt-6/.test(model) || /-pro(-|$)/.test(model);
}

/** Headroom for owners_history/history_table-heavy reports (e.g. the ~140-row AutoCheck PDF) plus hidden reasoning tokens. */
const REASONING_MAX_COMPLETION_TOKENS = 16_000;

export interface ExtractUsage {
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
}

export interface ExtractResult {
  report: VehicleHistoryReportExtract | null;
  isReport: boolean;
  usage: ExtractUsage;
  model: string;
  latencyMs: number;
  inputMode: 'text' | 'pdf_file';
  inputChars: number;
  truncated: boolean;
  requestId: string | null;
}

export interface ExtractInput {
  body: Buffer;
  contentType: string;
  vin: string | null;
  /** 'carfax' | 'autocheck' — only used to pick VH_EXTRACT_MODEL_PDF for autocheck; unknown is fine. */
  reportType?: string;
  /** Explicit override — the consumer sets this to retry with VH_EXTRACT_MODEL_FALLBACK after a validation failure. */
  model?: string;
}

export async function extractReport(input: ExtractInput): Promise<ExtractResult> {
  if (!API_KEY) throw new Error('OPENAI_API_KEY / TTS_API_KEY not configured');

  const pre = await preprocessReport(input.body, input.contentType);
  const model = input.model || resolveModel({ inputMode: pre.inputMode, reportType: input.reportType });

  const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] =
    pre.inputMode === 'pdf_file'
      ? [
          { type: 'file', file: { filename: 'report.pdf', file_data: `data:application/pdf;base64,${pre.pdfBase64}` } },
          { type: 'text', text: `Extract this vehicle history report (VIN: ${input.vin ?? 'unknown'}) per the schema.` },
        ]
      : [{ type: 'text', text: `VIN: ${input.vin ?? 'unknown'}\n\n${pre.text}` }];

  const reasoning = isReasoningModel(model);
  const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_schema', json_schema: EXTRACTION_SCHEMA },
  };
  if (reasoning) {
    params.reasoning_effort = (process.env.VH_EXTRACT_REASONING_EFFORT as ReasoningEffort) || 'medium';
    params.max_completion_tokens = REASONING_MAX_COMPLETION_TOKENS;
  } else {
    params.temperature = 0;
  }

  const startedAt = Date.now();
  const response = await getClient().chat.completions.create(params, { timeout: TIMEOUT_MS });
  const latencyMs = Date.now() - startedAt;

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned no content');
  const parsed = JSON.parse(content) as ExtractionWrapper;

  const usage: ExtractUsage = {
    promptTokens: response.usage?.prompt_tokens ?? 0,
    cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
  };

  // Date-format slips (MM-DD-YYYY etc.) degrade to null here instead of
  // failing validation — see normalize-dates.ts.
  const report = parsed.is_vehicle_history_report ? normalizeReportDates(parsed.report) : null;

  return {
    report,
    isReport: parsed.is_vehicle_history_report,
    usage,
    model,
    latencyMs,
    inputMode: pre.inputMode,
    inputChars: pre.inputMode === 'text' ? pre.inputChars : 0,
    truncated: pre.inputMode === 'text' ? pre.truncated : false,
    requestId: response.id ?? null,
  };
}

export { PROMPT_VERSION };
