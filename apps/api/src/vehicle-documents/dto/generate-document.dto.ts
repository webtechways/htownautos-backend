import { IsEmail, IsObject, IsOptional, IsString } from 'class-validator';
import type { Datos130U } from '../forms/form-130u';

export class GenerateDocumentDto {
  @IsString()
  vehicleId!: string;

  @IsString()
  formKey!: string;

  @IsOptional()
  @IsString()
  buyerId?: string;

  /**
   * Lo que rellena el asistente. No se valida campo a campo a proposito: el
   * formulario tiene 106 y la forma la fija `Datos130U`; duplicar aqui la lista
   * garantiza que las dos se separen con el primer cambio.
   */
  @IsObject()
  values!: Datos130U;
}

export class SendDocumentDto {
  @IsEmail()
  email!: string;
}
