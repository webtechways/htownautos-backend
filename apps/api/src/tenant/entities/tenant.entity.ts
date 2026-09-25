import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Tenant } from '@prisma/client';

export class TenantEntity implements Tenant {
  @ApiProperty({
    description: 'Tenant UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiPropertyOptional({
    description: 'Clerk Organization ID',
    example: 'org_abc123',
  })
  clerkOrgId: string | null;

  @ApiProperty({
    description: 'Tenant display name',
    example: 'HTown Autos Houston',
  })
  name: string;

  @ApiProperty({
    description: 'URL-friendly unique identifier',
    example: 'htown-autos-houston',
  })
  slug: string;

  @ApiPropertyOptional({
    description: 'Subdomain for tenant emails (subdomain.htownautos.com)',
    example: 'houston',
  })
  subdomain: string | null;

  @ApiPropertyOptional({
    description: 'Legal business name',
    example: 'HTown Autos LLC',
  })
  businessName: string | null;

  @ApiPropertyOptional({
    description: 'Tax ID / EIN',
    example: '12-3456789',
  })
  taxId: string | null;

  @ApiPropertyOptional({
    description: 'Business phone number',
    example: '+1-713-555-0100',
  })
  phone: string | null;

  @ApiPropertyOptional({
    description: 'Business email address',
    example: 'contact@htownautos.com',
  })
  email: string | null;

  @ApiPropertyOptional({
    description: 'Business website URL',
    example: 'https://htownautos.com',
  })
  website: string | null;

  @ApiPropertyOptional({
    description: 'Street address',
    example: '1234 Main Street',
  })
  address: string | null;

  @ApiPropertyOptional({
    description: 'City',
    example: 'Houston',
  })
  city: string | null;

  @ApiPropertyOptional({
    description: 'State code',
    example: 'TX',
  })
  state: string | null;

  @ApiPropertyOptional({
    description: 'ZIP code',
    example: '77001',
  })
  zipCode: string | null;

  @ApiProperty({
    description: 'Country',
    example: 'USA',
  })
  country: string;

  @ApiPropertyOptional({
    description: 'Tenant-specific settings as JSON',
    example: { theme: 'dark', timezone: 'America/Chicago' },
  })
  settings: any;

  @ApiPropertyOptional({
    description: 'Twilio Messaging Service ID for SMS',
    example: 'MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  })
  twilioMessagingServiceSid: string | null;

  @ApiPropertyOptional({
    description: 'URL to tenant logo',
    example: 'https://cdn.htownautos.com/logos/houston.png',
  })
  logo: string | null;

  @ApiProperty({
    description: 'Whether tenant is active',
    example: true,
  })
  isActive: boolean;

  @ApiPropertyOptional({
    description: 'Soft-delete timestamp. Null if tenant is not deleted.',
    example: null,
  })
  deletedAt: Date | null;

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2024-01-12T10:30:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2024-01-12T10:30:00.000Z',
  })
  updatedAt: Date;

  @ApiPropertyOptional({
    description: 'Postmark domain ID (sending domain provisioned for this tenant)',
    example: 12345,
  })
  postmarkDomainId: number | null;

  @ApiProperty({
    description: 'Whether the tenant email domain has verified DKIM in Postmark',
    example: false,
  })
  postmarkDkimVerified: boolean;

  @ApiProperty({
    description: 'Whether the tenant email Return-Path domain is verified',
    example: false,
  })
  postmarkReturnPathVerified: boolean;

  @ApiPropertyOptional({
    description: 'Timestamp when the email domain was provisioned',
    example: '2024-01-12T10:30:00.000Z',
  })
  emailProvisionedAt: Date | null;

  @ApiPropertyOptional({
    description: 'Cloudflare DNS record IDs created for this tenant (cleanup metadata)',
    example: ['abc123', 'def456'],
  })
  cloudflareDnsRecordIds: any;

  @ApiPropertyOptional({
    description: 'Postmark server ID dedicated to this tenant (one per tenant for inbound)',
    example: 18950978,
  })
  postmarkServerId: number | null;

  @ApiPropertyOptional({
    description: 'API token for the tenant-specific Postmark server',
  })
  postmarkServerToken: string | null;

  @ApiPropertyOptional({
    description: 'Postmark webhook ID registered on the tenant server',
    example: 23758898,
  })
  postmarkWebhookId: number | null;

  @ApiProperty({
    description: 'Whether this tenant has a Clerk-backed customer portal (htownautos.com today)',
    example: false,
  })
  customerPortalEnabled: boolean;

  @ApiPropertyOptional({
    description: 'Per-tenant auction fee configuration (null = system default applies)',
  })
  feeConfig: any;

  constructor(partial: Partial<TenantEntity>) {
    Object.assign(this, partial);
  }
}

export class TenantWithStatsEntity extends TenantEntity {
  @ApiProperty({
    description: 'Number of users in this tenant',
    example: 5,
  })
  userCount: number;

  @ApiProperty({
    description: 'Number of vehicles in this tenant',
    example: 150,
  })
  vehicleCount: number;

  @ApiProperty({
    description: 'Number of deals in this tenant',
    example: 45,
  })
  dealCount: number;

  @ApiProperty({
    description: 'Number of buyers in this tenant',
    example: 120,
  })
  buyerCount: number;
}

export class PaginatedTenantsEntity {
  @ApiProperty({
    description: 'List of tenants',
    type: [TenantEntity],
  })
  data: TenantEntity[];

  @ApiProperty({
    description: 'Total number of tenants matching the query',
    example: 50,
  })
  total: number;

  @ApiProperty({
    description: 'Current page number',
    example: 1,
  })
  page: number;

  @ApiProperty({
    description: 'Number of items per page',
    example: 10,
  })
  limit: number;

  @ApiProperty({
    description: 'Total number of pages',
    example: 5,
  })
  totalPages: number;
}
