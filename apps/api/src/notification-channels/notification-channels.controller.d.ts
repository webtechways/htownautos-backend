import { NotificationChannelsService } from './notification-channels.service';
import { CreateChannelDto, ConnectSlackDto, StartTelegramLinkDto, UpdateChannelDto } from './dto';
export declare class NotificationChannelsController {
    private readonly service;
    constructor(service: NotificationChannelsService);
    list(tenantId: string): Promise<{
        id: any;
        provider: any;
        label: any;
        targetHint: string;
        types: any;
        isActive: any;
        pending: boolean;
        lastSentAt: any;
        lastErrorAt: any;
        lastErrorMsg: any;
        createdAt: any;
    }[]>;
    create(tenantId: string, dto: CreateChannelDto): Promise<{
        id: any;
        provider: any;
        label: any;
        targetHint: string;
        types: any;
        isActive: any;
        pending: boolean;
        lastSentAt: any;
        lastErrorAt: any;
        lastErrorMsg: any;
        createdAt: any;
    }>;
    update(tenantId: string, id: string, dto: UpdateChannelDto): Promise<{
        id: any;
        provider: any;
        label: any;
        targetHint: string;
        types: any;
        isActive: any;
        pending: boolean;
        lastSentAt: any;
        lastErrorAt: any;
        lastErrorMsg: any;
        createdAt: any;
    }>;
    remove(tenantId: string, id: string): Promise<{
        message: string;
    }>;
    test(tenantId: string, id: string): Promise<{
        ok: boolean;
    }>;
    startTelegramLink(tenantId: string, dto: StartTelegramLinkDto): Promise<{
        id: string;
        linkCode: string;
        botUsername: string | null;
        deepLink: string | null;
        expiresAt: Date | null;
    }>;
    telegramWebhook(secret: string, update: any): Promise<{
        ok: boolean;
    }>;
    slackOAuthUrl(tenantId: string, redirectUri: string): {
        url: string;
    };
    connectSlack(tenantId: string, dto: ConnectSlackDto): Promise<{
        id: any;
        provider: any;
        label: any;
        targetHint: string;
        types: any;
        isActive: any;
        pending: boolean;
        lastSentAt: any;
        lastErrorAt: any;
        lastErrorMsg: any;
        createdAt: any;
    }>;
}
