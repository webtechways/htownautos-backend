import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Validador de SSN (Social Security Number)
 * Requerido por RouteOne y DealerTrack para compliance
 *
 * Formato válido: XXX-XX-XXXX
 * Reglas:
 * - No puede empezar con 000, 666, o 900-999
 * - El grupo del medio no puede ser 00
 * - El último grupo no puede ser 0000
 */
@ValidatorConstraint({ async: false })
export class IsValidSSNConstraint implements ValidatorConstraintInterface {
  validate(ssn: string): boolean {
    if (!ssn) return true; // Permitir valores opcionales

    // Remover guiones para validación
    const cleanSSN = ssn.replace(/-/g, '');

    // Debe tener exactamente 9 dígitos
    if (!/^\d{9}$/.test(cleanSSN)) {
      return false;
    }

    const area = parseInt(cleanSSN.substring(0, 3), 10);
    const group = parseInt(cleanSSN.substring(3, 5), 10);
    const serial = parseInt(cleanSSN.substring(5, 9), 10);

    // Validar área (primeros 3 dígitos)
    if (area === 0 || area === 666 || area >= 900) {
      return false;
    }

    // Validar grupo (dígitos del medio)
    if (group === 0) {
      return false;
    }

    // Validar serial (últimos 4 dígitos)
    if (serial === 0) {
      return false;
    }

    return true;
  }

  defaultMessage(): string {
    return 'Invalid SSN format. Must be XXX-XX-XXXX with valid area, group, and serial numbers';
  }
}

export function IsValidSSN(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidSSNConstraint,
    });
  };
}
