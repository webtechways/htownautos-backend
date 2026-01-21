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

  get $transaction() {
    return this.prisma.$transaction.bind(this.prisma);
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
