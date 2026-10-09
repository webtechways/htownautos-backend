import * as cheerio from 'cheerio';
import { extractPdfText } from '../parse/carfax-pdf';

/**
 * Reduces a stored report body to the text/PDF input the OpenAI extraction
 * prompt is built on. HTML is stripped of non-content tags and each `<tr>`
 * is flattened to one line so the model sees tabular data without having to
 * parse markup. PDFs that extract to usable text are sent as text (cheaper,
 * cacheable); image-only/scanned PDFs fall back to sending the file itself.
 */
const MAX_INPUT_CHARS = 120_000;
const MIN_PDF_TEXT_CHARS = 500;

export type PreprocessResult =
  | { inputMode: 'text'; text: string; inputChars: number; truncated: boolean }
  | { inputMode: 'pdf_file'; pdfBase64: string; inputChars: 0; truncated: false };

export async function preprocessReport(body: Buffer, contentType: string): Promise<PreprocessResult> {
  const isPdf = contentType === 'application/pdf';
  if (isPdf) {
    const text = await extractPdfText(body).catch(() => '');
    if (text.trim().length >= MIN_PDF_TEXT_CHARS) {
      return clampText(text);
    }
    return { inputMode: 'pdf_file', pdfBase64: body.toString('base64'), inputChars: 0, truncated: false };
  }
  const html = body.toString('utf-8');
  return clampText(preprocessHtml(html));
}

export function preprocessHtml(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, svg, noscript, head, img, iframe').remove();

  $('tr').each((_, el) => {
    const $el = $(el);
    const cells = $el
      .find('td, th')
      .map((__, cell) => $(cell).text().replace(/\s+/g, ' ').trim())
      .get()
      .filter((c) => c.length > 0);
    if (cells.length > 0) {
      $el.replaceWith(`${cells.join(' | ')}\n`);
    }
  });

  const text = $('body').length ? $('body').text() : $.root().text();
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

function clampText(text: string): PreprocessResult {
  const truncated = text.length > MAX_INPUT_CHARS;
  const clamped = truncated ? text.slice(0, MAX_INPUT_CHARS) : text;
  return { inputMode: 'text', text: clamped, inputChars: clamped.length, truncated };
}
