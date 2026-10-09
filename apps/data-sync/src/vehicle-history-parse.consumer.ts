import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  RabbitMQService,
  VEHICLE_HISTORY_PARSE_QUEUE,
  type VehicleHistoryParseMessage,
} from '@htownautos/rabbitmq';
import { PrismaService } from '@htownautos/prisma';
import { S3Service } from '@htownautos/common';
import { parseVehicleHistory, PARSER_VERSION, type ParsedVehicleHistory } from '@htownautos/vehicle-history';

/**
 * Parses a stored Carfax/AutoCheck report (HTML or PDF, carfax_reports or
 * vehicle_history_reports — disjoint s3Keys) into structured rows.
 *
 * Serial (prefetch 1): the parser does CPU/LLM work, not worth racing against
 * itself on a single-node worker.
 */
@Injectable()
export class VehicleHistoryParseConsumer implements OnModuleInit {
  private readonly logger = new Logger(VehicleHistoryParseConsumer.name);

  constructor(
    private readonly rabbitMQ: RabbitMQService,
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  async onModuleInit() {
    await this.rabbitMQ.consume(
      VEHICLE_HISTORY_PARSE_QUEUE,
      async (raw) => {
        await this.handle(raw as VehicleHistoryParseMessage);
      },
      { prefetch: 1 },
    );
  }

  private async handle(msg: VehicleHistoryParseMessage): Promise<void> {
    if (process.env.VH_PARSE_ENABLED === 'false') return;
    const s3Key = msg?.s3Key;
    if (!s3Key) return;

    const existing = await this.prisma.vehicleHistoryParsed.findUnique({ where: { s3Key } });
    if (existing && existing.parserVersion >= PARSER_VERSION && existing.status !== 'failed') {
      return;
    }

    const found = await this.findSource(s3Key);
    if (!found) {
      this.logger.warn(`[VhParse] s3Key not found in either source table: ${s3Key}`);
      return;
    }

    let parsed: ParsedVehicleHistory;
    try {
      const body = await this.s3.downloadBuffer(s3Key);
      parsed = await parseVehicleHistory({
        body,
        contentType: found.contentType,
        vin: found.vin,
        reportType: found.reportType,
      });
    } catch (err) {
      this.logger.error(`[VhParse] failed s3Key=${s3Key}: ${(err as Error).message}`);
      await this.upsert(s3Key, found, {
        vin: found.vin ?? '',
        reportType: found.reportType === 'autocheck' ? 'autocheck' : 'carfax',
        template: 'unknown',
        status: 'failed',
        confidence: 0,
        reportDate: null,
        summary: {
          accidentCount: null,
          damageReportCount: null,
          structuralDamage: null,
          airbagDeployed: null,
          titleBrands: [],
          brandedTitle: null,
          totalLoss: null,
          salvage: null,
          flood: null,
          lemon: null,
          ownerCount: null,
          lastOdometer: null,
          lastOdometerDate: null,
          odometerRollbackSuspected: null,
          usageTypes: [],
          serviceRecordCount: null,
          openRecallCount: null,
          lastReportedState: null,
        },
        odometerReadings: [],
        damageEvents: [],
        titleEvents: [],
        ownershipPeriods: [],
        sections: {},
        llmSections: [],
        raw: null,
      }, (err as Error).message);
      return;
    }

    await this.upsert(s3Key, found, parsed, null);
  }

  private async findSource(
    s3Key: string,
  ): Promise<{ source: 'carfax_reports' | 'vehicle_history_reports'; sourceId: string; vin: string | null; reportType: string; contentType: string } | null> {
    const carfax = await this.prisma.carfaxReport.findFirst({ where: { s3Key } });
    if (carfax) {
      return {
        source: 'carfax_reports',
        sourceId: carfax.id,
        vin: carfax.vin,
        reportType: 'carfax',
        contentType: s3Key.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/html',
      };
    }
    const vh = await this.prisma.vehicleHistoryReport.findFirst({ where: { s3Key } });
    if (vh) {
      return {
        source: 'vehicle_history_reports',
        sourceId: vh.id,
        vin: vh.vin,
        reportType: vh.reportType,
        contentType: vh.contentType,
      };
    }
    return null;
  }

  private async upsert(
    s3Key: string,
    found: { source: string; sourceId: string },
    parsed: ParsedVehicleHistory,
    error: string | null,
  ): Promise<void> {
    const data = {
      s3Key,
      source: found.source,
      sourceId: found.sourceId,
      vin: parsed.vin,
      reportType: parsed.reportType,
      template: parsed.template,
      parserVersion: PARSER_VERSION,
      status: parsed.status,
      confidence: parsed.confidence,
      llmUsed: parsed.llmSections.length > 0,
      llmSections: parsed.llmSections,
      reportDate: parsed.reportDate ? new Date(parsed.reportDate) : null,
      accidentCount: parsed.summary.accidentCount,
      damageReportCount: parsed.summary.damageReportCount,
      structuralDamage: parsed.summary.structuralDamage,
      airbagDeployed: parsed.summary.airbagDeployed,
      titleBrands: parsed.summary.titleBrands,
      brandedTitle: parsed.summary.brandedTitle,
      totalLoss: parsed.summary.totalLoss,
      salvage: parsed.summary.salvage,
      flood: parsed.summary.flood,
      lemon: parsed.summary.lemon,
      ownerCount: parsed.summary.ownerCount,
      lastOdometer: parsed.summary.lastOdometer,
      lastOdometerDate: parsed.summary.lastOdometerDate ? new Date(parsed.summary.lastOdometerDate) : null,
      odometerRollbackSuspected: parsed.summary.odometerRollbackSuspected,
      usageTypes: parsed.summary.usageTypes,
      serviceRecordCount: parsed.summary.serviceRecordCount,
      openRecallCount: parsed.summary.openRecallCount,
      lastReportedState: parsed.summary.lastReportedState,
      raw: (parsed.raw ?? null) as object,
      error,
      parsedAt: new Date(),
    };

    await this.prisma.$transaction(async (tx) => {
      const row = await tx.vehicleHistoryParsed.upsert({
        where: { s3Key },
        create: data,
        update: data,
      });

      await tx.vhOdometerReading.deleteMany({ where: { parsedId: row.id } });
      await tx.vhDamageEvent.deleteMany({ where: { parsedId: row.id } });
      await tx.vhTitleEvent.deleteMany({ where: { parsedId: row.id } });
      await tx.vhOwnershipPeriod.deleteMany({ where: { parsedId: row.id } });

      if (parsed.odometerReadings.length) {
        await tx.vhOdometerReading.createMany({
          data: parsed.odometerReadings.map((r) => ({
            parsedId: row.id,
            vin: parsed.vin,
            date: r.date ? new Date(r.date) : null,
            miles: r.miles,
            source: r.source,
          })),
        });
      }
      if (parsed.damageEvents.length) {
        await tx.vhDamageEvent.createMany({
          data: parsed.damageEvents.map((d) => ({
            parsedId: row.id,
            vin: parsed.vin,
            date: d.date ? new Date(d.date) : null,
            kind: d.kind,
            severity: d.severity,
            area: d.area,
            airbag: d.airbag,
            description: d.description,
          })),
        });
      }
      if (parsed.titleEvents.length) {
        await tx.vhTitleEvent.createMany({
          data: parsed.titleEvents.map((t) => ({
            parsedId: row.id,
            vin: parsed.vin,
            date: t.date ? new Date(t.date) : null,
            state: t.state,
            brand: t.brand,
            kind: t.kind,
            odometer: t.odometer,
          })),
        });
      }
      if (parsed.ownershipPeriods.length) {
        await tx.vhOwnershipPeriod.createMany({
          data: parsed.ownershipPeriods.map((o) => ({
            parsedId: row.id,
            vin: parsed.vin,
            ownerIndex: o.ownerIndex,
            start: o.start ? new Date(o.start) : null,
            end: o.end ? new Date(o.end) : null,
            usageType: o.usageType,
            state: o.state,
            milesPerYear: o.milesPerYear,
          })),
        });
      }
    });
  }
}
