"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuctionCalendarModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_1 = require("@htownautos/prisma");
const common_2 = require("@htownautos/common");
const auction_calendar_service_1 = require("./auction-calendar.service");
const auction_calendar_controller_1 = require("./auction-calendar.controller");
let AuctionCalendarModule = class AuctionCalendarModule {
};
exports.AuctionCalendarModule = AuctionCalendarModule;
exports.AuctionCalendarModule = AuctionCalendarModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_1.PrismaModule],
        controllers: [auction_calendar_controller_1.AuctionCalendarController],
        providers: [auction_calendar_service_1.AuctionCalendarService, common_2.ProxyService, common_2.AgentAssignmentService],
    })
], AuctionCalendarModule);
//# sourceMappingURL=auction-calendar.module.js.map