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
var AuctionCalendarService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuctionCalendarService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const prisma_1 = require("@htownautos/prisma");
const common_2 = require("@htownautos/common");
const CONFIG_ID = 'singleton';
const CALENDAR_URL = 'https://www.autobidmaster.com/en/data/v2/auction-calendar';
const BROWSER_HEADERS = {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9',
    priority: 'u=1, i',
    referer: 'https://www.autobidmaster.com/en/search/calendar/?view=list&page=1',
    'sec-ch-ua': '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
};
let AuctionCalendarService = AuctionCalendarService_1 = class AuctionCalendarService {
    prisma;
    proxy;
    logger = new common_1.Logger(AuctionCalendarService_1.name);
    fetching = false;
    constructor(prisma, proxy) {
        this.prisma = prisma;
        this.proxy = proxy;
    }
    async onModuleInit() {
        const cfg = await this.prisma.auctionCalendarConfig.findUnique({ where: { id: CONFIG_ID } });
        if (!cfg?.lastFetchedAt) {
            this.fetchAndStore().catch((e) => this.logger.warn(`[Calendar] Initial fetch failed: ${e.message}`));
        }
    }
    async autoRefresh() {
        try {
            const cfg = await this.prisma.auctionCalendarConfig.findUnique({ where: { id: CONFIG_ID } });
            const hours = cfg?.refreshHours ?? 6;
            if (hours <= 0)
                return;
            const last = cfg?.lastFetchedAt;
            if (last && Date.now() - last.getTime() < hours * 3_600_000)
                return;
            await this.fetchAndStore();
        }
        catch (err) {
            this.logger.error(`[Calendar] Auto-refresh failed: ${err.message}`);
        }
    }
    async fetchAndStore() {
        if (this.fetching)
            return { count: 0 };
        this.fetching = true;
        try {
            this.logger.log('[Calendar] Fetching AutoBidMaster auction calendar…');
            const res = await this.proxy.fetchViaProxy(CALENDAR_URL, {
                headers: BROWSER_HEADERS,
                maxAttempts: 4,
            });
            if (!res.ok)
                throw new Error(`AutoBidMaster returned ${res.status}`);
            const json = (await res.json());
            const root = Array.isArray(json) ? json[0] : json;
            const auctions = root?.auctions ?? {};
            const previous = await this.prisma.auctionCalendarEntry.findMany({
                where: {
                    OR: [
                        { monitor: true },
                        { scraperAgentId: { not: null } },
                        { scraperWorkerId: { not: null } },
                    ],
                },
                select: {
                    locationSourceId: true,
                    startedAt: true,
                    monitor: true,
                    scraperAgentId: true,
                    scraperWorkerId: true,
                },
            });
            const keyOf = (m) => `${m.locationSourceId}|${m.startedAt.toISOString()}`;
            const monitored = new Set(previous.filter((m) => m.monitor).map(keyOf));
            const assignedAgent = new Map(previous.filter((m) => m.scraperAgentId).map((m) => [keyOf(m), m.scraperAgentId]));
            const claimedBy = new Map(previous
                .filter((m) => m.scraperWorkerId)
                .map((m) => [keyOf(m), m.scraperWorkerId]));
            const now = new Date();
            const rows = [];
            const seen = new Set();
            for (const status of Object.keys(auctions)) {
                const groups = auctions[status] ?? {};
                for (const group of Object.keys(groups)) {
                    for (const a of (groups[group] ?? [])) {
                        const loc = a.location ?? {};
                        const sourceId = loc.sourceId;
                        const slug = loc.slug;
                        const startedAtIso = a.startedAt;
                        if (sourceId == null || !slug || !startedAtIso)
                            continue;
                        const startedAt = new Date(startedAtIso);
                        if (isNaN(startedAt.getTime()))
                            continue;
                        const key = `${sourceId}|${startedAt.toISOString()}`;
                        if (seen.has(key))
                            continue;
                        seen.add(key);
                        const saleDate = this.centralDate(startedAt);
                        rows.push({
                            status,
                            auctionGroup: group,
                            locationSourceId: sourceId,
                            catalogSourceId: loc.catalogSourceId ?? null,
                            locationName: loc.name ?? a.locationName ?? slug,
                            locationSlug: slug,
                            countryCode: loc.countryCode ?? null,
                            region: loc.region ?? null,
                            latitude: loc.point?.latitude ?? null,
                            longitude: loc.point?.longitude ?? null,
                            startedAt,
                            saleDate,
                            inventoryAuction: a.inventoryAuction ?? null,
                            totalAvailableItems: a.totalAvailableItems ?? 0,
                            url: this.buildUrl(slug, saleDate),
                            monitor: monitored.has(key),
                            scraperAgentId: assignedAgent.get(key) ?? null,
                            scraperWorkerId: claimedBy.get(key) ?? null,
                            raw: a,
                            fetchedAt: now,
                        });
                    }
                }
            }
            await this.prisma.$transaction([
                this.prisma.auctionCalendarEntry.deleteMany({}),
                this.prisma.auctionCalendarEntry.createMany({ data: rows, skipDuplicates: true }),
            ]);
            await this.prisma.auctionCalendarConfig.upsert({
                where: { id: CONFIG_ID },
                update: { lastFetchedAt: now, lastCount: rows.length, lastError: null },
                create: { id: CONFIG_ID, lastFetchedAt: now, lastCount: rows.length },
            });
            this.logger.log(`[Calendar] Stored ${rows.length} auction calendar entries`);
            return { count: rows.length };
        }
        catch (err) {
            await this.prisma.auctionCalendarConfig
                .upsert({
                where: { id: CONFIG_ID },
                update: { lastError: err.message },
                create: { id: CONFIG_ID, lastError: err.message },
            })
                .catch(() => undefined);
            this.logger.error(`[Calendar] Fetch/store failed: ${err.message}`);
            throw err;
        }
        finally {
            this.fetching = false;
        }
    }
    centralDate(d) {
        const s = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Chicago',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(d);
        return parseInt(s.replace(/-/g, ''), 10);
    }
    buildUrl(slug, saleDate) {
        return `https://www.autobidmaster.com/en/search/sale-location-id-${slug}/sale-date-${saleDate}`;
    }
    async getConfig() {
        const cfg = await this.prisma.auctionCalendarConfig.findUnique({ where: { id: CONFIG_ID } });
        return cfg ?? { id: CONFIG_ID, refreshHours: 6, lastFetchedAt: null, lastError: null, lastCount: 0 };
    }
    async updateConfig(dto) {
        return this.prisma.auctionCalendarConfig.upsert({
            where: { id: CONFIG_ID },
            update: { ...dto },
            create: { id: CONFIG_ID, ...dto },
        });
    }
    async getStatus() {
        const [grouped, config] = await Promise.all([
            this.prisma.auctionCalendarEntry.groupBy({ by: ['status'], _count: { _all: true } }),
            this.getConfig(),
        ]);
        const counts = { live: 0, later: 0, upcoming: 0, ended: 0 };
        for (const g of grouped)
            counts[g.status] = g._count._all;
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        return { counts, total, config };
    }
    async list(params) {
        const p = Math.max(1, Math.floor(Number(params.page) || 1));
        const l = Math.min(200, Math.max(1, Math.floor(Number(params.limit) || 50)));
        const where = {
            ...(params.status ? { status: params.status } : {}),
            ...(params.group ? { auctionGroup: params.group } : {}),
        };
        const [rows, total] = await Promise.all([
            this.prisma.auctionCalendarEntry.findMany({
                where,
                orderBy: [{ startedAt: 'asc' }, { locationName: 'asc' }],
                skip: (p - 1) * l,
                take: l,
                select: {
                    id: true,
                    status: true,
                    auctionGroup: true,
                    locationName: true,
                    locationSlug: true,
                    countryCode: true,
                    startedAt: true,
                    saleDate: true,
                    totalAvailableItems: true,
                    url: true,
                    monitor: true,
                    scraperAgentId: true,
                    scraperAgent: {
                        select: { id: true, firstName: true, lastName: true, email: true, auction: true },
                    },
                    scraperWorkerId: true,
                    scraperWorker: { select: { id: true, label: true } },
                },
            }),
            this.prisma.auctionCalendarEntry.count({ where }),
        ]);
        return { data: rows, total, page: p, limit: l };
    }
    async setMonitor(id, monitor) {
        return this.prisma.auctionCalendarEntry.update({
            where: { id },
            data: { monitor },
            select: { id: true, monitor: true },
        });
    }
};
exports.AuctionCalendarService = AuctionCalendarService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_HOUR),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AuctionCalendarService.prototype, "autoRefresh", null);
exports.AuctionCalendarService = AuctionCalendarService = AuctionCalendarService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_1.PrismaService,
        common_2.ProxyService])
], AuctionCalendarService);
//# sourceMappingURL=auction-calendar.service.js.map