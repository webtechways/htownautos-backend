import { readFileSync } from 'fs';
import { join } from 'path';
import { parseVehicleHistory } from './index';

// pdf-parse's pdfjs worker needs --experimental-vm-modules under plain
// jest (dynamic import of the worker build); that's a jest-runtime quirk,
// not a bug in our code (confirmed working via ts-node/Nest at runtime).
// Stub it here so the <200-chars-of-text "unsupported" branch is still
// exercised without depending on that flag.
jest.mock('pdf-parse', () => ({
  PDFParse: class {
    async getText() {
      return { text: '' };
    }
    async destroy() {}
  },
}));

const carfaxHtml = readFileSync(join(__dirname, '__fixtures__/carfax-html.fixture.html'), 'utf-8');

describe('parseVehicleHistory (orchestrator, LLM disabled)', () => {
  const prevFlag = process.env.VH_PARSE_LLM_ENABLED;
  const prevKey1 = process.env.OPENAI_API_KEY;
  const prevKey2 = process.env.TTS_API_KEY;

  beforeAll(() => {
    process.env.VH_PARSE_LLM_ENABLED = 'false';
    delete process.env.OPENAI_API_KEY;
    delete process.env.TTS_API_KEY;
  });

  afterAll(() => {
    process.env.VH_PARSE_LLM_ENABLED = prevFlag;
    if (prevKey1) process.env.OPENAI_API_KEY = prevKey1;
    if (prevKey2) process.env.TTS_API_KEY = prevKey2;
  });

  it('parses a recognized carfax html report without calling the LLM', async () => {
    const result = await parseVehicleHistory({
      body: Buffer.from(carfaxHtml, 'utf-8'),
      contentType: 'text/html',
      vin: '1HGCV2F95JA035016',
      reportType: 'carfax',
    });

    expect(result.template).toBe('carfax-html');
    expect(result.status).not.toBe('unsupported');
    expect(result.llmSections).toEqual([]);
    expect(result.vin).toBe('1HGCV2F95JA035016');

    // `raw` must be structured metadata only — no free text from the
    // report (no dealer names, addresses, HTML, etc). Walk every string
    // value and make sure none of them look like report prose/markup.
    const stringsInRaw: string[] = [];
    const visit = (value: unknown) => {
      if (typeof value === 'string') stringsInRaw.push(value);
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    visit(result.raw);
    for (const s of stringsInRaw) {
      expect(s.length).toBeLessThanOrEqual(40);
    }
    expect(result.raw).toMatchObject({ template: 'carfax-html', parserVersion: expect.any(Number) });
  });

  it('marks a scanned/near-empty PDF as unsupported', async () => {
    const result = await parseVehicleHistory({
      body: Buffer.from('%PDF-1.4 stub', 'utf-8'),
      contentType: 'application/pdf',
      vin: 'X',
      reportType: 'carfax',
    });

    expect(result.status).toBe('unsupported');
    expect(result.confidence).toBe(0);
  });

  it('marks unrelated documents as unsupported instead of guessing', async () => {
    const result = await parseVehicleHistory({
      body: Buffer.from('<html><body>Invoice #123, total due $49.99</body></html>', 'utf-8'),
      contentType: 'text/html',
      vin: 'X',
      reportType: 'carfax',
    });

    expect(result.template).toBe('unknown');
    expect(result.status).toBe('unsupported');
  });
});
