import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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
 */
@Controller('ai')
export class AiTranslateController {
  constructor(private readonly aiTranslateService: AiTranslateService) {}

  @Post('translate')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  translate(@Body() dto: TranslateDto): Promise<{ text: string }> {
    return this.aiTranslateService.translate(dto);
  }
}
