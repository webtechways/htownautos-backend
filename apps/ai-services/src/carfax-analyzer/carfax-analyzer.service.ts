import {
  Injectable,
  Logger,
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from '@htownautos/prisma';
import { S3Service } from '@htownautos/common';
import { VehicleHistoryService } from '@htownautos/vehicle-history';
import type { RequestView } from '@htownautos/vehicle-history';

@Injectable()
export class CarfaxAnalyzerService {
  private readonly logger = new Logger(CarfaxAnalyzerService.name);
  private readonly openai: OpenAI;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
    private readonly vehicleHistory: VehicleHistoryService,
  ) {
    const apiKey = process.env.OPENAI_API_KEY || process.env.TTS_API_KEY;
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY / TTS_API_KEY not configured');
    }
    this.openai = new OpenAI({ apiKey });
  }

  /** Step 1: Create CarfaxReport record (PDF already uploaded to S3) */
  async uploadReport(auctionListingId: string, s3Key: string) {
    const listing = await this.prisma.auctionListing.findUnique({
      where: { lotNumber: BigInt(auctionListingId) },
    });
    if (!listing) {
      throw new NotFoundException('Auction listing not found');
    }

    const report = await this.prisma.carfaxReport.create({
      data: {
        auctionListingId: BigInt(auctionListingId),
        s3Key,
        vin: listing.vin ?? undefined,
      },
    });

    this.logger.log(`Carfax PDF saved: report ${report.id} for listing ${auctionListingId}`);
    return report;
  }

  /** Step 2: Run AI analysis on an existing report */
  async analyzeReport(reportId: string) {
    const report = await this.prisma.carfaxReport.findUnique({
      where: { id: reportId },
      include: { auctionListing: true },
    });
    if (!report) {
      throw new NotFoundException('Carfax report not found');
    }

    const listing = report.auctionListing;

    // Download PDF from S3
    this.logger.log(`Downloading PDF from S3: ${report.s3Key}`);
    let pdfBase64: string;
    try {
      const pdfBuffer = await this.s3Service.downloadBuffer(report.s3Key);
      pdfBase64 = pdfBuffer.toString('base64');
      this.logger.log(`PDF downloaded (${pdfBuffer.length} bytes)`);
    } catch (error) {
      this.logger.error(`Failed to download PDF from S3: ${error}`);
      throw new InternalServerErrorException('Failed to download PDF from S3');
    }

    const vehicleInfo = [
      listing.year,
      listing.make,
      listing.modelGroup,
      listing.modelDetail,
      listing.trim,
    ]
      .filter(Boolean)
      .join(' ');

    const prompt = `You are an automotive history and vehicle report expert. Analyze this Carfax PDF report in full detail.

Vehicle: ${vehicleInfo}
VIN: ${listing.vin || 'N/A'}

Provide a comprehensive plain text analysis covering:
1. OWNERSHIP HISTORY: Number of owners, duration of each ownership, type of use (personal, fleet, rental, lease)
2. ACCIDENT & DAMAGE HISTORY: Every reported accident, severity, affected areas, airbag deployment
3. SERVICE & MAINTENANCE RECORDS: All documented services, regularity, any gaps in maintenance
4. TITLE HISTORY: Title type changes, salvage/rebuilt/flood titles, state transfers
5. ODOMETER READINGS: Mileage progression over time, any rollback red flags or inconsistencies
6. RECALLS: Open and completed recalls
7. STRUCTURAL DAMAGE: Any reported structural or frame damage
8. FLOOD/FIRE DAMAGE: Any water or fire damage history
9. LEMON/BUYBACK: Whether the vehicle was ever a lemon law buyback
10. RED FLAGS & WARNINGS: Anything suspicious or concerning

Be thorough and specific. Include dates and mileage where available. This is a plain text report — no markdown, no formatting, just clean text with clear section headers.`;

    this.logger.log(
      `→ OpenAI Carfax Analysis: Analyzing report for ${vehicleInfo} (report ${reportId})`,
    );
    const start = Date.now();

    try {
      const response = await this.openai.responses.create({
        model: 'gpt-4o',
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_file',
                filename: 'carfax-report.pdf',
                file_data: `data:application/pdf;base64,${pdfBase64}`,
              },
              {
                type: 'input_text',
                text: prompt,
              },
            ],
          },
        ],
        max_output_tokens: 4096,
        temperature: 0.3,
      });

      const duration = Date.now() - start;
      const content = response.output_text?.trim();
      this.logger.log(
        `← OpenAI Carfax Analysis OK (${duration}ms) tokens=${response.usage?.total_tokens}`,
      );

      if (!content) {
        throw new InternalServerErrorException('OpenAI returned empty response');
      }

      const updated = await this.prisma.carfaxReport.update({
        where: { id: reportId },
        data: { analysis: content },
      });

      this.logger.log(`Carfax analysis saved for report ${reportId}`);
      return updated;
    } catch (error) {
      const duration = Date.now() - start;
      if (
        error instanceof NotFoundException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      this.logger.error(`← OpenAI Carfax Analysis FAILED (${duration}ms): ${error}`);
      throw new InternalServerErrorException('Failed to analyze Carfax report');
    }
  }

  /**
   * Produce a clean, structured AI summary and store it in `aiSummary`.
   *
   * Text source (in priority order):
   *  1. `report.analysis` — stripped plain-text already in the DB (fastest, free)
   *  2. S3 object re-fetched:
   *     - HTML file → strip tags to plain text
   *     - PDF → delegate to the existing analyzeReport PDF path (stores to `analysis` first)
   *
   * The summary is always in English and covers: accidents/damage, title brand,
   * odometer/rollback, owners, service records, recalls, lemon/buyback, risk note.
   */
  async summarizeReport(reportId: string) {
    const report = await this.prisma.carfaxReport.findUnique({
      where: { id: reportId },
      include: { auctionListing: true },
    });
    if (!report) {
      throw new NotFoundException('Carfax report not found');
    }

    // ── Determine the text to summarize ──────────────────────────────────────
    const MIN_ANALYSIS_CHARS = 200; // anything shorter is probably a stub
    let textToSummarize: string | null = null;

    if (report.analysis && report.analysis.length >= MIN_ANALYSIS_CHARS) {
      // Use the pre-stripped plain text already in the DB — no S3 fetch needed.
      textToSummarize = report.analysis;
      this.logger.log(`summarizeReport ${reportId}: using existing analysis (${textToSummarize.length} chars)`);
    } else {
      // Re-fetch from S3 and detect format.
      this.logger.log(`summarizeReport ${reportId}: downloading from S3 (${report.s3Key})`);
      let rawBuffer: Buffer;
      try {
        rawBuffer = await this.s3Service.downloadBuffer(report.s3Key);
      } catch (err) {
        throw new InternalServerErrorException(`Failed to download S3 object: ${(err as Error).message}`);
      }

      const sniff = rawBuffer.slice(0, 5).toString('ascii');
      const isPdf = sniff.startsWith('%PDF');

      if (isPdf) {
        // PDF path: run the existing analyzeReport (stores to `analysis`) then re-read.
        this.logger.log(`summarizeReport ${reportId}: PDF detected, running analyzeReport first`);
        const analyzed = await this.analyzeReport(reportId);
        textToSummarize = analyzed.analysis ?? null;
      } else {
        // Assume HTML — strip tags to plain text.
        const html = rawBuffer.toString('utf8');
        textToSummarize = html
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        this.logger.log(`summarizeReport ${reportId}: HTML detected, stripped to ${textToSummarize.length} chars`);
      }
    }

    if (!textToSummarize || textToSummarize.length < MIN_ANALYSIS_CHARS) {
      throw new BadRequestException('Insufficient Carfax content to summarize');
    }

    const listing = report.auctionListing;
    const vehicleInfo = [listing.year, listing.make, listing.modelGroup, listing.modelDetail, listing.trim]
      .filter(Boolean)
      .join(' ');

    const MAX_INPUT_CHARS = 18000; // generous — GPT-4o context is large
    const truncatedText = textToSummarize.length > MAX_INPUT_CHARS
      ? textToSummarize.slice(0, MAX_INPUT_CHARS) + '\n...[content truncated]'
      : textToSummarize;

    const systemPrompt = `You are an automotive history report analyst. You summarize vehicle history reports in clear, structured plain text in English. Be concise but complete. Use section headers in ALL CAPS followed by a colon. Do not use markdown or bullet symbols.`;

    const userPrompt = `Summarize the following Carfax report for a ${vehicleInfo} (VIN: ${listing.vin ?? 'N/A'}).

Produce a clean structured plain-text summary (no markdown) with these sections:
ACCIDENT/DAMAGE HISTORY: (every reported incident, severity, date if known)
TITLE BRAND: (clean, salvage, rebuilt, flood, lemon, etc.)
ODOMETER/ROLLBACK FLAGS: (mileage progression, any red flags)
NUMBER OF OWNERS: (count, types: personal/fleet/rental/lease)
SERVICE RECORDS: (documented services, gaps, regularity)
RECALLS/OPEN CAMPAIGNS: (list any open recalls)
LEMON/BUYBACK: (yes/no with details)
RISK NOTE: (2-3 sentences summarizing key risks or confidence for purchase)

--- CARFAX REPORT TEXT ---
${truncatedText}`;

    this.logger.log(`→ OpenAI Carfax Summary: summarizing report ${reportId} for ${vehicleInfo}`);
    const start = Date.now();

    let summaryText: string;
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 1500,
        temperature: 0.2,
      });

      const duration = Date.now() - start;
      summaryText = response.choices[0]?.message?.content?.trim() ?? '';
      this.logger.log(`← OpenAI Carfax Summary OK (${duration}ms) tokens=${response.usage?.total_tokens}`);

      if (!summaryText) {
        throw new InternalServerErrorException('OpenAI returned empty summary');
      }
    } catch (err) {
      const duration = Date.now() - start;
      if (err instanceof NotFoundException || err instanceof InternalServerErrorException || err instanceof BadRequestException) {
        throw err;
      }
      this.logger.error(`← OpenAI Carfax Summary FAILED (${duration}ms): ${err}`);
      throw new InternalServerErrorException('Failed to generate Carfax AI summary');
    }

    const updated = await this.prisma.carfaxReport.update({
      where: { id: reportId },
      data: { aiSummary: summaryText },
    });

    this.logger.log(`Carfax AI summary saved for report ${reportId}`);
    return updated;
  }

  async getReports(auctionListingId: string) {
    const reports = await this.prisma.carfaxReport.findMany({
      where: { auctionListingId: BigInt(auctionListingId) },
      orderBy: { createdAt: 'desc' },
    });
    return reports;
  }

  /**
   * Find every Carfax report tied to a vehicle, regardless of which UI
   * created it. A car can be identified by VIN, by lot number, or both —
   * we return the union so the inspection detail page (which has both)
   * surfaces a carfax uploaded earlier from /auction/:id or /vehicles.
   */
  async getReportsByVehicle(params: { vin?: string | null; lotNumber?: string | null }) {
    const orClauses: any[] = [];
    if (params.vin) orClauses.push({ vin: params.vin });
    if (params.lotNumber) {
      try {
        orClauses.push({ auctionListingId: BigInt(params.lotNumber) });
      } catch {
        // Non-numeric lot number — skip; VIN lookup may still match.
      }
    }
    if (!orClauses.length) return [];
    return this.prisma.carfaxReport.findMany({
      where: { OR: orClauses },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Batch check which auction listing IDs have at least one CarfaxReport */
  async batchCheckHasReports(auctionListingIds: string[]): Promise<string[]> {
    if (auctionListingIds.length === 0) return [];

    const bigIntIds = auctionListingIds.map((id) => BigInt(id));
    const results = await this.prisma.carfaxReport.findMany({
      where: { auctionListingId: { in: bigIntIds } },
      select: { auctionListingId: true },
      distinct: ['auctionListingId'],
    });

    return results.map((r) => r.auctionListingId.toString());
  }

  /** Get all auction listing IDs that have carfax reports */
  async getAllListingIdsWithReports(): Promise<string[]> {
    const results = await this.prisma.carfaxReport.findMany({
      select: { auctionListingId: true },
      distinct: ['auctionListingId'],
    });
    return results.map((r) => r.auctionListingId.toString());
  }

  /**
   * CheapCarfax credits/limits for the lot page (free call). Served from the
   * last health reading when it's under 2 minutes old.
   */
  async getProviderLimits(): Promise<{
    daily_limit: number | null;
    carfax_reports_left_today: number | null;
    autocheck_reports_left_today: number | null;
    credits: number | null;
  }> {
    const empty = { daily_limit: null, carfax_reports_left_today: null, autocheck_reports_left_today: null, credits: null };
    try {
      let row = await this.prisma.vehicleHistoryProvider.findUnique({ where: { key: 'cheapcarfax' } });
      if (!row?.healthCheckedAt || Date.now() - row.healthCheckedAt.getTime() > 120_000) {
        row = await this.vehicleHistory.checkHealth('cheapcarfax');
      }
      const b = (row?.balance ?? null) as Record<string, number | null> | null;
      if (!b) return empty;
      return {
        daily_limit: b.dailyLimit ?? null,
        carfax_reports_left_today: b.carfaxLeftToday ?? null,
        autocheck_reports_left_today: b.autocheckLeftToday ?? null,
        credits: b.credits ?? null,
      };
    } catch (err) {
      this.logger.warn(`Carfax limits fetch error: ${(err as Error).message}`);
      return empty;
    }
  }

  /**
   * Orders the lot's Carfax through the vehicle-history provider chain (with
   * fallback and a per-VIN cache), and links the stored report to the listing.
   * Waits up to ~50 s; a slower provider answers { pending, requestId } and the
   * page polls fetchStatus().
   */
  async fetchCarfaxFromProvider(auctionListingId: string) {
    const listing = await this.prisma.auctionListing.findUnique({
      where: { lotNumber: BigInt(auctionListingId) },
      select: { lotNumber: true, vin: true },
    });
    if (!listing) {
      throw new NotFoundException('Auction listing not found');
    }
    const vin = listing.vin?.replace(/\s/g, '') ?? '';
    if (!vin || vin.length !== 17) {
      throw new BadRequestException('VIN no disponible o inválido para este lote');
    }

    this.logger.log(`Ordering Carfax for VIN ${vin} (listing ${auctionListingId})`);
    const view = await this.vehicleHistory.order(
      { vin, type: 'carfax', source: 'auction-listing', auctionListingId },
      50_000,
    );
    return this.resultFor(auctionListingId, view);
  }

  /** Polled by the lot page while a Carfax order is still running. */
  async fetchStatus(auctionListingId: string, requestId: string) {
    const view = await this.vehicleHistory.waitAndView(requestId, 20_000);
    if (view.reportType !== 'carfax' || view.vin !== (await this.listingVin(auctionListingId))) {
      throw new NotFoundException('Request not found for this listing');
    }
    return this.resultFor(auctionListingId, view);
  }

  private async listingVin(auctionListingId: string): Promise<string | null> {
    const l = await this.prisma.auctionListing.findUnique({ where: { lotNumber: BigInt(auctionListingId) }, select: { vin: true } });
    return l?.vin?.replace(/\s/g, '').toUpperCase() ?? null;
  }

  private async resultFor(auctionListingId: string, view: RequestView) {
    if (view.status === 'running') return { pending: true as const, requestId: view.id };
    if (view.status === 'failed' || !view.report) {
      const tried = view.attempts
        .filter((a) => a.outcome === 'failed')
        .map((a) => `${a.providerKey}: ${a.errorCode}`)
        .join(' · ');
      throw new BadRequestException(
        `${view.errorMessage ?? 'No se pudo obtener el Carfax'}${tried ? ` (${tried})` : ''}`,
      );
    }
    return this.attachToListing(auctionListingId, view);
  }

  /** Links a stored report to the listing as a CarfaxReport (once per listing + file). */
  private async attachToListing(auctionListingId: string, view: RequestView) {
    const rep = view.report!;
    let report = await this.prisma.carfaxReport.findFirst({
      where: { auctionListingId: BigInt(auctionListingId), s3Key: rep.s3Key },
    });
    if (!report) {
      let analysis: string | null = null;
      if (rep.contentType === 'text/html') {
        // Plain-text summary for the `analysis` column (used by max-bid).
        const html = (await this.s3Service.downloadBuffer(rep.s3Key)).toString('utf8');
        const stripped = html
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        analysis = `${rep.yearMakeModel ?? ''}\n\n${stripped}`.trim().slice(0, 12000);
      }
      report = await this.prisma.carfaxReport.create({
        data: {
          auctionListingId: BigInt(auctionListingId),
          vin: view.vin,
          s3Key: rep.s3Key,
          analysis,
          date: rep.createdAt,
        },
      });
      this.logger.log(`CarfaxReport ${report.id} for listing ${auctionListingId} (${view.cacheHit ? 'cache' : view.providerKey})`);
      // PDFs (some providers) get the AI analysis the manual-upload flow uses.
      if (rep.contentType === 'application/pdf') {
        void this.analyzeReport(report.id).catch((err) =>
          this.logger.warn(`Background analysis of ${report!.id} failed: ${(err as Error).message}`),
        );
      }
    }

    return {
      ...report,
      auctionListingId: report.auctionListingId.toString(),
      signedUrl: rep.url,
      yearMakeModel: rep.yearMakeModel ?? '',
      contentType: rep.contentType,
      providerKey: view.providerKey,
      providerName: view.providerName,
      cacheHit: view.cacheHit,
    };
  }
}
