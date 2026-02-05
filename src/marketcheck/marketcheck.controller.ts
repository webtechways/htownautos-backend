import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
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

  @Get('price')
  @ApiOperation({ summary: 'Get predicted market price for a vehicle by zip code (cached 24h)' })
  @ApiQuery({ name: 'vin', required: true, example: '5TDKK3DC6DS302565' })
  @ApiQuery({ name: 'miles', required: true, example: '100000' })
  @ApiQuery({ name: 'dealer_type', required: false, example: 'independent' })
  @ApiQuery({ name: 'zip', required: true, example: '77063' })
  async getPrice(
    @Query('vin') vin: string,
    @Query('miles') miles: string,
    @Query('dealer_type') dealerType: string = 'independent',
    @Query('zip') zip: string,
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

  @Get('auctions')
  @ApiOperation({ summary: 'Search active auction listings (cached 1h)' })
  @ApiQuery({ name: 'make', required: false, example: 'Toyota' })
  @ApiQuery({ name: 'model', required: false, example: 'Camry' })
  @ApiQuery({ name: 'year_range', required: false, example: '2018-2024' })
  @ApiQuery({ name: 'price_range', required: false, example: '5000-50000' })
  @ApiQuery({ name: 'odometer_range', required: false, example: '0-100000' })
  @ApiQuery({ name: 'state', required: false, example: 'TX' })
  @ApiQuery({ name: 'zip', required: false, example: '77063' })
  @ApiQuery({ name: 'radius', required: false, example: '100' })
  @ApiQuery({ name: 'body_type', required: false, example: 'Sedan' })
  @ApiQuery({ name: 'transmission', required: false, example: 'Automatic' })
  @ApiQuery({ name: 'fuel_type', required: false, example: 'Gasoline' })
  @ApiQuery({ name: 'drivetrain', required: false, example: 'FWD' })
  @ApiQuery({ name: 'exterior_color', required: false, example: 'Black' })
  @ApiQuery({ name: 'seller_type', required: false, example: 'auction' })
  @ApiQuery({ name: 'sort_by', required: false, example: 'price' })
  @ApiQuery({ name: 'sort_order', required: false, example: 'asc' })
  @ApiQuery({ name: 'rows', required: false, example: '50' })
  @ApiQuery({ name: 'start', required: false, example: '0' })
  @ApiQuery({ name: 'facets', required: false, example: 'make,body_type,year' })
  @ApiQuery({ name: 'stats', required: false, example: 'price,miles' })
  async searchAuctions(
    @Query('make') make?: string,
    @Query('model') model?: string,
    @Query('year_range') year_range?: string,
    @Query('price_range') price_range?: string,
    @Query('odometer_range') odometer_range?: string,
    @Query('state') state?: string,
    @Query('zip') zip?: string,
    @Query('radius') radius?: string,
    @Query('body_type') body_type?: string,
    @Query('transmission') transmission?: string,
    @Query('fuel_type') fuel_type?: string,
    @Query('drivetrain') drivetrain?: string,
    @Query('exterior_color') exterior_color?: string,
    @Query('seller_type') seller_type?: string,
    @Query('sort_by') sort_by?: string,
    @Query('sort_order') sort_order?: 'asc' | 'desc',
    @Query('rows') rows?: string,
    @Query('start') start?: string,
    @Query('facets') facets?: string,
    @Query('stats') stats?: string,
  ) {
    const result = await this.marketCheckService.searchAuctions({
      make,
      model,
      year_range,
      price_range,
      odometer_range,
      state,
      zip,
      radius: radius ? parseInt(radius, 10) : undefined,
      body_type,
      transmission,
      fuel_type,
      drivetrain,
      exterior_color,
      seller_type,
      sort_by,
      sort_order,
      rows: rows ? parseInt(rows, 10) : 50,
      start: start ? parseInt(start, 10) : 0,
      facets,
      stats,
    });
    return { data: result };
  }
}
