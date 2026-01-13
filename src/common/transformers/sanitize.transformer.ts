import { Transform } from 'class-transformer';

/**
 * Transformers para sanitización de datos
 * Requerido por RouteOne y DealerTrack para seguridad
 */

/**
 * Sanitiza strings removiendo caracteres peligrosos
 * Previene XSS y SQL Injection
 */
export function SanitizeString() {
  return Transform(({ value }) => {
    if (typeof value !== 'string') return value;

    return value
      .trim()
      .replace(/[<>]/g, '') // Remover < y > para prevenir XSS
      .replace(/['"`;]/g, '') // Remover comillas y punto y coma para prevenir SQL injection
      .replace(/\\/g, ''); // Remover backslashes
  });
}

/**
 * Normaliza SSN al formato XXX-XX-XXXX
 * Requerido por RouteOne
 */
export function NormalizeSSN() {
  return Transform(({ value }) => {
    if (!value) return value;

    // Remover todo excepto dígitos
    const digits = value.replace(/\D/g, '');

    // Si no tiene 9 dígitos, retornar como está
    if (digits.length !== 9) return value;

    // Formatear como XXX-XX-XXXX
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5, 9)}`;
  });
}

/**
 * Normaliza VIN a mayúsculas sin espacios
 * Requerido por DealerTrack
 */
export function NormalizeVIN() {
  return Transform(({ value }) => {
    if (!value) return value;

    return value
      .toUpperCase()
      .replace(/\s/g, '') // Remover espacios
      .replace(/[^A-HJ-NPR-Z0-9]/g, ''); // Remover caracteres inválidos
  });
}

/**
 * Normaliza email a minúsculas
 */
export function NormalizeEmail() {
  return Transform(({ value }) => {
    if (!value) return value;

    return value.toLowerCase().trim();
  });
}

/**
 * Normaliza teléfono al formato (XXX) XXX-XXXX
 */
export function NormalizePhone() {
  return Transform(({ value }) => {
    if (!value) return value;

    // Remover todo excepto dígitos
    const digits = value.replace(/\D/g, '');

    // Si no tiene 10 dígitos, retornar como está
    if (digits.length !== 10) return value;

    // Formatear como (XXX) XXX-XXXX
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  });
}

/**
 * Sanitiza nombres propios (capitaliza primera letra)
 */
export function CapitalizeName() {
  return Transform(({ value }) => {
    if (!value) return value;

    return value
      .trim()
      .toLowerCase()
      .replace(/\b\w/g, (char: string) => char.toUpperCase());
  });
}

/**
 * Limpia y valida URLs
 */
export function SanitizeURL() {
  return Transform(({ value }) => {
    if (!value) return value;

    try {
      const url = new URL(value);
      // Solo permitir http y https
      if (!['http:', 'https:'].includes(url.protocol)) {
        return null;
      }
      return url.toString();
    } catch {
      return null;
    }
  });
}
