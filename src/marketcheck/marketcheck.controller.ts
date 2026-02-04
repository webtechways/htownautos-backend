import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { MarketCheckService } from './marketcheck.service';

@ApiTags('MarketCheck')
@Controller('marketcheck')
export class MarketCheckController {
  constructor(private readonly marketCheckService: MarketCheckService) {}

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
}
