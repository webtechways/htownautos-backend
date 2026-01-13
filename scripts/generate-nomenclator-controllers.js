const fs = require('fs');
const path = require('path');

const nomenclators = [
  { slug: 'sale-types', title: 'Sale Types', model: 'SaleType' },
  { slug: 'mileage-statuses', title: 'Mileage Statuses', model: 'MileageStatus' },
  { slug: 'vehicle-statuses', title: 'Vehicle Statuses', model: 'VehicleStatus' },
  { slug: 'title-statuses', title: 'Title Statuses', model: 'TitleStatus' },
  { slug: 'vehicle-conditions', title: 'Vehicle Conditions', model: 'VehicleCondition' },
  { slug: 'brand-statuses', title: 'Brand Statuses', model: 'BrandStatus' },
  { slug: 'vehicle-types', title: 'Vehicle Types', model: 'VehicleType' },
  { slug: 'body-types', title: 'Body Types', model: 'BodyType' },
  { slug: 'fuel-types', title: 'Fuel Types', model: 'FuelType' },
  { slug: 'drive-types', title: 'Drive Types', model: 'DriveType' },
  { slug: 'transmission-types', title: 'Transmission Types', model: 'TransmissionType' },
  { slug: 'vehicle-sources', title: 'Vehicle Sources', model: 'VehicleSource' },
  { slug: 'inspection-statuses', title: 'Inspection Statuses', model: 'InspectionStatus' },
  { slug: 'activity-types', title: 'Activity Types', model: 'ActivityType' },
  { slug: 'activity-statuses', title: 'Activity Statuses', model: 'ActivityStatus' },
  { slug: 'user-roles', title: 'User Roles', model: 'UserRole' },
  { slug: 'lead-sources', title: 'Lead Sources', model: 'LeadSource' },
  { slug: 'inquiry-types', title: 'Inquiry Types', model: 'InquiryType' },
  { slug: 'preferred-languages', title: 'Preferred Languages', model: 'PreferredLanguage' },
  { slug: 'contact-methods', title: 'Contact Methods', model: 'ContactMethod' },
  { slug: 'contact-times', title: 'Contact Times', model: 'ContactTime' },
  { slug: 'genders', title: 'Genders', model: 'Gender' },
  { slug: 'id-types', title: 'ID Types', model: 'IdType' },
  { slug: 'id-states', title: 'ID States', model: 'IdState' },
  { slug: 'employment-statuses', title: 'Employment Statuses', model: 'EmploymentStatus' },
  { slug: 'occupations', title: 'Occupations', model: 'Occupation' },
  { slug: 'deal-statuses', title: 'Deal Statuses', model: 'DealStatus' },
  { slug: 'finance-types', title: 'Finance Types', model: 'FinanceType' },
];

const toPascalCase = (str) => {
  return str
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
};

const controllerTemplate = (slug, title, className) => `import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { NomenclatorsService } from '../nomenclators.service';
import { CreateNomenclatorDto } from '../dto/create-nomenclator.dto';
import { UpdateNomenclatorDto } from '../dto/update-nomenclator.dto';
import { QueryNomenclatorDto } from '../dto/query-nomenclator.dto';
import { NomenclatorEntity } from '../entities/nomenclator.entity';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';

@ApiTags('Nomenclators - ${title}')
@Controller('nom/${slug}')
export class ${className}Controller {
  constructor(private readonly nomenclatorsService: NomenclatorsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new ${title.toLowerCase().slice(0, -1)}' })
  @ApiResponse({ status: HttpStatus.CREATED, type: NomenclatorEntity })
  async create(
    @Body(ValidationPipe) createDto: CreateNomenclatorDto,
  ): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.create('${slug}', createDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all ${title.toLowerCase()}' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedResponseDto })
  async findAll(
    @Query(ValidationPipe) query: QueryNomenclatorDto,
  ): Promise<PaginatedResponseDto<NomenclatorEntity>> {
    return this.nomenclatorsService.findAll('${slug}', query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get ${title.toLowerCase().slice(0, -1)} by ID' })
  @ApiResponse({ status: HttpStatus.OK, type: NomenclatorEntity })
  async findOne(@Param('id') id: string): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.findOne('${slug}', id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a ${title.toLowerCase().slice(0, -1)}' })
  @ApiResponse({ status: HttpStatus.OK, type: NomenclatorEntity })
  async update(
    @Param('id') id: string,
    @Body(ValidationPipe) updateDto: UpdateNomenclatorDto,
  ): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.update('${slug}', id, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a ${title.toLowerCase().slice(0, -1)}' })
  @ApiResponse({ status: HttpStatus.OK })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    return this.nomenclatorsService.remove('${slug}', id);
  }
}
`;

const controllersDir = path.join(__dirname, '../src/nomenclators/controllers');

// Create controllers directory if it doesn't exist
if (!fs.existsSync(controllersDir)) {
  fs.mkdirSync(controllersDir, { recursive: true });
}

// Generate each controller
nomenclators.forEach(({ slug, title, model }) => {
  const className = toPascalCase(slug);
  const content = controllerTemplate(slug, title, className);
  const filename = `${slug}.controller.ts`;
  const filepath = path.join(controllersDir, filename);

  fs.writeFileSync(filepath, content);
  console.log(`✅ Created ${filename}`);
});

// Generate index file that exports all controllers
const indexContent = nomenclators
  .map(({ slug }) => {
    const className = toPascalCase(slug);
    return `export { ${className}Controller } from './${slug}.controller';`;
  })
  .join('\n');

fs.writeFileSync(path.join(controllersDir, 'index.ts'), indexContent + '\n');
console.log('✅ Created index.ts');

console.log(`\n✨ Generated ${nomenclators.length} nomenclator controllers!`);
