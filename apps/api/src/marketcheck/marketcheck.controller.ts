import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiParam } from '@nestjs/swagger';
import { RequireApiScopes } from '@htownautos/auth';
import { MarketCheckService } from './marketcheck.service';

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
  @ApiOperation({ summary: 'Get MarketCheck price prediction for a vehicle' })
  @ApiQuery({ name: 'vin', required: true, example: '5TDKK3DC6DS302565' })
  @ApiQuery({ name: 'miles', required: true, example: '123000' })
  @ApiQuery({ name: 'zip', required: true, example: '77063' })
  @ApiQuery({ name: 'dealer_type', required: false, example: 'independent' })
  async getPrice(
    @Query('vin') vin: string,
    @Query('miles') miles: string,
    @Query('zip') zip: string,
    @Query('dealer_type') dealerType?: string,
  ) {
    const result = await this.marketCheckService.getPrice(
      vin,
      parseInt(miles, 10),
      zip,
      dealerType || 'independent',
    );
    return { data: result };
  }

  @Get('comparables')
  @ApiOperation({ summary: 'Search for comparable active listings nearby' })
  @ApiQuery({ name: 'make', required: true, example: 'Toyota' })
  @ApiQuery({ name: 'model', required: true, example: 'Sienna' })
  @ApiQuery({ name: 'year', required: true, example: '2013' })
  @ApiQuery({ name: 'zip', required: true, example: '77063' })
  async getComparables(
    @Query('make') make: string,
    @Query('model') model: string,
    @Query('year') year: string,
    @Query('zip') zip: string,
  ) {
    const result = await this.marketCheckService.getComparables(make, model, year, zip);
    return { data: result };
  }

  @Get('comparables-by-vin')
  @ApiOperation({ summary: 'Search for comparable active listings by VIN' })
  @ApiQuery({ name: 'vin', required: true, example: '5TDKK3DC6DS302565' })
  @ApiQuery({ name: 'zip', required: true, example: '77063' })
  async getComparablesByVin(
    @Query('vin') vin: string,
    @Query('zip') zip: string,
  ) {
    const result = await this.marketCheckService.getComparablesByVin(vin, zip);
    return { data: result };
  }

  @Get('market-report')
  @RequireApiScopes('marketcheck:read')
  @ApiOperation({
    summary: 'MarketCheck price + nearby comparables for a VIN, served from the shared cache',
    description: 'Cache first (MARKETCHECK_CACHE_TTL_HOURS, default 7 days); only a miss calls MarketCheck. cacheOnly=true never calls MarketCheck — uncached parts come back null.',
  })
  @ApiQuery({ name: 'vin', required: true, example: '5TDKK3DC6DS302565' })
  @ApiQuery({ name: 'zip', required: true, example: '77063' })
  @ApiQuery({ name: 'miles', required: false, example: '123000', description: 'Needed for the price; omit to get comparables only' })
  @ApiQuery({ name: 'cacheOnly', required: false, example: 'false' })
  async getMarketReport(
    @Query('vin') vin: string,
    @Query('zip') zip: string,
    @Query('miles') miles?: string,
    @Query('cacheOnly') cacheOnly?: string,
  ) {
    const m = miles === undefined || miles === '' ? null : Number(miles);
    if (m !== null && (!Number.isInteger(m) || m < 0)) throw new BadRequestException('miles must be a whole number');
    return { data: await this.marketCheckService.getMarketReport(vin, zip, m, cacheOnly === 'true') };
  }
}
