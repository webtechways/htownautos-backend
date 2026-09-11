import { OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { ProxyService } from '@htownautos/common';
import { UpdateCalendarConfigDto } from './dto/update-calendar-config.dto';
export declare class AuctionCalendarService implements OnModuleInit {
    private readonly prisma;
    private readonly proxy;
    private readonly logger;
    private fetching;
    constructor(prisma: PrismaService, proxy: ProxyService);
    onModuleInit(): Promise<void>;
    autoRefresh(): Promise<void>;
    fetchAndStore(): Promise<{
        count: number;
    }>;
    private centralDate;
    private buildUrl;
    getConfig(): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        refreshHours: number;
        lastFetchedAt: Date | null;
        lastError: string | null;
        lastCount: number;
    } | {
        id: string;
        refreshHours: number;
        lastFetchedAt: null;
        lastError: null;
        lastCount: number;
    }>;
    updateConfig(dto: UpdateCalendarConfigDto): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        refreshHours: number;
        lastFetchedAt: Date | null;
        lastError: string | null;
        lastCount: number;
    }>;
    getStatus(): Promise<{
        counts: Record<string, number>;
        total: number;
        config: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            refreshHours: number;
            lastFetchedAt: Date | null;
            lastError: string | null;
            lastCount: number;
        } | {
            id: string;
            refreshHours: number;
            lastFetchedAt: null;
            lastError: null;
            lastCount: number;
        };
    }>;
    list(params: {
        status?: string;
        group?: string;
        page?: number;
        limit?: number;
    }): Promise<{
        data: {
            id: string;
            saleDate: number;
            status: string;
            url: string;
            auctionGroup: string;
            locationName: string;
            locationSlug: string;
            countryCode: string | null;
            startedAt: Date;
            totalAvailableItems: number;
            monitor: boolean;
            scraperAgentId: string | null;
            scraperWorkerId: string | null;
            scraperAgent: {
                id: string;
                email: string | null;
                firstName: string;
                lastName: string;
                auction: string;
            } | null;
            scraperWorker: {
                id: string;
                label: string | null;
            } | null;
        }[];
        total: number;
        page: number;
        limit: number;
    }>;
    setMonitor(id: string, monitor: boolean): Promise<{
        id: string;
        monitor: boolean;
    }>;
}
