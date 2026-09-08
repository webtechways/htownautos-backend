import {
  Controller,
  Get,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AuctionFacetsService } from './auction-facets.service';
import { Public } from '@htownautos/auth';

/** Las facetas se recalculan en cada cambio de filtro; son agregaciones. */
@ApiTags('Auction Facets')
@Controller('auction-facets')
@Throttle({ default: { limit: 240, ttl: 60_000 } })
export class AuctionFacetsController {
  constructor(private readonly service: AuctionFacetsService) {}

  @Get('makes')
  @Public()
  @ApiOperation({ summary: 'Distinct makes from active auction listings' })
  @ApiQuery({ name: 'yearFrom', required: false, type: Number })
  @ApiQuery({ name: 'yearTo', required: false, type: Number })
  makes(
    @Query('yearFrom', new DefaultValuePipe(0), ParseIntPipe) yearFrom: number,
    @Query('yearTo', new DefaultValuePipe(0), ParseIntPipe) yearTo: number,
  ): Promise<string[]> {
    return this.service.makes({
      yearFrom: yearFrom || undefined,
      yearTo: yearTo || undefined,
    });
  }

  @Get('models')
  @Public()
  @ApiOperation({ summary: 'Distinct models for a make (optionally filtered by year range)' })
  @ApiQuery({ name: 'make', required: true, type: String })
  @ApiQuery({ name: 'yearFrom', required: false, type: Number })
  @ApiQuery({ name: 'yearTo', required: false, type: Number })
  models(
    @Query('make') make: string,
    @Query('yearFrom', new DefaultValuePipe(0), ParseIntPipe) yearFrom: number,
    @Query('yearTo', new DefaultValuePipe(0), ParseIntPipe) yearTo: number,
  ): Promise<string[]> {
    return this.service.models({
      make: (make || '').trim(),
      yearFrom: yearFrom || undefined,
      yearTo: yearTo || undefined,
    });
  }

  @Get('trims')
  @Public()
  @ApiOperation({
    summary: 'Distinct trims for a make + models combination',
    description: 'Pass `models` as a comma-separated list (e.g. ?models=Camry,Corolla)',
  })
  @ApiQuery({ name: 'make', required: true, type: String })
  @ApiQuery({ name: 'models', required: true, type: String })
  @ApiQuery({ name: 'yearFrom', required: false, type: Number })
  @ApiQuery({ name: 'yearTo', required: false, type: Number })
  trims(
    @Query('make') make: string,
    @Query('models') models: string,
    @Query('yearFrom', new DefaultValuePipe(0), ParseIntPipe) yearFrom: number,
    @Query('yearTo', new DefaultValuePipe(0), ParseIntPipe) yearTo: number,
  ): Promise<string[]> {
    const modelList = (models || '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    return this.service.trims({
      make: (make || '').trim(),
      models: modelList,
      yearFrom: yearFrom || undefined,
      yearTo: yearTo || undefined,
    });
  }

  @Get('colors')
  @Public()
  @ApiOperation({ summary: 'Distinct exterior colors from the feed' })
  colors(): Promise<string[]> {
    return this.service.colors();
  }

  @Get('title-types')
  @Public()
  @ApiOperation({ summary: 'Distinct sale title types from the feed' })
  titleTypes(): Promise<string[]> {
    return this.service.titleTypes();
  }

  @Get('year-bounds')
  @Public()
  @ApiOperation({ summary: 'Earliest and latest year present in the feed' })
  yearBounds(): Promise<{ min: number | null; max: number | null }> {
    return this.service.yearBounds();
  }
}
