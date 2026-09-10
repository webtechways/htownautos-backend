import { PrismaService } from '@htownautos/prisma';
import type { CreateChannelDto, UpdateChannelDto } from './dto';
export declare class NotificationChannelsService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
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
    private serialize;
    private hint;
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
    private owned;
    test(tenantId: string, id: string): Promise<{
        ok: boolean;
    }>;
    recordResult(id: string, ok: boolean, error?: string): Promise<void>;
    startTelegramLink(tenantId: string, label: string): Promise<{
        id: string;
        linkCode: string;
        botUsername: string | null;
        deepLink: string | null;
        expiresAt: Date | null;
    }>;
    redeemTelegramCode(code: string, chatId: string): Promise<boolean>;
    getSlackOAuthUrl(tenantId: string, redirectUri: string): string;
    connectSlack(tenantId: string, code: string, redirectUri: string, label?: string): Promise<{
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
