import { PipeTransform, Injectable, ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

/**
 * Pipe global de sanitización y validación
 * Requerido por RouteOne y DealerTrack
 *
 * - Valida todos los DTOs automáticamente
 * - Transforma y sanitiza datos
 * - Protege contra inyección y XSS
 * - Remueve propiedades no permitidas
 */
@Injectable()
export class GlobalValidationPipe implements PipeTransform<any> {
  async transform(value: any, { metatype }: ArgumentMetadata) {
    if (!metatype || !this.toValidate(metatype)) {
      return value;
    }

    // Convertir a instancia de clase con transformers
    const object = plainToInstance(metatype, value, {
      enableImplicitConversion: true,
      excludeExtraneousValues: false, // Permitir propiedades extra por ahora
    });

    // Validar con class-validator
    const errors = await validate(object, {
      whitelist: true, // Remover propiedades no decoradas
      forbidNonWhitelisted: true, // Lanzar error si hay propiedades no permitidas
      forbidUnknownValues: true, // Rechazar valores desconocidos
      skipMissingProperties: false,
      validationError: {
        target: false,
        value: false, // No incluir valores en errores (seguridad)
      },
    });

    if (errors.length > 0) {
      const messages = this.buildErrorMessage(errors);
      throw new BadRequestException({
        message: 'Validation failed',
        errors: messages,
      });
    }

    return object;
  }

  private toValidate(metatype: Function): boolean {
    const types: Function[] = [String, Boolean, Number, Array, Object];
    return !types.includes(metatype);
  }

  private buildErrorMessage(errors: any[]): string[] {
    return errors.flatMap((error) => {
      if (error.constraints) {
        return Object.values(error.constraints);
      }
      if (error.children && error.children.length) {
        return this.buildErrorMessage(error.children);
      }
      return [];
    });
  }
}
