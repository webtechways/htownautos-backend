"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationChannelsModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_1 = require("@htownautos/prisma");
const notification_channels_service_1 = require("./notification-channels.service");
const notification_channels_controller_1 = require("./notification-channels.controller");
let NotificationChannelsModule = class NotificationChannelsModule {
};
exports.NotificationChannelsModule = NotificationChannelsModule;
exports.NotificationChannelsModule = NotificationChannelsModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_1.PrismaModule],
        controllers: [notification_channels_controller_1.NotificationChannelsController],
        providers: [notification_channels_service_1.NotificationChannelsService],
        exports: [notification_channels_service_1.NotificationChannelsService],
    })
], NotificationChannelsModule);
//# sourceMappingURL=notification-channels.module.js.map