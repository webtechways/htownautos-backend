import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Validador de VIN (Vehicle Identification Number)
 * Requerido por DealerTrack para validación de vehículos
 *
 * Formato: 17 caracteres alfanuméricos
 * No puede contener: I, O, Q (para evitar confusión con 1, 0)
 * Incluye validación de check digit (posición 9)
 */
@ValidatorConstraint({ async: false })
export class IsValidVINConstraint implements ValidatorConstraintInterface {
  private readonly transliteration: { [key: string]: number } = {
    A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
    J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
    S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
    '0': 0, '1': 1, '2': 2, '3': 3, '4': 4,
    '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  };

  private readonly weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

  validate(vin: string): boolean {
    if (!vin) return true; // Permitir valores opcionales

    // Convertir a mayúsculas
    const vinUpper = vin.toUpperCase();

    // Debe tener exactamente 17 caracteres
    if (vinUpper.length !== 17) {
      return false;
    }

    // No debe contener I, O, Q
    if (/[IOQ]/.test(vinUpper)) {
      return false;
    }

    // Debe ser alfanumérico
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vinUpper)) {
      return false;
    }

    // Validar check digit (posición 9)
    return this.validateCheckDigit(vinUpper);
  }

  private validateCheckDigit(vin: string): boolean {
    let sum = 0;

    for (let i = 0; i < 17; i++) {
      const char = vin[i];
      const value = this.transliteration[char];

      if (value === undefined) {
        return false;
      }

      sum += value * this.weights[i];
    }

    const checkDigit = sum % 11;
    const expectedChar = checkDigit === 10 ? 'X' : checkDigit.toString();

    return vin[8] === expectedChar;
  }

  defaultMessage(): string {
    return 'Invalid VIN format. Must be 17 alphanumeric characters (excluding I, O, Q) with valid check digit';
  }
}

export function IsValidVIN(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidVINConstraint,
    });
  };
}
