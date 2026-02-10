import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiParam } from '@nestjs/swagger';
import { MarketCheckService } from './marketcheck.service';
import { QueryScaAuctionDto } from './dto/query-sca-auction.dto';
import { AuditLog } from '../common/decorators/audit-log.decorator';

@ApiTags('MarketCheck')
@Controller('marketcheck')
export class MarketCheckController {
  constructor(private readonly marketCheckService: MarketCheckService) { }

  @Get('makes')
  @ApiOperation({ summary: 'List makes for a given year' })
  @ApiQuery({ name: 'year', required: true, example: '2024' })
  async getMakes(@Query('year') year: string) {
    const makes = await this.marketCheckService.getMakes(year);
    return { data: makes };
  }

  @Get('models')
  @ApiOperation({ summary: 'List models for a given year and make' })
  @ApiQuery({ name: 'year', required: true, example: '2024' })
  @ApiQuery({ name: 'make', required: true, example: 'Toyota' })
  async getModels(
    @Query('year') year: string,
    @Query('make') make: string,
  ) {
    const models = await this.marketCheckService.getModels(year, make);
    return { data: models };
  }

  @Get('trims')
  @ApiOperation({ summary: 'List trims for a given year, make and model' })
  @ApiQuery({ name: 'year', required: true, example: '2024' })
  @ApiQuery({ name: 'make', required: true, example: 'Toyota' })
  @ApiQuery({ name: 'model', required: true, example: 'Camry' })
  async getTrims(
    @Query('year') year: string,
    @Query('make') make: string,
    @Query('model') model: string,
  ) {
    const trims = await this.marketCheckService.getTrims(year, make, model);
    return { data: trims };
  }

  @Get('decode/:vin')
  @ApiOperation({ summary: 'Decode a VIN to get vehicle specifications' })
  @ApiParam({ name: 'vin', description: '17-character VIN', example: '5TDKK3DC6DS302565' })
  async decodeVin(@Param('vin') vin: string) {
    const result = await this.marketCheckService.decodeVin(vin);
    return { data: result };
  }

  @Get('price')
  @ApiOperation({ summary: 'Get predicted market price for a vehicle by zip code (cached 24h)' })
  @ApiQuery({ name: 'vin', required: true, example: '5TDKK3DC6DS302565' })
  @ApiQuery({ name: 'miles', required: true, example: '100000' })
  @ApiQuery({ name: 'dealer_type', required: false, example: 'independent' })
  @ApiQuery({ name: 'zip', required: true, example: '77063' })
  @ApiQuery({ name: 'vehicleId', required: false, description: 'Vehicle ID for audit logging' })
  @AuditLog({ action: 'read', resource: 'marketcheck-price', level: 'low', pii: false })
  async getPrice(
    @Query('vin') vin: string,
    @Query('miles') miles: string,
    @Query('dealer_type') dealerType: string = 'independent',
    @Query('zip') zip: string,
    @Query('vehicleId') vehicleId?: string,
  ) {
    const result = await this.marketCheckService.getPredictedPrice(
      vin,
      parseInt(miles, 10) || 0,
      dealerType,
      zip,
    );
    return { data: result };
  }

  @Get('comparables')
  @ApiOperation({ summary: 'Get comparable active listings by make/model/year near a zip code (cached 24h)' })
  @ApiQuery({ name: 'make', required: true, example: 'Toyota' })
  @ApiQuery({ name: 'model', required: true, example: 'Sienna' })
  @ApiQuery({ name: 'year', required: true, example: '2013' })
  @ApiQuery({ name: 'zip', required: true, example: '77063' })
  @AuditLog({ action: 'read', resource: 'marketcheck-comparables', level: 'low', pii: false })
  async getComparables(
    @Query('make') make: string,
    @Query('model') model: string,
    @Query('year') year: string,
    @Query('zip') zip: string,
  ) {
    const result = await this.marketCheckService.getComparables(
      make,
      model,
      parseInt(year, 10),
      zip,
    );
    return { data: result };
  }

  // ==================== SCA AUCTION ENDPOINTS ====================

  @Get('sca-auction')
  @ApiOperation({ summary: 'Get SCA Auction listings directly from MarketCheck API' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 25 })
  @ApiQuery({ name: 'search', required: false, description: 'Search by VIN' })
  @ApiQuery({ name: 'make', required: false, example: 'Toyota' })
  @ApiQuery({ name: 'model', required: false, example: 'Camry' })
  @ApiQuery({ name: 'year', required: false, example: 2020 })
  @ApiQuery({ name: 'bodyType', required: false, example: 'Sedan' })
  @ApiQuery({ name: 'transmission', required: false, example: 'Automatic' })
  @ApiQuery({ name: 'fuelType', required: false, example: 'Gasoline' })
  @ApiQuery({ name: 'drivetrain', required: false, example: 'FWD' })
  @ApiQuery({ name: 'locationState', required: false, example: 'TX' })
  @ApiQuery({ name: 'minMiles', required: false, example: 0 })
  @ApiQuery({ name: 'maxMiles', required: false, example: 100000 })
  @ApiQuery({ name: 'sortBy', required: false, example: 'first_seen_at_date' })
  @ApiQuery({ name: 'sortOrder', required: false, example: 'desc' })
  async getScaAuctions(@Query() query: QueryScaAuctionDto) {
    return this.marketCheckService.searchScaAuctions(query);
  }

  @Get('sca-auction/filters')
  @ApiOperation({ summary: 'Get filter options for SCA Auction listings' })
  async getScaAuctionFilters() {
    return this.marketCheckService.getScaAuctionFilterOptions();
  }

  @Get('sca-auction/:id')
  @ApiOperation({ summary: 'Get a single SCA Auction listing by ID' })
  @ApiParam({ name: 'id', description: 'Listing UUID' })
  async getScaAuctionById(@Param('id') id: string) {
    const listing = await this.marketCheckService.findScaAuctionById(id);
    if (!listing) {
      return { error: 'Listing not found', statusCode: 404 };
    }
    return { data: listing };
  }

  @Post('sca-auction/sync')
  @ApiOperation({ summary: 'Manually trigger sync of SCA Auction listings from MarketCheck API' })
  async syncScaAuctions() {
    const count = await this.marketCheckService.fetchAndStoreScaAuctions();
    return { message: `Successfully synced ${count} SCA Auction listings`, count };
  }
}
