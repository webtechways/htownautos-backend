import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentTenant, Public } from '@htownautos/auth';
import { NotificationChannelsService } from './notification-channels.service';
import {
  CreateChannelDto,
  ConnectSlackDto,
  StartTelegramLinkDto,
  UpdateChannelDto,
} from './dto';

@ApiTags('Notification Channels')
@ApiBearerAuth()
@Controller('notification-channels')
export class NotificationChannelsController {
  constructor(private readonly service: NotificationChannelsService) {}

  @Get()
  @ApiOperation({ summary: 'Canales de chat del tenant' })
  list(@CurrentTenant() tenantId: string) {
    return this.service.list(tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Alta de un canal de Discord por URL de webhook' })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateChannelDto) {
    return this.service.create(tenantId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Etiqueta, tipos o activacion de un canal' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChannelDto,
  ) {
    return this.service.update(tenantId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar un canal' })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(tenantId, id);
  }

  /** Tope propio: cada prueba es una peticion saliente a un tercero. */
  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Enviar un mensaje de prueba al canal' })
  test(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.test(tenantId, id);
  }

  // ── Telegram ──────────────────────────────────────────────────────────────

  @Post('telegram/link-code')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Codigo de emparejamiento para el bot de Telegram' })
  startTelegramLink(
    @CurrentTenant() tenantId: string,
    @Body() dto: StartTelegramLinkDto,
  ) {
    return this.service.startTelegramLink(tenantId, dto.label);
  }

  /**
   * Webhook del bot. Publico por necesidad —lo llama Telegram, no un usuario— y
   * por eso se valida con el secreto que Telegram devuelve en cada peticion.
   *
   * Contesta 200 siempre que el secreto sea correcto: un error aqui hace que
   * Telegram reintente el mismo update en bucle.
   */
  @Post('telegram/webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Webhook del bot de Telegram (publico)' })
  async telegramWebhook(
    @Headers('x-telegram-bot-api-secret-token') secret: string,
    @Body() update: any,
  ) {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!expected || secret !== expected) {
      throw new UnauthorizedException();
    }

    const text: string = update?.message?.text ?? '';
    const chatId = update?.message?.chat?.id;
    // El deep link llega como "/start <codigo>"; tambien vale pegar el codigo.
    const code = text.match(/^\/start\s+(\w+)/)?.[1] ?? text.trim().match(/^\w{12}$/)?.[0];

    if (code && chatId) {
      await this.service.redeemTelegramCode(code, String(chatId));
    }
    return { ok: true };
  }

  // ── Slack ─────────────────────────────────────────────────────────────────

  @Get('slack/oauth-url')
  @ApiOperation({ summary: 'URL de autorizacion de Slack' })
  slackOAuthUrl(
    @CurrentTenant() tenantId: string,
    @Query('redirectUri') redirectUri: string,
  ) {
    return { url: this.service.getSlackOAuthUrl(tenantId, redirectUri) };
  }

  @Post('slack/connect')
  @ApiOperation({ summary: 'Canjear el codigo de OAuth de Slack' })
  connectSlack(
    @CurrentTenant() tenantId: string,
    @Body() dto: ConnectSlackDto,
  ) {
    const redirectUri =
      dto.redirectUri ||
      `${process.env.FRONTEND_URL}/dashboard/settings/integrations/slack/callback`;
    return this.service.connectSlack(tenantId, dto.code, redirectUri, dto.label);
  }
}
