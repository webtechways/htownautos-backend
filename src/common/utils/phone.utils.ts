/**
 * Phone number utility functions
 * All phone numbers in the database should be stored in E.164 format (+1XXXXXXXXXX)
 */

/**
 * Normalize a phone number to E.164 format
 * Accepts various formats: (713) 555-1234, 713-555-1234, 7135551234, +17135551234
 * Returns null if the input is not a valid phone number
 */
export function normalizePhoneNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;

  // Remove all non-digit characters except leading +
  const hasPlus = phone.startsWith('+');
  const digits = phone.replace(/\D/g, '');

  if (!digits) return null;

  // Handle different lengths
  if (digits.length === 10) {
    // US number without country code: 7135551234 -> +17135551234
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    // US number with country code: 17135551234 -> +17135551234
    return `+${digits}`;
  }

  if (digits.length > 11 && hasPlus) {
    // International number already has + prefix
    return `+${digits}`;
  }

  // If it's already 11+ digits without the leading 1, assume it's international
  if (digits.length >= 11) {
    return `+${digits}`;
  }

  // Invalid phone number (too short)
  return null;
}

/**
 * Check if a phone number is in valid E.164 format
 */
export function isValidE164(phone: string | null | undefined): boolean {
  if (!phone) return false;
  // E.164 format: + followed by 1-15 digits
  return /^\+[1-9]\d{1,14}$/.test(phone);
}

/**
 * Format a phone number for display in the UI
 * E.164 format (+17135551234) -> (713) 555-1234
 */
export function formatPhoneForDisplay(phone: string | null | undefined): string {
  if (!phone) return '';

  // Remove + prefix and country code for US numbers
  let digits = phone.replace(/\D/g, '');

  // If it starts with 1 and is 11 digits, remove the country code
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.substring(1);
  }

  // Format as (XXX) XXX-XXXX for 10-digit numbers
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  // Return as-is if not a standard US format
  return phone;
}

/**
 * Compare two phone numbers for equality (normalized)
 */
export function phoneNumbersMatch(phone1: string | null | undefined, phone2: string | null | undefined): boolean {
  const normalized1 = normalizePhoneNumber(phone1);
  const normalized2 = normalizePhoneNumber(phone2);

  if (!normalized1 || !normalized2) return false;
  return normalized1 === normalized2;
}
