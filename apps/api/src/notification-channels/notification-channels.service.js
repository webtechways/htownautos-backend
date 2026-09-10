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
var NotificationChannelsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationChannelsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_1 = require("@htownautos/prisma");
const common_2 = require("@htownautos/common");
const node_crypto_1 = require("node:crypto");
const LINK_CODE_TTL_MS = 15 * 60_000;
let NotificationChannelsService = NotificationChannelsService_1 = class NotificationChannelsService {
    prisma;
    logger = new common_1.Logger(NotificationChannelsService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    async list(tenantId) {
        const rows = await this.prisma.notificationChannel.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
        });
        return rows.map((r) => this.serialize(r));
    }
    serialize(r) {
        return {
            id: r.id,
            provider: r.provider,
            label: r.label,
            targetHint: this.hint(r.provider, r.target),
            types: r.types,
            isActive: r.isActive,
            pending: !r.target,
            lastSentAt: r.lastSentAt,
            lastErrorAt: r.lastErrorAt,
            lastErrorMsg: r.lastErrorMsg,
            createdAt: r.createdAt,
        };
    }
    hint(provider, target) {
        if (!target)
            return '';
        if (provider === 'discord') {
            const id = target.match(/webhooks\/(\d+)/)?.[1];
            return id ? `webhook ${id}` : 'webhook';
        }
        if (provider === 'telegram')
            return `chat ${target}`;
        return target;
    }
    async create(tenantId, dto) {
        if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(dto.target)) {
            throw new common_1.BadRequestException('La URL debe ser un webhook de Discord (https://discord.com/api/webhooks/...)');
        }
        const row = await this.prisma.notificationChannel.create({
            data: {
                tenantId,
                provider: 'discord',
                label: dto.label,
                target: dto.target,
                types: dto.types ?? [],
            },
        });
        return this.serialize(row);
    }
    async update(tenantId, id, dto) {
        await this.owned(tenantId, id);
        const row = await this.prisma.notificationChannel.update({
            where: { id },
            data: {
                ...(dto.label !== undefined ? { label: dto.label } : {}),
                ...(dto.types !== undefined ? { types: dto.types } : {}),
                ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
            },
        });
        return this.serialize(row);
    }
    async remove(tenantId, id) {
        await this.owned(tenantId, id);
        await this.prisma.notificationChannel.delete({ where: { id } });
        return { message: 'Canal eliminado' };
    }
    async owned(tenantId, id) {
        const row = await this.prisma.notificationChannel.findFirst({
            where: { id, tenantId },
        });
        if (!row)
            throw new common_1.NotFoundException('Canal no encontrado');
        return row;
    }
    async test(tenantId, id) {
        const row = await this.owned(tenantId, id);
        if (!row.target) {
            throw new common_1.BadRequestException('El canal aun no esta vinculado');
        }
        const result = await (0, common_2.sendChatMessage)({
            provider: row.provider,
            target: row.target,
            credentials: row.credentials,
        }, {
            title: 'Prueba de conexion',
            message: 'Si estas leyendo esto, el canal quedo bien configurado y recibira las notificaciones del CRM.',
            type: 'TEST',
            priority: 'normal',
            actionUrl: '/dashboard/notifications',
        });
        await this.recordResult(id, result.ok, result.error);
        if (!result.ok)
            throw new common_1.BadRequestException(result.error);
        return { ok: true };
    }
    async recordResult(id, ok, error) {
        await this.prisma.notificationChannel
            .update({
            where: { id },
            data: ok
                ? { lastSentAt: new Date(), lastErrorAt: null, lastErrorMsg: null }
                : { lastErrorAt: new Date(), lastErrorMsg: error?.slice(0, 500) ?? 'error' },
        })
            .catch(() => undefined);
    }
    async startTelegramLink(tenantId, label) {
        const botUsername = process.env.TELEGRAM_BOT_USERNAME;
        if (!process.env.TELEGRAM_BOT_TOKEN) {
            throw new common_1.BadRequestException('Telegram no esta configurado en el servidor (falta TELEGRAM_BOT_TOKEN)');
        }
        const linkCode = (0, node_crypto_1.randomBytes)(6).toString('hex');
        const row = await this.prisma.notificationChannel.create({
            data: {
                tenantId,
                provider: 'telegram',
                label,
                target: '',
                linkCode,
                linkCodeExpiresAt: new Date(Date.now() + LINK_CODE_TTL_MS),
            },
        });
        return {
            id: row.id,
            linkCode,
            botUsername: botUsername ?? null,
            deepLink: botUsername ? `https://t.me/${botUsername}?start=${linkCode}` : null,
            expiresAt: row.linkCodeExpiresAt,
        };
    }
    async redeemTelegramCode(code, chatId) {
        const row = await this.prisma.notificationChannel.findUnique({
            where: { linkCode: code },
        });
        if (!row)
            return false;
        if (row.linkCodeExpiresAt && row.linkCodeExpiresAt < new Date())
            return false;
        await this.prisma.notificationChannel.update({
            where: { id: row.id },
            data: { target: String(chatId), linkCode: null, linkCodeExpiresAt: null },
        });
        this.logger.log(`[Chat] Telegram vinculado para tenant=${row.tenantId}`);
        return true;
    }
    getSlackOAuthUrl(tenantId, redirectUri) {
        const clientId = process.env.SLACK_CLIENT_ID;
        if (!clientId) {
            throw new common_1.BadRequestException('Slack no esta configurado en el servidor (falta SLACK_CLIENT_ID)');
        }
        const params = new URLSearchParams({
            client_id: clientId,
            scope: 'chat:write,channels:read',
            redirect_uri: redirectUri,
            state: tenantId,
        });
        return `https://slack.com/oauth/v2/authorize?${params}`;
    }
    async connectSlack(tenantId, code, redirectUri, label) {
        const clientId = process.env.SLACK_CLIENT_ID;
        const clientSecret = process.env.SLACK_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
            throw new common_1.BadRequestException('Slack no esta configurado en el servidor');
        }
        const res = await fetch('https://slack.com/api/oauth.v2.access', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                code,
                redirect_uri: redirectUri,
            }),
            signal: AbortSignal.timeout(15_000),
        });
        const json = (await res.json());
        if (!json.ok || !json.access_token) {
            throw new common_1.BadRequestException(`Slack: ${json.error ?? 'no se pudo conectar'}`);
        }
        const channelId = json.incoming_webhook?.channel_id;
        if (!channelId) {
            throw new common_1.BadRequestException('Slack no devolvio ningun canal. Elige un canal al autorizar la app.');
        }
        const row = await this.prisma.notificationChannel.create({
            data: {
                tenantId,
                provider: 'slack',
                label: label ||
                    `${json.team?.name ?? 'Slack'} ${json.incoming_webhook?.channel ?? ''}`.trim(),
                target: channelId,
                credentials: { botToken: json.access_token },
            },
        });
        return this.serialize(row);
    }
};
exports.NotificationChannelsService = NotificationChannelsService;
exports.NotificationChannelsService = NotificationChannelsService = NotificationChannelsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_1.PrismaService])
], NotificationChannelsService);
//# sourceMappingURL=notification-channels.service.js.map