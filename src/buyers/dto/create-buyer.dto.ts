import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsOptional,
  IsDateString,
  IsUUID,
  IsBoolean,
  IsNumber,
  IsInt,
  Min,
  Max,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateBuyerDto {
  // Personal Information
  @ApiProperty({ description: 'First name', example: 'John' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiPropertyOptional({ description: 'Middle name', example: 'Robert' })
  @IsOptional()
  @IsString()
  middleName?: string;

  @ApiProperty({ description: 'Last name', example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiPropertyOptional({ description: 'Suffix (Jr, Sr, III, etc)', example: 'Jr' })
  @IsOptional()
  @IsString()
  suffix?: string;

  @ApiProperty({ description: 'Date of birth', example: '1985-06-15' })
  @IsDateString()
  dateOfBirth: string;

  @ApiPropertyOptional({ description: 'Gender UUID' })
  @IsOptional()
  @IsUUID()
  genderId?: string;

  @ApiPropertyOptional({ description: 'Social Security Number (encrypted)', example: '***-**-1234' })
  @IsOptional()
  @IsString()
  ssn?: string;

  @ApiPropertyOptional({ description: 'ITIN number' })
  @IsOptional()
  @IsString()
  itin?: string;

  @ApiPropertyOptional({ description: 'Citizenship', example: 'US Citizen' })
  @IsOptional()
  @IsString()
  citizenship?: string;

  // Contact Information
  @ApiProperty({ description: 'Email address', example: 'john.doe@email.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ description: 'Main phone number', example: '(555) 123-4567' })
  @IsString()
  @IsNotEmpty()
  phoneMain: string;

  @ApiPropertyOptional({ description: 'Secondary phone', example: '(555) 987-6543' })
  @IsOptional()
  @IsString()
  phoneSecondary?: string;

  @ApiPropertyOptional({ description: 'Mobile phone', example: '(555) 456-7890' })
  @IsOptional()
  @IsString()
  phoneMobile?: string;

  @ApiPropertyOptional({ description: 'Preferred language UUID' })
  @IsOptional()
  @IsUUID()
  preferredLanguageId?: string;

  // Current Address
  @ApiProperty({ description: 'Current street address', example: '123 Main St' })
  @IsString()
  @IsNotEmpty()
  currentAddress: string;

  @ApiProperty({ description: 'Current city', example: 'Houston' })
  @IsString()
  @IsNotEmpty()
  currentCity: string;

  @ApiProperty({ description: 'Current state', example: 'TX' })
  @IsString()
  @IsNotEmpty()
  currentState: string;

  @ApiProperty({ description: 'Current ZIP code', example: '77001' })
  @IsString()
  @IsNotEmpty()
  currentZipCode: string;

  @ApiPropertyOptional({ description: 'Current country', example: 'USA', default: 'USA' })
  @IsOptional()
  @IsString()
  currentCountry?: string;

  @ApiPropertyOptional({ description: 'Years at current address', example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  yearsAtAddress?: number;

  @ApiPropertyOptional({ description: 'Months at current address', example: 6 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(11)
  monthsAtAddress?: number;

  @ApiPropertyOptional({ description: 'Housing status (Own, Rent, etc)', example: 'Own' })
  @IsOptional()
  @IsString()
  housingStatus?: string;

  @ApiPropertyOptional({ description: 'Monthly housing cost', example: 1500.00 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyHousingCost?: number;

  // Previous Address (optional)
  @ApiPropertyOptional({ description: 'Previous street address' })
  @IsOptional()
  @IsString()
  previousAddress?: string;

  @ApiPropertyOptional({ description: 'Previous city' })
  @IsOptional()
  @IsString()
  previousCity?: string;

  @ApiPropertyOptional({ description: 'Previous state' })
  @IsOptional()
  @IsString()
  previousState?: string;

  @ApiPropertyOptional({ description: 'Previous ZIP code' })
  @IsOptional()
  @IsString()
  previousZipCode?: string;

  @ApiPropertyOptional({ description: 'Previous country' })
  @IsOptional()
  @IsString()
  previousCountry?: string;

  @ApiPropertyOptional({ description: 'Years at previous address' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  yearsAtPreviousAddress?: number;

  @ApiPropertyOptional({ description: 'Months at previous address' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(11)
  monthsAtPreviousAddress?: number;

  // ID Information
  @ApiPropertyOptional({ description: 'ID type UUID' })
  @IsOptional()
  @IsUUID()
  idTypeId?: string;

  @ApiPropertyOptional({ description: 'ID number' })
  @IsOptional()
  @IsString()
  idNumber?: string;

  @ApiPropertyOptional({ description: 'ID state UUID' })
  @IsOptional()
  @IsUUID()
  idStateId?: string;

  @ApiPropertyOptional({ description: 'ID expiration date' })
  @IsOptional()
  @IsDateString()
  idExpirationDate?: string;

  @ApiPropertyOptional({ description: 'ID issue date' })
  @IsOptional()
  @IsDateString()
  idIssueDate?: string;

  @ApiPropertyOptional({ description: "Driver's license number" })
  @IsOptional()
  @IsString()
  driversLicenseNumber?: string;

  @ApiPropertyOptional({ description: "Driver's license state" })
  @IsOptional()
  @IsString()
  driversLicenseState?: string;

  @ApiPropertyOptional({ description: "Driver's license expiration" })
  @IsOptional()
  @IsDateString()
  driversLicenseExpiration?: string;

  // Employment
  @ApiPropertyOptional({ description: 'Employment status UUID' })
  @IsOptional()
  @IsUUID()
  employmentStatusId?: string;

  @ApiPropertyOptional({ description: 'Current employer name' })
  @IsOptional()
  @IsString()
  currentEmployer?: string;

  @ApiPropertyOptional({ description: 'Employer phone' })
  @IsOptional()
  @IsString()
  employerPhone?: string;

  @ApiPropertyOptional({ description: 'Occupation UUID' })
  @IsOptional()
  @IsUUID()
  occupationId?: string;

  @ApiPropertyOptional({ description: 'Job title' })
  @IsOptional()
  @IsString()
  jobTitle?: string;

  @ApiPropertyOptional({ description: 'Monthly income', example: 5000.00 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyIncome?: number;

  @ApiPropertyOptional({ description: 'Years employed' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  yearsEmployed?: number;

  @ApiPropertyOptional({ description: 'Months employed' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(11)
  monthsEmployed?: number;

  // Credit Information
  @ApiPropertyOptional({ description: 'Credit score', example: 720 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(300)
  @Max(850)
  creditScore?: number;

  // Business Buyer
  @ApiPropertyOptional({ description: 'Is this a business buyer?', default: false })
  @IsOptional()
  @IsBoolean()
  isBusinessBuyer?: boolean;

  @ApiPropertyOptional({ description: 'Business name' })
  @IsOptional()
  @IsString()
  businessName?: string;

  @ApiPropertyOptional({ description: 'Business EIN' })
  @IsOptional()
  @IsString()
  businessEIN?: string;

  // Notes
  @ApiPropertyOptional({ description: 'Source of the buyer' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ description: 'Notes about the buyer' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Additional metadata' })
  @IsOptional()
  @IsObject()
  metaValue?: Record<string, any>;
}
