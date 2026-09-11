import { AgentAssignmentService } from '@htownautos/common';
import { AuctionCalendarService } from './auction-calendar.service';
import { UpdateCalendarConfigDto } from './dto/update-calendar-config.dto';
export declare class AuctionCalendarController {
    private readonly service;
    private readonly assignment;
    constructor(service: AuctionCalendarService, assignment: AgentAssignmentService);
    status(): Promise<{
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
    list(status?: string, group?: string, page?: string, limit?: string): Promise<{
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
    updateConfig(dto: UpdateCalendarConfigDto): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        refreshHours: number;
        lastFetchedAt: Date | null;
        lastError: string | null;
        lastCount: number;
    }>;
    refresh(): Promise<{
        count: number;
    }>;
    assignAgents(): Promise<import("@htownautos/common").AssignmentResult & {
        released: number;
    }>;
    setMonitor(id: string, body: {
        monitor: boolean;
    }): Promise<{
        id: string;
        monitor: boolean;
    }>;
}
