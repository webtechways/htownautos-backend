import { readFileSync } from 'fs';
import { join } from 'path';
import { detectTemplate } from './detect-template';

const carfaxHtml = readFileSync(join(__dirname, '__fixtures__/carfax-html.fixture.html'), 'utf-8');
const autocheckHtml = readFileSync(join(__dirname, '__fixtures__/autocheck-html.fixture.html'), 'utf-8');
const carfaxPdfText = readFileSync(join(__dirname, '__fixtures__/carfax-pdf.fixture.txt'), 'utf-8');
const autocheckPdfText = readFileSync(join(__dirname, '__fixtures__/autocheck.fixture.txt'), 'utf-8');

describe('detectTemplate', () => {
  it('identifies the carfax html template', () => {
    expect(detectTemplate(carfaxHtml, 'html')).toBe('carfax-html');
  });

  it('identifies the autocheck html template', () => {
    expect(detectTemplate(autocheckHtml, 'html')).toBe('autocheck-html');
  });

  it('identifies the carfax pdf template', () => {
    expect(detectTemplate(carfaxPdfText, 'pdf')).toBe('carfax-pdf');
  });

  it('identifies the autocheck pdf template', () => {
    expect(detectTemplate(autocheckPdfText, 'pdf')).toBe('autocheck-pdf');
  });

  it('falls back to unknown for unrelated documents', () => {
    expect(detectTemplate('Invoice number 4HDD1KH6 Date due June 13, 2026', 'pdf')).toBe('unknown');
    expect(detectTemplate('<html><body>hello world</body></html>', 'html')).toBe('unknown');
  });
});
