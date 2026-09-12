import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentTenant, CurrentUser, type AuthenticatedUser } from '@htownautos/auth';
import { AiChatService } from './ai-chat.service';
import { AskDto } from './dto';

@ApiTags('AI Chat')
@ApiBearerAuth()
@Controller('ai-chat')
export class AiChatController {
  constructor(private readonly service: AiChatService) {}

  @Get('conversations')
  @ApiOperation({ summary: 'Conversaciones del usuario' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listConversations(user.id);
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Mensajes de una conversacion' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getConversation(id, user.id);
  }

  @Delete('conversations/:id')
  @ApiOperation({ summary: 'Borrar una conversacion' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id, user.id);
  }

  /**
   * Tope propio y bajo: cada pregunta son varias llamadas a OpenAI y varias
   * consultas agregadas. Sin esto, una pestaña en bucle se convierte en factura.
   */
  /**
   * Igual que `ask`, pero emitiendo eventos segun avanza.
   *
   * Medido: la mediana de respuesta es 3,3s y el peor caso 8s, y el 94% de eso
   * es OpenAI. Con una sola respuesta al final el usuario mira un texto fijo
   * todo ese rato. Aqui ve que herramienta se esta usando y el texto
   * apareciendo, que es lo que hace que se sienta fluido.
   */
  @Post('ask/stream')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Preguntar, con respuesta en streaming (SSE)' })
  async askStream(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantId: string,
    @Body() dto: AskDto,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Sin esto, un proxy con buffer se guarda los eventos y los entrega todos
    // al final, que es exactamente lo que se intenta evitar.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const enviar = (dato: unknown) => {
      res.write(`data: ${JSON.stringify(dato)}\n\n`);
    };

    try {
      const r = await this.service.ask({
        tenantId,
        userId: user.id,
        conversationId: dto.conversationId,
        question: dto.question,
        onEvent: enviar,
      });
      enviar({ type: 'done', ...r });
    } catch (err) {
      enviar({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo responder',
      });
    } finally {
      res.end();
    }
  }

  @Post('ask')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Preguntar sobre los datos de subasta' })
  ask(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantId: string,
    @Body() dto: AskDto,
  ) {
    return this.service.ask({
      tenantId,
      userId: user.id,
      conversationId: dto.conversationId,
      question: dto.question,
    });
  }
}
