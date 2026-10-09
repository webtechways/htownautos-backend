import { readFileSync } from 'fs';
import { join } from 'path';
import { preprocessHtml } from './preprocess';

const fixture = readFileSync(join(__dirname, '../parse/__fixtures__/carfax-html.fixture.html'), 'utf-8');

describe('preprocessHtml', () => {
  it('strips script/style/svg/img/iframe tags', () => {
    const html = '<html><head><style>.x{}</style></head><body><script>var a=1;</script><p>Hello</p><img src="x"/><svg></svg></body></html>';
    const text = preprocessHtml(html);
    expect(text).not.toContain('var a=1');
    expect(text).toContain('Hello');
  });

  it('flattens each <tr> to one "cell | cell" line', () => {
    const html = '<table><tr><td>Date</td><td>Miles</td></tr><tr><td>01/01/2020</td><td>10,000</td></tr></table>';
    const text = preprocessHtml(html);
    const lines = text.split('\n');
    expect(lines).toContain('Date | Miles');
    expect(lines).toContain('01/01/2020 | 10,000');
  });

  it('collapses whitespace within a line', () => {
    const html = '<p>  a   b  </p>';
    const text = preprocessHtml(html);
    expect(text).toBe('a b');
  });

  it('drops blank lines produced by flattened <tr> rows', () => {
    const html = '<table><tr><td>a</td></tr><tr><td></td></tr><tr><td>b</td></tr></table>';
    const text = preprocessHtml(html);
    expect(text.split('\n')).toEqual(['a', 'b']);
  });

  it('produces non-empty flattened text for a real Carfax HTML fixture', () => {
    const text = preprocessHtml(fixture);
    expect(text.length).toBeGreaterThan(100);
    expect(text).not.toMatch(/<script|<style/i);
  });
});
