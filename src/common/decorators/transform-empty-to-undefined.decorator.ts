import { Transform } from 'class-transformer';

/**
 * Transform empty strings and null values to undefined
 * Useful for optional fields that should skip validation when empty
 */
export function TransformEmptyToUndefined() {
  return Transform(({ value }) => {
    if (value === '' || value === null) {
      return undefined;
    }
    return value;
  });
}
