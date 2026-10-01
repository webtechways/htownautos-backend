import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiProperty, ApiQuery } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';
import { CarfaxAnalyzerService } from './carfax-analyzer.service';
import { S3Service } from '@htownautos/common';

class UploadCarfaxDto {
  @ApiProperty({ description: 'Auction listing ID' })
  @IsString()
  @IsNotEmpty()
  auctionListingId: string;

  @ApiProperty({ description: 'S3 key of the uploaded PDF' })
  @IsString()
  @IsNotEmpty()
  s3Key: string;
}

class FetchCarfaxDto {
  @ApiProperty({ description: 'Auction listing ID (lot number)' })
  @IsString()
  @IsNotEmpty()
  auctionListingId: string;
}

@ApiTags('Carfax Analyzer')
@Controller('carfax-analyzer')
export class CarfaxAnalyzerController {
  constructor(
    private readonly carfaxAnalyzerService: CarfaxAnalyzerService,
    private readonly s3Service: S3Service,
  ) {}

  @Post('fetch')
  @ApiOperation({
    summary: "Order the lot's Carfax through the provider chain (fallback + cache) and link it to the listing",
    description: 'Returns the report, or { pending: true, requestId } when the provider is still working — poll GET /carfax-analyzer/fetch/:requestId.',
  })
  async fetchFromProvider(@Body() dto: FetchCarfaxDto) {
    const result = await this.carfaxAnalyzerService.fetchCarfaxFromProvider(
      dto.auctionListingId,
    );
    return { data: result };
  }

  @Get('fetch/:requestId')
  @ApiOperation({ summary: 'Poll a Carfax order started by POST /carfax-analyzer/fetch' })
  @ApiParam({ name: 'requestId', description: 'Vehicle history request id' })
  @ApiQuery({ name: 'auctionListingId', required: true })
  async fetchStatus(
    @Param('requestId') requestId: string,
    @Query('auctionListingId') auctionListingId: string,
  ) {
    const result = await this.carfaxAnalyzerService.fetchStatus(auctionListingId, requestId);
    return { data: result };
  }

  @Post('upload')
  @ApiOperation({ summary: 'Register an uploaded Carfax PDF (no AI analysis yet)' })
  async upload(@Body() dto: UploadCarfaxDto) {
    const result = await this.carfaxAnalyzerService.uploadReport(
      dto.auctionListingId,
      dto.s3Key,
    );
    return { data: result };
  }

  @Post(':reportId/analyze')
  @ApiOperation({ summary: 'Run AI analysis on an existing Carfax report' })
  @ApiParam({ name: 'reportId', description: 'Carfax report ID' })
  async analyze(@Param('reportId') reportId: string) {
    const result = await this.carfaxAnalyzerService.analyzeReport(reportId);
    return { data: result };
  }

  @Post(':reportId/summarize')
  @ApiOperation({
    summary: 'Generate a structured AI summary of an existing Carfax report and store in aiSummary',
  })
  @ApiParam({ name: 'reportId', description: 'Carfax report ID' })
  async summarize(@Param('reportId') reportId: string) {
    const result = await this.carfaxAnalyzerService.summarizeReport(reportId);
    return { data: { id: result.id, aiSummary: result.aiSummary } };
  }

  @Get('download')
  @ApiOperation({ summary: 'Get a signed download URL for a Carfax PDF' })
  @ApiQuery({ name: 'key', required: true, description: 'S3 key of the PDF' })
  @ApiQuery({ name: 'expiresIn', required: false, description: 'URL expiration in seconds' })
  async getDownloadUrl(
    @Query('key') key: string,
    @Query('expiresIn') expiresIn?: string,
  ) {
    const ttl = expiresIn ? parseInt(expiresIn, 10) : 3600;
    const url = await this.s3Service.getSignedUrl(key, ttl);
    return { url };
  }

  @Get('limits')
  @ApiOperation({ summary: 'Remaining Carfax reports / credits at CheapCarfax' })
  async getLimits() {
    const data = await this.carfaxAnalyzerService.getProviderLimits();
    return { data };
  }

  @Post('batch-check')
  @ApiOperation({ summary: 'Batch check which auction listing IDs have Carfax reports' })
  async batchCheck(@Body() body: { ids: string[] }) {
    const idsWithReports = await this.carfaxAnalyzerService.batchCheckHasReports(body.ids || []);
    return { data: idsWithReports };
  }

  @Get('by-vehicle')
  @ApiOperation({
    summary:
      'Find Carfax reports for a vehicle by VIN and/or lot number (returns the union).',
  })
  @ApiQuery({ name: 'vin', required: false })
  @ApiQuery({ name: 'lotNumber', required: false })
  async getByVehicle(
    @Query('vin') vin?: string,
    @Query('lotNumber') lotNumber?: string,
  ) {
    const reports = await this.carfaxAnalyzerService.getReportsByVehicle({
      vin: vin || null,
      lotNumber: lotNumber || null,
    });
    return { data: reports };
  }

  @Get(':auctionListingId')
  @ApiOperation({ summary: 'Get existing Carfax reports for an auction listing' })
  @ApiParam({ name: 'auctionListingId', description: 'Auction listing ID' })
  async getReports(@Param('auctionListingId') auctionListingId: string) {
    const reports = await this.carfaxAnalyzerService.getReports(auctionListingId);
    return { data: reports };
  }
}
