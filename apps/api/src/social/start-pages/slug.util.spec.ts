import { isReservedSlug, isValidSlugFormat, slugify, validateSlugShape } from './slug.util';

describe('slug format', () => {
  it('accepts lowercase letters, digits and dashes, 3-40 chars', () => {
    expect(isValidSlugFormat('joes-motors')).toBe(true);
    expect(isValidSlugFormat('abc')).toBe(true);
    expect(isValidSlugFormat('a'.repeat(40))).toBe(true);
  });

  it('rejects too short, too long, uppercase, and disallowed characters', () => {
    expect(isValidSlugFormat('ab')).toBe(false);
    expect(isValidSlugFormat('a'.repeat(41))).toBe(false);
    expect(isValidSlugFormat('Joes-Motors')).toBe(false);
    expect(isValidSlugFormat('joes_motors')).toBe(false);
    expect(isValidSlugFormat('joes motors')).toBe(false);
    expect(isValidSlugFormat('joes.motors')).toBe(false);
  });
});

describe('reserved slugs', () => {
  it('flags known reserved words case-insensitively', () => {
    expect(isReservedSlug('admin')).toBe(true);
    expect(isReservedSlug('ADMIN')).toBe(true);
    expect(isReservedSlug('dashboard')).toBe(true);
    expect(isReservedSlug('start')).toBe(true);
  });

  it('does not flag an ordinary business slug', () => {
    expect(isReservedSlug('joes-motors')).toBe(false);
    expect(isReservedSlug('htown-autos')).toBe(false);
  });
});

describe('validateSlugShape', () => {
  it('throws for a malformed slug', () => {
    expect(() => validateSlugShape('ab')).toThrow();
    expect(() => validateSlugShape('Has Spaces')).toThrow();
  });

  it('throws for a reserved slug even if the format is valid', () => {
    expect(() => validateSlugShape('settings')).toThrow();
  });

  it('does not throw for a valid, non-reserved slug', () => {
    expect(() => validateSlugShape('joes-motors')).not.toThrow();
  });
});

describe('slugify', () => {
  it('lowercases, strips accents, and replaces non-alphanumerics with dashes', () => {
    expect(slugify('Joe\'s Motors!')).toBe('joe-s-motors');
    expect(slugify('Café Automóvil')).toBe('cafe-automovil');
  });

  it('trims leading/trailing dashes and caps length at 40', () => {
    expect(slugify('  --Hello World--  ')).toBe('hello-world');
    expect(slugify('x'.repeat(60))).toHaveLength(40);
  });

  it('guarantees a minimum length of 3 even for near-empty input', () => {
    const result = slugify('!!');
    expect(result.length).toBeGreaterThanOrEqual(3);
  });
});
