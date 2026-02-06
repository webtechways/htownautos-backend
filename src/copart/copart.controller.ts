import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { CopartService } from './copart.service';
import { QueryCopartDto } from './dto/query-copart.dto';

@Controller('copart')
export class CopartController {
  constructor(private readonly copartService: CopartService) {}

  @Get()
  async findAll(@Query() query: QueryCopartDto) {
    return this.copartService.findAll(query);
  }

  @Get('filters')
  async getFilterOptions() {
    return this.copartService.getFilterOptions();
  }

  @Get('stats')
  async getStats() {
    return this.copartService.getStats();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const listing = await this.copartService.findOne(id);
    if (!listing) {
      throw new NotFoundException(`Copart listing with ID ${id} not found`);
    }
    return listing;
  }

  @Get('lot/:lotNumber')
  async findByLotNumber(@Param('lotNumber') lotNumber: string) {
    const listing = await this.copartService.findByLotNumber(lotNumber);
    if (!listing) {
      throw new NotFoundException(
        `Copart listing with lot number ${lotNumber} not found`,
      );
    }
    return listing;
  }
}
