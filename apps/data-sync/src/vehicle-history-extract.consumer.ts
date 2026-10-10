import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  RabbitMQService,
  VEHICLE_HISTORY_EXTRACT_QUEUE,
  type VehicleHistoryExtractMessage,
} from '@htownautos/rabbitmq';
import { PrismaService } from '@htownautos/prisma';
import { S3Service } from '@htownautos/common';
import {
  extractReport,
  isExtractEnabled,
  getExtractModel,
  getExtractFallbackModel,
  validateReport,
  computeCostUsd,
  scrapeReport,
  PROMPT_VERSION,
  type ExtractResult,
  type VehicleHistoryReportExtract,
} from '@htownautos/vehicle-history';

/** 'scrape' (default) runs the deterministic cheerio parser with no OpenAI call/cost; 'openai' keeps the old LLM extraction path. */
const SCRAPER_MODEL_NAME = 'scraper-v1';
function getExtractMethod(): 'scrape' | 'openai' {
  return process.env.VH_EXTRACT_METHOD === 'openai' ? 'openai' : 'scrape';
}

const MAX_ATTEMPTS = 3;
const BACKOFFS_MS = [2000, 8000];

type SourceFound = {
  sourceTable: 'carfax_reports' | 'vehicle_history_reports';
  sourceId: string;
  vin: string | null;
  contentType: string;
  reportType: string;
};

type AttemptOutcome = 'success' | 'invalid' | 'error' | 'budget_exceeded';

interface AttemptResult {
  outcome: AttemptOutcome;
  result?: ExtractResult;
  cost?: number | null;
  error?: string;
  errObj?: unknown;
  model: string;
}

/**
 * Runs the OpenAI structured-output extraction for a stored report. Serial
 * (prefetch 1) like the deterministic parser's consumer — this is an LLM
 * call, there is no benefit to racing it against itself on one worker.
 */
@Injectable()
export class VehicleHistoryExtractConsumer implements OnModuleInit {
  private readonly logger = new Logger(VehicleHistoryExtractConsumer.name);

  constructor(
    private readonly rabbitMQ: RabbitMQService,
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  async onModuleInit() {
    await this.rabbitMQ.consume(
      VEHICLE_HISTORY_EXTRACT_QUEUE,
      async (raw) => {
        await this.handle(raw as VehicleHistoryExtractMessage);
      },
      { prefetch: 1 },
    );
  }

  private async handle(msg: VehicleHistoryExtractMessage): Promise<void> {
    if (process.env.VH_EXTRACT_ENABLED === 'false') return;
    const s3Key = msg?.s3Key;
    if (!s3Key) return;
    const trigger = msg.trigger || 'manual';

    const existing = await this.prisma.vehicleHistoryExtraction.findUnique({ where: { s3Key } });
    if (existing && existing.status === 'ok' && existing.promptVersion >= PROMPT_VERSION && !msg.force) {
      return;
    }

    const found = await this.findSource(s3Key);
    if (!found) {
      this.logger.warn(`[VhExtract] s3Key not found in either source table: ${s3Key}`);
      return;
    }

    let body: Buffer;
    try {
      body = await this.s3.downloadBuffer(s3Key);
    } catch (err) {
      this.logger.error(`[VhExtract] could not download ${s3Key}: ${(err as Error).message}`);
      return;
    }

    if (getExtractMethod() === 'scrape') {
      await this.handleScrape({ s3Key, found, trigger, msg, body });
      return;
    }

    if (!isExtractEnabled()) {
      await this.writeLog({ s3Key, found, trigger, msg, model: getExtractModel(), attempt: 1, status: 'skipped', error: 'VH_EXTRACT_ENABLED=false or no API key' });
      return;
    }

    let result: ExtractResult | null = null;
    let lastError: string | null = null;
    let lastOutcome: AttemptOutcome | null = null;
    let costUsdThisRun = 0;
    let finalModel = getExtractModel();
    let attempt = 0;
    let budgetExceeded = false;

    // Primary model: up to MAX_ATTEMPTS, retrying api errors (backoff) and
    // invalid-output (model slipped past date normalization into something
    // still unusable) with the same auto-selected model.
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      attempt = i;
      const r = await this.attemptExtraction({ s3Key, found, trigger, msg, attempt, body });
      finalModel = r.model;
      if (r.cost != null) costUsdThisRun += r.cost;
      lastOutcome = r.outcome;
      if (r.error) lastError = r.error;

      if (r.outcome === 'success') {
        result = r.result ?? null;
        break;
      }
      if (r.outcome === 'budget_exceeded') {
        budgetExceeded = true;
        break;
      }
      if (r.outcome === 'invalid' && i < MAX_ATTEMPTS) {
        await sleep(BACKOFFS_MS[i - 1]);
        continue;
      }
      if (r.outcome === 'error' && isRetryable(r.errObj) && i < MAX_ATTEMPTS) {
        await sleep(BACKOFFS_MS[i - 1]);
        continue;
      }
      break;
    }

    // One extra attempt on a different (presumably stronger) model, only
    // when the primary model's output was structurally present but failed
    // semantic validation even after date normalization — not for plain API
    // errors, and not if the daily budget is already exhausted.
    const fallbackModel = getExtractFallbackModel();
    if (!result && !budgetExceeded && lastOutcome === 'invalid' && fallbackModel) {
      attempt += 1;
      const r = await this.attemptExtraction({ s3Key, found, trigger, msg, attempt, body, modelOverride: fallbackModel });
      finalModel = r.model;
      if (r.cost != null) costUsdThisRun += r.cost;
      if (r.error) lastError = r.error;
      if (r.outcome === 'success') result = r.result ?? null;
      if (r.outcome === 'budget_exceeded') budgetExceeded = true;
    }

    if (!result) {
      await this.upsertFailed(s3Key, found, finalModel, costUsdThisRun, lastError ?? 'unknown error');
      return;
    }

    await this.upsertExtraction(s3Key, found, finalModel, result, costUsdThisRun);
  }

  /**
   * Deterministic path (default, see VH_EXTRACT_METHOD): no network call, no
   * budget check, no retries (the scraper is pure — retrying the same bytes
   * can't change the result). PDFs are explicitly unsupported here (the
   * scraper only understands HTML templates) and get a terminal `skipped`
   * log so the sweeper's retry cap (see vehicle-history-extract.sweeper.ts)
   * never re-queues them.
   */
  private async handleScrape(params: {
    s3Key: string;
    found: SourceFound;
    trigger: string;
    msg: VehicleHistoryExtractMessage;
    body: Buffer;
  }): Promise<void> {
    const { s3Key, found, trigger, msg, body } = params;

    if (found.contentType === 'application/pdf') {
      await this.writeLog({ s3Key, found, trigger, msg, model: SCRAPER_MODEL_NAME, attempt: 1, status: 'skipped', error: 'pdf_not_supported' });
      await this.upsertFailed(s3Key, found, SCRAPER_MODEL_NAME, 0, 'pdf_not_supported');
      return;
    }

    const startedAt = Date.now();
    const scraped = scrapeReport({ body, contentType: found.contentType, vin: found.vin });
    const latencyMs = Date.now() - startedAt;

    const result: ExtractResult = {
      report: scraped.report,
      isReport: scraped.isReport,
      usage: { promptTokens: 0, cachedTokens: 0, completionTokens: 0 },
      model: SCRAPER_MODEL_NAME,
      latencyMs,
      inputMode: 'text',
      inputChars: body.length,
      truncated: false,
      requestId: null,
    };

    if (result.report) {
      const errors = validateReport(result.report);
      if (errors.length > 0) {
        const error = `invalid_output: ${errors.join('; ')}`;
        await this.writeLog({ s3Key, found, trigger, msg, model: SCRAPER_MODEL_NAME, attempt: 1, status: 'invalid_output', error, result, cost: 0 });
        await this.upsertFailed(s3Key, found, SCRAPER_MODEL_NAME, 0, error);
        return;
      }
    }

    await this.writeLog({
      s3Key,
      found,
      trigger,
      msg,
      model: SCRAPER_MODEL_NAME,
      attempt: 1,
      status: result.isReport ? 'ok' : 'not_report',
      error: null,
      result,
      cost: 0,
    });
    await this.upsertExtraction(s3Key, found, SCRAPER_MODEL_NAME, result, 0);
  }

  /** One OpenAI call + validation + its log row. Budget is checked immediately before this call, not once per message. */
  private async attemptExtraction(params: {
    s3Key: string;
    found: SourceFound;
    trigger: string;
    msg: VehicleHistoryExtractMessage;
    attempt: number;
    body: Buffer;
    modelOverride?: string;
  }): Promise<AttemptResult> {
    const { s3Key, found, trigger, msg, attempt, body, modelOverride } = params;
    const assumedModel = modelOverride ?? getExtractModel();

    const budgetOk = await this.underDailyBudget();
    if (!budgetOk) {
      await this.writeLog({ s3Key, found, trigger, msg, model: assumedModel, attempt, status: 'budget_exceeded', error: null });
      return { outcome: 'budget_exceeded', model: assumedModel };
    }

    try {
      const attemptResult = await extractReport({
        body,
        contentType: found.contentType,
        vin: found.vin,
        reportType: found.reportType,
        model: modelOverride,
      });
      const cost = computeCostUsd(attemptResult.model, attemptResult.usage);

      if (attemptResult.report) {
        const errors = validateReport(attemptResult.report);
        if (errors.length > 0) {
          const error = `invalid_output: ${errors.join('; ')}`;
          await this.writeLog({ s3Key, found, trigger, msg, model: attemptResult.model, attempt, status: 'invalid_output', error, result: attemptResult, cost });
          return { outcome: 'invalid', result: attemptResult, cost, error, model: attemptResult.model };
        }
      }

      await this.writeLog({
        s3Key,
        found,
        trigger,
        msg,
        model: attemptResult.model,
        attempt,
        status: attemptResult.isReport ? 'ok' : 'not_report',
        error: null,
        result: attemptResult,
        cost,
      });
      return { outcome: 'success', result: attemptResult, cost, model: attemptResult.model };
    } catch (err) {
      const error = (err as Error).message;
      await this.writeLog({ s3Key, found, trigger, msg, model: assumedModel, attempt, status: 'api_error', error });
      return { outcome: 'error', error, errObj: err, model: assumedModel };
    }
  }

  private async findSource(s3Key: string): Promise<SourceFound | null> {
    const carfax = await this.prisma.carfaxReport.findFirst({ where: { s3Key } });
    if (carfax) {
      return {
        sourceTable: 'carfax_reports',
        sourceId: carfax.id,
        vin: carfax.vin,
        contentType: s3Key.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/html',
        reportType: 'carfax',
      };
    }
    const vh = await this.prisma.vehicleHistoryReport.findFirst({ where: { s3Key } });
    if (vh) {
      return { sourceTable: 'vehicle_history_reports', sourceId: vh.id, vin: vh.vin, contentType: vh.contentType, reportType: vh.reportType };
    }
    return null;
  }

  /** Raw SQL avoids JS timezone math — Postgres' `AT TIME ZONE` handles CST/CDT correctly. */
  private async underDailyBudget(): Promise<boolean> {
    const budget = Number(process.env.VH_EXTRACT_DAILY_BUDGET_USD || '3');
    const rows = (await this.prisma.$queryRaw(Prisma.sql`
      SELECT COALESCE(SUM("costUsd"), 0) AS total
      FROM "vehicle_history_extraction_logs"
      WHERE "costUsd" IS NOT NULL
        AND ("createdAt" AT TIME ZONE 'America/Chicago')::date = (now() AT TIME ZONE 'America/Chicago')::date
    `)) as { total: string | number }[];
    const spentToday = Number(rows[0]?.total ?? 0);
    return spentToday < budget;
  }

  private async writeLog(params: {
    s3Key: string;
    found: SourceFound;
    trigger: string;
    msg: VehicleHistoryExtractMessage;
    model: string;
    attempt: number;
    status: string;
    error: string | null;
    result?: ExtractResult;
    cost?: number | null;
  }): Promise<void> {
    const { s3Key, found, trigger, msg, model, attempt, status, error, result, cost } = params;
    try {
      const extraction = await this.prisma.vehicleHistoryExtraction.findUnique({ where: { s3Key }, select: { id: true } });
      await this.prisma.vehicleHistoryExtractionLog.create({
        data: {
          s3Key,
          vin: found.vin ?? '',
          sourceTable: found.sourceTable,
          sourceId: found.sourceId,
          trigger,
          triggeredByUserId: msg.requestedByUserId ?? null,
          model,
          promptVersion: PROMPT_VERSION,
          inputMode: result?.inputMode ?? 'text',
          inputChars: result?.inputChars ?? null,
          promptTokens: result?.usage.promptTokens ?? null,
          cachedTokens: result?.usage.cachedTokens ?? null,
          completionTokens: result?.usage.completionTokens ?? null,
          costUsd: cost ?? null,
          latencyMs: result?.latencyMs ?? null,
          attempt,
          status,
          error,
          openaiRequestId: result?.requestId ?? null,
          truncated: result?.truncated ?? false,
          rawUsage: (result?.usage as unknown as object) ?? undefined,
          extractionId: extraction?.id ?? null,
        },
      });
    } catch (err) {
      this.logger.error(`[VhExtract] failed to write log for ${s3Key}: ${(err as Error).message}`);
    }
  }

  private async upsertExtraction(
    s3Key: string,
    found: SourceFound,
    model: string,
    result: ExtractResult,
    costUsdThisRun: number,
  ): Promise<void> {
    const report = result.report;
    const scalars = report ? projectScalars(report) : emptyScalars();
    const existing = await this.prisma.vehicleHistoryExtraction.findUnique({ where: { s3Key }, select: { costUsdTotal: true } });
    const costUsdTotal = Number(existing?.costUsdTotal ?? 0) + costUsdThisRun;

    const data = {
      sourceTable: found.sourceTable,
      sourceId: found.sourceId,
      vin: found.vin ?? '',
      status: result.isReport ? 'ok' : ('not_report' as const),
      model,
      promptVersion: PROMPT_VERSION,
      data: (report as unknown as object) ?? Prisma.JsonNull,
      error: null,
      extractedAt: new Date(),
      costUsdTotal,
      ...scalars,
    };

    await this.prisma.vehicleHistoryExtraction.upsert({
      where: { s3Key },
      create: { s3Key, ...data },
      update: data,
    });
  }

  private async upsertFailed(s3Key: string, found: SourceFound, model: string, costUsdThisRun: number, error: string): Promise<void> {
    const existing = await this.prisma.vehicleHistoryExtraction.findUnique({ where: { s3Key }, select: { costUsdTotal: true } });
    const costUsdTotal = Number(existing?.costUsdTotal ?? 0) + costUsdThisRun;
    const data = {
      sourceTable: found.sourceTable,
      sourceId: found.sourceId,
      vin: found.vin ?? '',
      status: 'failed',
      model,
      promptVersion: PROMPT_VERSION,
      error,
      costUsdTotal,
    };
    await this.prisma.vehicleHistoryExtraction.upsert({
      where: { s3Key },
      create: { s3Key, ...data },
      update: data,
    });
  }
}

function projectScalars(report: VehicleHistoryReportExtract) {
  let anyFlood = false;
  let anyBurn = false;
  let anyVandalism = false;
  let anyTheft = false;
  let anyTotalLoss = false;
  let anySalvageIssue = false;
  for (const owner of report.owners_history) {
    for (const row of owner.history_table) {
      anyFlood = anyFlood || row.flooded;
      anyBurn = anyBurn || row.burn;
      anyVandalism = anyVandalism || row.bandalist;
      anyTheft = anyTheft || row.teaft;
      anyTotalLoss = anyTotalLoss || row.total_lost;
      anySalvageIssue = anySalvageIssue || row.salvage_issue;
    }
  }
  return {
    mileage: report.millage,
    accident: report.accident,
    title: report.title,
    value: report.value,
    serviceHistoryRecords: report.service_history_record,
    openRecalls: report.at_last_open_recall,
    lastOwnerState: report.last_owner_state,
    ownerCount: report.owners_history.length || null,
    anyFlood,
    anyBurn,
    anyVandalism,
    anyTheft,
    anyTotalLoss,
    anySalvageIssue,
  };
}

function emptyScalars() {
  return {
    mileage: null,
    accident: null,
    title: null,
    value: null,
    serviceHistoryRecords: null,
    openRecalls: null,
    lastOwnerState: null,
    ownerCount: null,
    anyFlood: false,
    anyBurn: false,
    anyVandalism: false,
    anyTheft: false,
    anyTotalLoss: false,
    anySalvageIssue: false,
  };
}

function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 429 || (typeof status === 'number' && status >= 500)) return true;
  const name = (err as { name?: string })?.name ?? '';
  const message = (err as Error)?.message ?? '';
  return /timeout/i.test(name) || /timeout|ETIMEDOUT|ECONNRESET/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
