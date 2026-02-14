import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private prisma: PrismaClient;
  private pool: Pool;

  constructor() {
    // Create PostgreSQL connection pool
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });

    // Create the adapter
    const adapter = new PrismaPg(this.pool);

    // Initialize PrismaClient with adapter
    this.prisma = new PrismaClient({ adapter });
  }

  get vehicleYear() {
    return this.prisma.vehicleYear;
  }

  get vehicleMake() {
    return this.prisma.vehicleMake;
  }

  get vehicleModel() {
    return this.prisma.vehicleModel;
  }

  get vehicleTrim() {
    return this.prisma.vehicleTrim;
  }

  get vehicle() {
    return this.prisma.vehicle;
  }

  get vehicleEngine() {
    return this.prisma.vehicleEngine;
  }

  get vehicleStatus() {
    return this.prisma.vehicleStatus;
  }

  get mileageUnit() {
    return this.prisma.mileageUnit;
  }

  get meta() {
    return this.prisma.meta;
  }

  get user() {
    return this.prisma.user;
  }

  get tenant() {
    return this.prisma.tenant;
  }

  get tenantUser() {
    return this.prisma.tenantUser;
  }

  get tenantInvitation() {
    return this.prisma.tenantInvitation;
  }

  get role() {
    return this.prisma.role;
  }

  get permission() {
    return this.prisma.permission;
  }

  get rolePermission() {
    return this.prisma.rolePermission;
  }

  get auditLog() {
    return this.prisma.auditLog;
  }

  get deal() {
    return this.prisma.deal;
  }

  get buyer() {
    return this.prisma.buyer;
  }

  get extraExpense() {
    return this.prisma.extraExpense;
  }

  get media() {
    return this.prisma.media;
  }

  get title() {
    return this.prisma.title;
  }

  // Parts inventory
  get part() {
    return this.prisma.part;
  }

  get partCondition() {
    return this.prisma.partCondition;
  }

  get partStatus() {
    return this.prisma.partStatus;
  }

  get partCategory() {
    return this.prisma.partCategory;
  }

  get vehiclePart() {
    return this.prisma.vehiclePart;
  }

  get uploadSession() {
    return this.prisma.uploadSession;
  }

  get marketCheckPriceCache() {
    return this.prisma.marketCheckPriceCache;
  }

  get marketCheckCompsCache() {
    return this.prisma.marketCheckCompsCache;
  }

  get marketCheckAuctionCache() {
    return this.prisma.marketCheckAuctionCache;
  }

  get copartListing() {
    return this.prisma.copartListing;
  }

  get marketCheckAuctionListing() {
    return this.prisma.marketCheckAuctionListing;
  }

  get copartFavorite() {
    return this.prisma.copartFavorite;
  }

  get scaAuctionFavorite() {
    return this.prisma.scaAuctionFavorite;
  }

  get task() {
    return this.prisma.task;
  }

  get note() {
    return this.prisma.note;
  }

  get phoneCall() {
    return this.prisma.phoneCall;
  }

  get smsMessage() {
    return this.prisma.smsMessage;
  }

  get emailMessage() {
    return this.prisma.emailMessage;
  }

  get twilioPhoneNumber() {
    return this.prisma.twilioPhoneNumber;
  }

  get callFlow() {
    return this.prisma.callFlow;
  }

  get ttsCache() {
    return this.prisma.ttsCache;
  }

  get $transaction() {
    return this.prisma.$transaction.bind(this.prisma);
  }

  get $queryRaw() {
    return this.prisma.$queryRaw.bind(this.prisma);
  }

  // Allow dynamic access to Prisma models
  getModel(modelName: string) {
    return this.prisma[modelName];
  }

  async onModuleInit() {
    await this.prisma.$connect();
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
    await this.pool.end();
  }
}
