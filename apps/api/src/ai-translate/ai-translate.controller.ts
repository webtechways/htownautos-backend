import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AllowCustomer, TenantOptional } from '@htownautos/auth';
import { AiTranslateService } from './ai-translate.service';
import { TranslateDto } from './dto/translate.dto';

/**
 * Traduccion por LLM.
 *
 * Estuvo marcado `@Public()`: un endpoint que gasta tokens, abierto a internet
 * y sin clave. No es una fuga de datos, es una factura sin techo — y no lo
 * llamaba nadie, ni el dashboard ni el portal de clientes.
 *
 * Ahora entra por la cadena normal (API key o sesion de Clerk) y con un tope
 * propio: traducir es puntual, nadie legitimo necesita 30 por minuto.
 *
 * El portal de clientes (htownautos-web, detalle de inspeccion) SI lo usa, con
 * la sesion del cliente: por eso admite clientes y no exige tenant (traducir
 * no lee datos de ningun tenant).
 */
@Controller('ai')
export class AiTranslateController {
  constructor(private readonly aiTranslateService: AiTranslateService) {}

  @Post('translate')
  @AllowCustomer()
  @TenantOptional()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  translate(@Body() dto: TranslateDto): Promise<{ text: string }> {
    return this.aiTranslateService.translate(dto);
  }
}
