import {
  isPendingPlaceholderPhone,
  isPlaceholderDateOfBirth,
  isPlaceholderAddressField,
  isSyntheticClerkEmail,
} from './incomplete-profile.utils';

describe('incomplete-profile.utils', () => {
  describe('isPendingPlaceholderPhone', () => {
    it('flags the pending-<userId> placeholder', () => {
      expect(isPendingPlaceholderPhone('pending-abc123')).toBe(true);
    });

    it('does not flag a real E.164 phone', () => {
      expect(isPendingPlaceholderPhone('+17135551234')).toBe(false);
    });

    it('does not flag null/undefined', () => {
      expect(isPendingPlaceholderPhone(null)).toBe(false);
      expect(isPendingPlaceholderPhone(undefined)).toBe(false);
    });
  });

  describe('isPlaceholderDateOfBirth', () => {
    it('flags the 1900-01-01 placeholder as a Date', () => {
      expect(isPlaceholderDateOfBirth(new Date('1900-01-01T00:00:00.000Z'))).toBe(true);
    });

    it('flags the 1900-01-01 placeholder as an ISO string', () => {
      expect(isPlaceholderDateOfBirth('1900-01-01T00:00:00.000Z')).toBe(true);
    });

    it('does not flag a real date of birth', () => {
      expect(isPlaceholderDateOfBirth(new Date('1990-05-20T00:00:00.000Z'))).toBe(false);
    });

    it('does not flag null', () => {
      expect(isPlaceholderDateOfBirth(null)).toBe(false);
    });
  });

  describe('isPlaceholderAddressField', () => {
    it('flags an empty string', () => {
      expect(isPlaceholderAddressField('')).toBe(true);
    });

    it('does not flag a real address value', () => {
      expect(isPlaceholderAddressField('123 Main St')).toBe(false);
    });

    it('does not flag null/undefined', () => {
      expect(isPlaceholderAddressField(null)).toBe(false);
      expect(isPlaceholderAddressField(undefined)).toBe(false);
    });
  });

  describe('isSyntheticClerkEmail', () => {
    it('flags the synthetic no-email domain', () => {
      expect(isSyntheticClerkEmail('user_abc123@clerk.no-email.htownautos.internal')).toBe(true);
    });

    it('is case-insensitive on the domain', () => {
      expect(isSyntheticClerkEmail('user_abc123@CLERK.NO-EMAIL.HTOWNAUTOS.INTERNAL')).toBe(true);
    });

    it('does not flag a real email', () => {
      expect(isSyntheticClerkEmail('buyer@example.com')).toBe(false);
    });

    it('does not flag null/undefined', () => {
      expect(isSyntheticClerkEmail(null)).toBe(false);
      expect(isSyntheticClerkEmail(undefined)).toBe(false);
    });
  });
});
