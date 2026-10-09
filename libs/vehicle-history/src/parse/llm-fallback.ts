import OpenAI from 'openai';
import { redactPII, scrubSourceLines } from './redact';

/**
 * LLM fallback — only ever called for a section the deterministic parser
 * left `missing`, and only ever sent that section's own (already redacted)
 * text slice. Disabled by default behavior is "enabled"; opt out with
 * VH_PARSE_LLM_ENABLED=false. Parsers must produce a usable result with
 * this fully disabled (no network calls, no API key required) — this file
 * is the only place that touches the network.
 */
const API_KEY = process.env.OPENAI_API_KEY || process.env.TTS_API_KEY || '';

export function isLlmEnabled(): boolean {
  return process.env.VH_PARSE_LLM_ENABLED !== 'false' && API_KEY.length > 0;
}

let cachedClient: OpenAI | null = null;
function getClient(): OpenAI {
  if (!cachedClient) cachedClient = new OpenAI({ apiKey: API_KEY });
  return cachedClient;
}

export type LlmSection = 'odometerReadings' | 'damageEvents' | 'titleEvents' | 'ownershipPeriods';

const SECTION_SCHEMAS: Record<LlmSection, { name: string; schema: Record<string, unknown> }> = {
  odometerReadings: {
    name: 'vh_odometer_readings',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: { type: ['string', 'null'] },
              miles: { type: ['number', 'null'] },
              source: { type: ['string', 'null'] },
            },
            required: ['date', 'miles', 'source'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
  damageEvents: {
    name: 'vh_damage_events',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: { type: ['string', 'null'] },
              kind: { type: 'string', enum: ['accident', 'damage', 'airbag', 'structural', 'total_loss', 'other'] },
              severity: { type: ['string', 'null'] },
              area: { type: ['string', 'null'] },
              airbag: { type: ['boolean', 'null'] },
              description: { type: ['string', 'null'] },
            },
            required: ['date', 'kind', 'severity', 'area', 'airbag', 'description'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
  titleEvents: {
    name: 'vh_title_events',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: { type: ['string', 'null'] },
              state: { type: ['string', 'null'] },
              brand: { type: ['string', 'null'] },
              kind: { type: ['string', 'null'] },
              odometer: { type: ['number', 'null'] },
            },
            required: ['date', 'state', 'brand', 'kind', 'odometer'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
  ownershipPeriods: {
    name: 'vh_ownership_periods',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ownerIndex: { type: 'number' },
              start: { type: ['string', 'null'] },
              end: { type: ['string', 'null'] },
              usageType: { type: ['string', 'null'] },
              state: { type: ['string', 'null'] },
              milesPerYear: { type: ['number', 'null'] },
            },
            required: ['ownerIndex', 'start', 'end', 'usageType', 'state', 'milesPerYear'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
};

const MAX_INPUT_CHARS = 6000;

/**
 * Resolves a single missing section from its own redacted text slice.
 * Returns null (never throws) on disabled/missing-key/API error so callers
 * can simply keep the section 'missing' on failure.
 */
export async function resolveSectionWithLlm<T>(section: LlmSection, sectionText: string): Promise<T[] | null> {
  if (!isLlmEnabled()) return null;
  const redacted = redactPII(scrubSourceLines(sectionText)).slice(0, MAX_INPUT_CHARS);
  if (redacted.trim().length === 0) return null;
  const { name, schema } = SECTION_SCHEMAS[section];
  try {
    const response = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            `Extract the "${section}" data from this vehicle history report excerpt. ` +
            'Only use information present in the text. Use null for anything not stated. Never invent values.',
        },
        { role: 'user', content: redacted },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name, strict: true, schema },
      },
    });
    const content = response.choices[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as { items?: T[] };
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return null;
  }
}
