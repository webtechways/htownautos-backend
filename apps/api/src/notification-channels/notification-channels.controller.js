"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationChannelsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const throttler_1 = require("@nestjs/throttler");
const auth_1 = require("@htownautos/auth");
const notification_channels_service_1 = require("./notification-channels.service");
const dto_1 = require("./dto");
let NotificationChannelsController = class NotificationChannelsController {
    service;
    constructor(service) {
        this.service = service;
    }
    list(tenantId) {
        return this.service.list(tenantId);
    }
    create(tenantId, dto) {
        return this.service.create(tenantId, dto);
    }
    update(tenantId, id, dto) {
        return this.service.update(tenantId, id, dto);
    }
    remove(tenantId, id) {
        return this.service.remove(tenantId, id);
    }
    test(tenantId, id) {
        return this.service.test(tenantId, id);
    }
    startTelegramLink(tenantId, dto) {
        return this.service.startTelegramLink(tenantId, dto.label);
    }
    async telegramWebhook(secret, update) {
        const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
        if (!expected || secret !== expected) {
            throw new common_1.UnauthorizedException();
        }
        const text = update?.message?.text ?? '';
        const chatId = update?.message?.chat?.id;
        const code = text.match(/^\/start\s+(\w+)/)?.[1] ?? text.trim().match(/^\w{12}$/)?.[0];
        if (code && chatId) {
            await this.service.redeemTelegramCode(code, String(chatId));
        }
        return { ok: true };
    }
    slackOAuthUrl(tenantId, redirectUri) {
        return { url: this.service.getSlackOAuthUrl(tenantId, redirectUri) };
    }
    connectSlack(tenantId, dto) {
        const redirectUri = dto.redirectUri ||
            `${process.env.FRONTEND_URL}/dashboard/settings/integrations/slack/callback`;
        return this.service.connectSlack(tenantId, dto.code, redirectUri, dto.label);
    }
};
exports.NotificationChannelsController = NotificationChannelsController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'Canales de chat del tenant' }),
    __param(0, (0, auth_1.CurrentTenant)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], NotificationChannelsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Alta de un canal de Discord por URL de webhook' }),
    __param(0, (0, auth_1.CurrentTenant)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.CreateChannelDto]),
    __metadata("design:returntype", void 0)
], NotificationChannelsController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Etiqueta, tipos o activacion de un canal' }),
    __param(0, (0, auth_1.CurrentTenant)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, dto_1.UpdateChannelDto]),
    __metadata("design:returntype", void 0)
], NotificationChannelsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Eliminar un canal' }),
    __param(0, (0, auth_1.CurrentTenant)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], NotificationChannelsController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)(':id/test'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, throttler_1.Throttle)({ default: { limit: 10, ttl: 60_000 } }),
    (0, swagger_1.ApiOperation)({ summary: 'Enviar un mensaje de prueba al canal' }),
    __param(0, (0, auth_1.CurrentTenant)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], NotificationChannelsController.prototype, "test", null);
__decorate([
    (0, common_1.Post)('telegram/link-code'),
    (0, throttler_1.Throttle)({ default: { limit: 10, ttl: 60_000 } }),
    (0, swagger_1.ApiOperation)({ summary: 'Codigo de emparejamiento para el bot de Telegram' }),
    __param(0, (0, auth_1.CurrentTenant)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.StartTelegramLinkDto]),
    __metadata("design:returntype", void 0)
], NotificationChannelsController.prototype, "startTelegramLink", null);
__decorate([
    (0, common_1.Post)('telegram/webhook'),
    (0, auth_1.Public)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, throttler_1.Throttle)({ default: { limit: 120, ttl: 60_000 } }),
    (0, swagger_1.ApiOperation)({ summary: 'Webhook del bot de Telegram (publico)' }),
    __param(0, (0, common_1.Headers)('x-telegram-bot-api-secret-token')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], NotificationChannelsController.prototype, "telegramWebhook", null);
__decorate([
    (0, common_1.Get)('slack/oauth-url'),
    (0, swagger_1.ApiOperation)({ summary: 'URL de autorizacion de Slack' }),
    __param(0, (0, auth_1.CurrentTenant)()),
    __param(1, (0, common_1.Query)('redirectUri')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], NotificationChannelsController.prototype, "slackOAuthUrl", null);
__decorate([
    (0, common_1.Post)('slack/connect'),
    (0, swagger_1.ApiOperation)({ summary: 'Canjear el codigo de OAuth de Slack' }),
    __param(0, (0, auth_1.CurrentTenant)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.ConnectSlackDto]),
    __metadata("design:returntype", void 0)
], NotificationChannelsController.prototype, "connectSlack", null);
exports.NotificationChannelsController = NotificationChannelsController = __decorate([
    (0, swagger_1.ApiTags)('Notification Channels'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)('notification-channels'),
    __metadata("design:paramtypes", [notification_channels_service_1.NotificationChannelsService])
], NotificationChannelsController);
//# sourceMappingURL=notification-channels.controller.js.map