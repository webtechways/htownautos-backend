import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post,
} from '@nestjs/common';
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
