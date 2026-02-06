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
}
