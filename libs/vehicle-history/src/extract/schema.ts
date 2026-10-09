/**
 * Strict JSON schema (OpenAI Structured Outputs) for the CONTRACT `report`
 * shape, wrapped so the model first decides whether the document is a
 * vehicle history report at all. Only `report` is ever stored — see
 * `extract.ts`. Field names/enums are exact per the CONTRACT; do not rename.
 *
 * Strict mode requires every property to be listed in `required` (nullable
 * fields use a `["type", "null"]` union instead of being optional) and every
 * object to set `additionalProperties: false`.
 */
const historyTableItemSchema = {
  type: 'object',
  properties: {
    date: { type: ['string', 'null'] },
    millage: { type: ['number', 'null'] },
    source: { type: ['string', 'null'] },
    comment: { type: 'string' },
    damage_type: { type: ['string', 'null'], enum: ['minor', 'moderate', 'heavy', null] },
    if_damage: {
      type: ['array', 'null'],
      items: {
        type: 'string',
        enum: [
          'front',
          'rear',
          'left',
          'right',
          'front_right',
          'front_left',
          'rear_right',
          'rear_left',
          'roof',
          'undercarrier',
          'burn',
        ],
      },
    },
    flooded: { type: 'boolean' },
    burn: { type: 'boolean' },
    bandalist: { type: 'boolean' },
    teaft: { type: 'boolean' },
    total_lost: { type: 'boolean' },
    salvage_issue: { type: 'boolean' },
  },
  required: [
    'date',
    'millage',
    'source',
    'comment',
    'damage_type',
    'if_damage',
    'flooded',
    'burn',
    'bandalist',
    'teaft',
    'total_lost',
    'salvage_issue',
  ],
  additionalProperties: false,
} as const;

const ownerHistorySchema = {
  type: 'object',
  properties: {
    owner_no: { type: 'number' },
    purchased: { type: ['string', 'null'] },
    type_of_owner: { type: ['string', 'null'] },
    millage: { type: ['number', 'null'] },
    history_table: { type: 'array', items: historyTableItemSchema },
  },
  required: ['owner_no', 'purchased', 'type_of_owner', 'millage', 'history_table'],
  additionalProperties: false,
} as const;

export const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    millage: { type: ['number', 'null'] },
    accident: { type: ['boolean', 'null'] },
    title: {
      type: ['string', 'null'],
      enum: ['Clean Title', 'Rebuilt Title', 'Salvage Title', 'Non Reparable', null],
    },
    value: { type: ['number', 'null'] },
    service_history_record: { type: ['number', 'null'] },
    at_last_open_recall: { type: ['number', 'null'] },
    last_owner_state: { type: ['string', 'null'] },
    owners_history: { type: 'array', items: ownerHistorySchema },
  },
  required: [
    'millage',
    'accident',
    'title',
    'value',
    'service_history_record',
    'at_last_open_recall',
    'last_owner_state',
    'owners_history',
  ],
  additionalProperties: false,
} as const;

export const EXTRACTION_SCHEMA = {
  name: 'vehicle_history_extraction',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      is_vehicle_history_report: { type: 'boolean' },
      report: REPORT_SCHEMA,
    },
    required: ['is_vehicle_history_report', 'report'],
    additionalProperties: false,
  },
} as const;
