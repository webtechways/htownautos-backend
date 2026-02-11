import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Buyer } from '@prisma/client';

export class BuyerEntity implements Omit<Buyer, 'monthlyHousingCost' | 'monthlyIncome' | 'additionalIncome' | 'previousMonthlyIncome' | 'currentMonthlyDebts' | 'alimonyChildSupport' | 'businessAnnualRevenue'> {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  // Personal Information
  @ApiProperty({ example: 'John' })
  firstName: string;

  @ApiPropertyOptional({ example: 'Robert' })
  middleName: string | null;

  @ApiProperty({ example: 'Doe' })
  lastName: string;

  @ApiPropertyOptional({ example: 'Jr' })
  suffix: string | null;

  @ApiProperty({ example: '1985-06-15T00:00:00.000Z' })
  dateOfBirth: Date;

  @ApiPropertyOptional()
  genderId: string | null;

  @ApiPropertyOptional({ description: 'SSN (masked)', example: '***-**-1234' })
  ssn: string | null;

  @ApiPropertyOptional()
  itin: string | null;

  @ApiPropertyOptional({ example: 'US Citizen' })
  citizenship: string | null;

  // Contact
  @ApiProperty({ example: 'john.doe@email.com' })
  email: string;

  @ApiProperty({ example: '(555) 123-4567' })
  phoneMain: string;

  @ApiPropertyOptional({ example: '(555) 987-6543' })
  phoneSecondary: string | null;

  @ApiPropertyOptional({ example: '(555) 456-7890' })
  phoneMobile: string | null;

  @ApiPropertyOptional()
  preferredLanguageId: string | null;

  // Current Address
  @ApiProperty({ example: '123 Main St' })
  currentAddress: string;

  @ApiProperty({ example: 'Houston' })
  currentCity: string;

  @ApiProperty({ example: 'TX' })
  currentState: string;

  @ApiProperty({ example: '77001' })
  currentZipCode: string;

  @ApiProperty({ example: 'USA' })
  currentCountry: string;

  @ApiPropertyOptional({ example: 5 })
  yearsAtAddress: number | null;

  @ApiPropertyOptional({ example: 6 })
  monthsAtAddress: number | null;

  @ApiPropertyOptional({ example: 'Own' })
  housingStatus: string | null;

  @ApiPropertyOptional({ example: 1500.00, type: Number })
  monthlyHousingCost: number | null;

  // Previous Address
  @ApiPropertyOptional()
  previousAddress: string | null;

  @ApiPropertyOptional()
  previousCity: string | null;

  @ApiPropertyOptional()
  previousState: string | null;

  @ApiPropertyOptional()
  previousZipCode: string | null;

  @ApiPropertyOptional()
  previousCountry: string | null;

  @ApiPropertyOptional()
  yearsAtPreviousAddress: number | null;

  @ApiPropertyOptional()
  monthsAtPreviousAddress: number | null;

  // ID Information
  @ApiPropertyOptional()
  idTypeId: string | null;

  @ApiPropertyOptional()
  idNumber: string | null;

  @ApiPropertyOptional()
  idStateId: string | null;

  @ApiPropertyOptional()
  idExpirationDate: Date | null;

  @ApiPropertyOptional()
  idIssueDate: Date | null;

  @ApiPropertyOptional()
  driversLicenseNumber: string | null;

  @ApiPropertyOptional()
  driversLicenseState: string | null;

  @ApiPropertyOptional()
  driversLicenseExpiration: Date | null;

  // Employment
  @ApiPropertyOptional()
  employmentStatusId: string | null;

  @ApiPropertyOptional()
  currentEmployer: string | null;

  @ApiPropertyOptional()
  employerPhone: string | null;

  @ApiPropertyOptional()
  occupationId: string | null;

  @ApiPropertyOptional()
  jobTitle: string | null;

  @ApiPropertyOptional()
  employerAddress: string | null;

  @ApiPropertyOptional()
  employerCity: string | null;

  @ApiPropertyOptional()
  employerState: string | null;

  @ApiPropertyOptional()
  employerZipCode: string | null;

  @ApiPropertyOptional({ type: Number })
  monthlyIncome: number | null;

  @ApiPropertyOptional()
  yearsEmployed: number | null;

  @ApiPropertyOptional()
  monthsEmployed: number | null;

  @ApiPropertyOptional({ type: Number })
  additionalIncome: number | null;

  @ApiPropertyOptional()
  additionalIncomeSource: string | null;

  // Previous Employment
  @ApiPropertyOptional()
  previousEmployer: string | null;

  @ApiPropertyOptional()
  previousEmployerPhone: string | null;

  @ApiPropertyOptional()
  previousJobTitle: string | null;

  @ApiPropertyOptional()
  previousEmployerAddress: string | null;

  @ApiPropertyOptional()
  previousEmployerCity: string | null;

  @ApiPropertyOptional()
  previousEmployerState: string | null;

  @ApiPropertyOptional()
  previousEmployerZipCode: string | null;

  @ApiPropertyOptional({ type: Number })
  previousMonthlyIncome: number | null;

  @ApiPropertyOptional()
  previousYearsEmployed: number | null;

  @ApiPropertyOptional()
  previousMonthsEmployed: number | null;

  // Bank Information
  @ApiPropertyOptional()
  bankName: string | null;

  @ApiPropertyOptional()
  bankAccountType: string | null;

  @ApiPropertyOptional()
  bankRoutingNumber: string | null;

  @ApiPropertyOptional()
  bankAccountNumber: string | null;

  @ApiPropertyOptional()
  yearsWithBank: number | null;

  @ApiPropertyOptional()
  monthsWithBank: number | null;

  // Credit Information
  @ApiPropertyOptional({ example: 720 })
  creditScore: number | null;

  @ApiProperty({ default: false })
  bankruptcyHistory: boolean;

  @ApiPropertyOptional()
  bankruptcyDate: Date | null;

  @ApiPropertyOptional()
  bankruptcyType: string | null;

  @ApiPropertyOptional()
  bankruptcyDischargeDate: Date | null;

  @ApiProperty({ default: false })
  repoHistory: boolean;

  @ApiPropertyOptional()
  repoDate: Date | null;

  @ApiProperty({ default: false })
  foreclosureHistory: boolean;

  @ApiPropertyOptional()
  foreclosureDate: Date | null;

  @ApiPropertyOptional({ type: Number })
  currentMonthlyDebts: number | null;

  @ApiPropertyOptional({ type: Number })
  alimonyChildSupport: number | null;

  // References
  @ApiPropertyOptional()
  reference1Name: string | null;

  @ApiPropertyOptional()
  reference1Phone: string | null;

  @ApiPropertyOptional()
  reference1Relation: string | null;

  @ApiPropertyOptional()
  reference1Address: string | null;

  @ApiPropertyOptional()
  reference1YearsKnown: number | null;

  @ApiPropertyOptional()
  reference2Name: string | null;

  @ApiPropertyOptional()
  reference2Phone: string | null;

  @ApiPropertyOptional()
  reference2Relation: string | null;

  @ApiPropertyOptional()
  reference2Address: string | null;

  @ApiPropertyOptional()
  reference2YearsKnown: number | null;

  @ApiPropertyOptional()
  reference3Name: string | null;

  @ApiPropertyOptional()
  reference3Phone: string | null;

  @ApiPropertyOptional()
  reference3Relation: string | null;

  @ApiPropertyOptional()
  reference3Address: string | null;

  @ApiPropertyOptional()
  reference3YearsKnown: number | null;

  @ApiPropertyOptional()
  reference4Name: string | null;

  @ApiPropertyOptional()
  reference4Phone: string | null;

  @ApiPropertyOptional()
  reference4Relation: string | null;

  @ApiPropertyOptional()
  reference4Address: string | null;

  @ApiPropertyOptional()
  reference4YearsKnown: number | null;

  @ApiPropertyOptional()
  reference5Name: string | null;

  @ApiPropertyOptional()
  reference5Phone: string | null;

  @ApiPropertyOptional()
  reference5Relation: string | null;

  @ApiPropertyOptional()
  reference5Address: string | null;

  @ApiPropertyOptional()
  reference5YearsKnown: number | null;

  // Business Buyer
  @ApiProperty({ default: false })
  isBusinessBuyer: boolean;

  @ApiPropertyOptional()
  businessName: string | null;

  @ApiPropertyOptional()
  businessType: string | null;

  @ApiPropertyOptional()
  businessEIN: string | null;

  @ApiPropertyOptional()
  businessYearsInBusiness: number | null;

  @ApiPropertyOptional({ type: Number })
  businessAnnualRevenue: number | null;

  // OFAC
  @ApiProperty({ default: false })
  ofacCheckCompleted: boolean;

  @ApiPropertyOptional()
  ofacCheckDate: Date | null;

  @ApiPropertyOptional()
  ofacCheckResult: string | null;

  @ApiPropertyOptional()
  ofacNotes: string | null;

  // Identity Verification
  @ApiProperty({ default: false })
  identityVerified: boolean;

  @ApiPropertyOptional()
  identityVerifiedDate: Date | null;

  @ApiPropertyOptional()
  identityVerifiedBy: string | null;

  // Other
  @ApiPropertyOptional()
  source: string | null;

  // Lead Information
  @ApiPropertyOptional()
  leadType: string | null;

  @ApiPropertyOptional()
  leadSource: string | null;

  @ApiPropertyOptional()
  inquiryType: string | null;

  @ApiPropertyOptional()
  contactMethod: string | null;

  @ApiPropertyOptional()
  contactTime: string | null;

  @ApiPropertyOptional()
  notes: string | null;

  @ApiProperty({ example: '2024-01-12T10:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2024-01-12T10:30:00.000Z' })
  updatedAt: Date;

  @ApiPropertyOptional()
  metaValue: any;

  @ApiPropertyOptional()
  tenantId: string | null;

  // Assigned Staff
  @ApiPropertyOptional({ description: 'Assigned salesperson TenantUser ID' })
  salesPersonId: string | null;

  @ApiPropertyOptional({ description: 'Assigned BDC agent TenantUser ID' })
  bdcAgentId: string | null;

  // Computed full name
  @ApiProperty({ example: 'John R. Doe Jr' })
  fullName: string;

  constructor(partial: Partial<BuyerEntity> & Record<string, any>) {
    Object.assign(this, partial);

    // Convert Decimal fields to numbers
    const decimalFields = [
      'monthlyHousingCost',
      'monthlyIncome',
      'additionalIncome',
      'previousMonthlyIncome',
      'currentMonthlyDebts',
      'alimonyChildSupport',
      'businessAnnualRevenue',
    ];

    for (const field of decimalFields) {
      if (partial[field] !== undefined && partial[field] !== null) {
        (this as any)[field] = Number(partial[field]);
      }
    }

    // Compute full name
    const parts = [this.firstName];
    if (this.middleName) parts.push(this.middleName.charAt(0) + '.');
    parts.push(this.lastName);
    if (this.suffix) parts.push(this.suffix);
    this.fullName = parts.join(' ');
  }
}
