import { deriveTitleCategory, resolveTitleCodeMap } from './title-category.utils';

describe('title-category.utils', () => {
  describe('deriveTitleCategory', () => {
    it('maps the base "rb" code to rebuilt', () => {
      expect(deriveTitleCategory('rb')).toBe('rebuilt');
    });

    it('lets a staff override on "rb" win over the base code', () => {
      expect(deriveTitleCategory('rb', { rb: 'salvage' })).toBe('salvage');
    });

    it('reads "REBUILT TITLE" text as rebuilt', () => {
      expect(deriveTitleCategory('REBUILT TITLE')).toBe('rebuilt');
    });

    it('maps the base "ct" code to clean', () => {
      expect(deriveTitleCategory('ct')).toBe('clean');
    });

    it('falls back to unknown for an unrecognised code', () => {
      expect(deriveTitleCategory('zz')).toBe('unknown');
    });
  });

  describe('resolveTitleCodeMap', () => {
    it('merges base codes with overrides', () => {
      const map = resolveTitleCodeMap({ zz: 'clean' });
      expect(map.rb).toBe('rebuilt');
      expect(map.ct).toBe('clean');
      expect(map.zz).toBe('clean');
    });

    it('lets an override win over a base code', () => {
      const map = resolveTitleCodeMap({ rb: 'salvage' });
      expect(map.rb).toBe('salvage');
    });
  });
});
