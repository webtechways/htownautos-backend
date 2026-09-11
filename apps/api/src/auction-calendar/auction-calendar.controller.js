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
exports.AuctionCalendarController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("@htownautos/auth");
const common_2 = require("@htownautos/common");
const auction_calendar_service_1 = require("./auction-calendar.service");
const update_calendar_config_dto_1 = require("./dto/update-calendar-config.dto");
let AuctionCalendarController = class AuctionCalendarController {
    service;
    assignment;
    constructor(service, assignment) {
        this.service = service;
        this.assignment = assignment;
    }
    status() {
        return this.service.getStatus();
    }
    list(status, group, page, limit) {
        return this.service.list({ status, group, page: Number(page), limit: Number(limit) });
    }
    updateConfig(dto) {
        return this.service.updateConfig(dto);
    }
    refresh() {
        return this.service.fetchAndStore();
    }
    assignAgents() {
        return this.assignment.runAssignment();
    }
    setMonitor(id, body) {
        return this.service.setMonitor(id, !!body.monitor);
    }
};
exports.AuctionCalendarController = AuctionCalendarController;
__decorate([
    (0, common_1.Get)('status'),
    (0, swagger_1.ApiOperation)({ summary: 'Counts per status + refresh config' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AuctionCalendarController.prototype, "status", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'List calendar entries (with pre-built links)' }),
    __param(0, (0, common_1.Query)('status')),
    __param(1, (0, common_1.Query)('group')),
    __param(2, (0, common_1.Query)('page')),
    __param(3, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], AuctionCalendarController.prototype, "list", null);
__decorate([
    (0, common_1.Patch)('config'),
    (0, swagger_1.ApiOperation)({ summary: 'Update refresh cadence' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [update_calendar_config_dto_1.UpdateCalendarConfigDto]),
    __metadata("design:returntype", void 0)
], AuctionCalendarController.prototype, "updateConfig", null);
__decorate([
    (0, common_1.Post)('refresh'),
    (0, swagger_1.ApiOperation)({ summary: 'Fetch the calendar from AutoBidMaster now' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AuctionCalendarController.prototype, "refresh", null);
__decorate([
    (0, common_1.Post)('assign-agents'),
    (0, swagger_1.ApiOperation)({
        summary: 'Repartir ahora las subastas sin agente entre los agentes activos',
        description: 'Lo mismo que hace el job diario de las 6:00 (hora de Houston): primero suelta ' +
            'las subastas ya celebradas o sin inventario, y luego reparte las próximas que ' +
            'no tengan agente. Es idempotente.',
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AuctionCalendarController.prototype, "assignAgents", null);
__decorate([
    (0, common_1.Patch)(':id/monitor'),
    (0, swagger_1.ApiOperation)({ summary: 'Toggle the monitor flag on a calendar entry' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], AuctionCalendarController.prototype, "setMonitor", null);
exports.AuctionCalendarController = AuctionCalendarController = __decorate([
    (0, swagger_1.ApiTags)('Auction calendar'),
    (0, common_1.Controller)('auction-calendar'),
    (0, common_1.UseGuards)(auth_1.ClerkJwtGuard),
    (0, swagger_1.ApiBearerAuth)(),
    __metadata("design:paramtypes", [auction_calendar_service_1.AuctionCalendarService,
        common_2.AgentAssignmentService])
], AuctionCalendarController);
//# sourceMappingURL=auction-calendar.controller.js.map