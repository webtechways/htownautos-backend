import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, HttpStatus, Logger, Post, Query, Req } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import * as express from 'express';
import { Public } from '@htownautos/auth';
import { MetaWebhookService } from './meta-webhook.service';

/**
 * Meta webhook for Messenger, Instagram and WhatsApp Cloud — one endpoint
 * for all three, routed internally by `MetaWebhookService` per
 * docs/social-suite/CONTRACT.md §3.7. `@Public()`: Meta doesn't send a
 * Clerk JWT or our API key. Body arrives as a raw `Buffer` (see
 * `apps/api/src/main.ts`'s body-parser carve-out for this exact path) so
 * `X-Hub-Signature-256` can be checked against the untouched bytes.
 */
@Controller('social/webhooks/meta')
export class MetaWebhookController {
  private readonly logger = new Logger(MetaWebhookController.name);

  constructor(private readonly service: MetaWebhookService) {}

  @Get()
  @Public()
  @ApiExcludeEndpoint()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    if (!this.service.verifyHandshake(mode, verifyToken)) {
      throw new ForbiddenException('Invalid verify token');
    }
    return challenge;
  }

  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async receive(@Req() req: express.Request, @Headers('x-hub-signature-256') signature: string | undefined): Promise<{ received: true }> {
    const rawBody = req.body as Buffer;

    if (!this.service.verifySignature(rawBody, signature)) {
      this.logger.warn('Firma X-Hub-Signature-256 inválida');
      throw new ForbiddenException('Invalid signature');
    }

    let parsed: Parameters<MetaWebhookService['handle']>[0];
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      this.logger.warn('Cuerpo del webhook de Meta no es JSON válido');
      return { received: true };
    }

    // Always ack fast (§3.7): process inline but never let a normalization bug turn into a 500 — Meta retries aggressively on non-2xx.
    try {
      await this.service.handle(parsed);
    } catch (err) {
      this.logger.error(`receive: ${(err as Error).message}`);
    }

    return { received: true };
  }
}
