import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CreateBuyerDto } from './dto/create-buyer.dto';
import { UpdateBuyerDto } from './dto/update-buyer.dto';
import { QueryBuyerDto } from './dto/query-buyer.dto';
import { BuyerEntity } from './entities/buyer.entity';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { normalizePhoneNumber } from '../common/utils/phone.utils';

/** Shared include for buyer queries */
const BUYER_INCLUDE = {
  gender: { select: { id: true, title: true } },
  preferredLanguage: { select: { id: true, title: true } },
  employmentStatus: { select: { id: true, title: true } },
  occupation: { select: { id: true, title: true } },
  idType: { select: { id: true, title: true } },
  idState: { select: { id: true, title: true } },
  salesperson: {
    select: {
      id: true,
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
      role: { select: { id: true, name: true, slug: true } },
    },
  },
  bdcAgent: {
    select: {
      id: true,
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
      role: { select: { id: true, name: true, slug: true } },
    },
  },
} as const;

@Injectable()
export class BuyersService {
  private readonly buyer: ReturnType<PrismaService['getModel']>;

  constructor(private readonly prisma: PrismaService) {
    this.buyer = prisma.getModel('buyer');
  }

  async create(dto: CreateBuyerDto, tenantId: string): Promise<BuyerEntity> {
    // Normalize phone numbers to E.164 format before saving
    const phoneMain = normalizePhoneNumber(dto.phoneMain);
    const phoneSecondary = normalizePhoneNumber(dto.phoneSecondary);
    const phoneMobile = normalizePhoneNumber(dto.phoneMobile);
    const employerPhone = normalizePhoneNumber(dto.employerPhone);

    const data: Prisma.BuyerCreateInput = {
      firstName: dto.firstName,
      middleName: dto.middleName,
      lastName: dto.lastName,
      suffix: dto.suffix,
      dateOfBirth: new Date(dto.dateOfBirth),
      email: dto.email,
      phoneMain: phoneMain || dto.phoneMain, // Fallback to original if normalization fails
      phoneSecondary: phoneSecondary || undefined,
      phoneMobile: phoneMobile || undefined,
      currentAddress: dto.currentAddress,
      currentCity: dto.currentCity,
      currentState: dto.currentState,
      currentZipCode: dto.currentZipCode,
      currentCountry: dto.currentCountry ?? 'USA',
      // Associate with tenant
      ...(tenantId && { tenant: { connect: { id: tenantId } } }),
      ...(dto.genderId && { gender: { connect: { id: dto.genderId } } }),
      ...(dto.preferredLanguageId && { preferredLanguage: { connect: { id: dto.preferredLanguageId } } }),
      ...(dto.employmentStatusId && { employmentStatus: { connect: { id: dto.employmentStatusId } } }),
      ...(dto.occupationId && { occupation: { connect: { id: dto.occupationId } } }),
      ...(dto.idTypeId && { idType: { connect: { id: dto.idTypeId } } }),
      ...(dto.idStateId && { idState: { connect: { id: dto.idStateId } } }),
      ...(dto.ssn && { ssn: dto.ssn }),
      ...(dto.itin && { itin: dto.itin }),
      ...(dto.citizenship && { citizenship: dto.citizenship }),
      ...(dto.yearsAtAddress !== undefined && { yearsAtAddress: dto.yearsAtAddress }),
      ...(dto.monthsAtAddress !== undefined && { monthsAtAddress: dto.monthsAtAddress }),
      ...(dto.housingStatus && { housingStatus: dto.housingStatus }),
      ...(dto.monthlyHousingCost !== undefined && { monthlyHousingCost: new Prisma.Decimal(dto.monthlyHousingCost) }),
      ...(dto.previousAddress && { previousAddress: dto.previousAddress }),
      ...(dto.previousCity && { previousCity: dto.previousCity }),
      ...(dto.previousState && { previousState: dto.previousState }),
      ...(dto.previousZipCode && { previousZipCode: dto.previousZipCode }),
      ...(dto.previousCountry && { previousCountry: dto.previousCountry }),
      ...(dto.yearsAtPreviousAddress !== undefined && { yearsAtPreviousAddress: dto.yearsAtPreviousAddress }),
      ...(dto.monthsAtPreviousAddress !== undefined && { monthsAtPreviousAddress: dto.monthsAtPreviousAddress }),
      ...(dto.idNumber && { idNumber: dto.idNumber }),
      ...(dto.idExpirationDate && { idExpirationDate: new Date(dto.idExpirationDate) }),
      ...(dto.idIssueDate && { idIssueDate: new Date(dto.idIssueDate) }),
      ...(dto.driversLicenseNumber && { driversLicenseNumber: dto.driversLicenseNumber }),
      ...(dto.driversLicenseState && { driversLicenseState: dto.driversLicenseState }),
      ...(dto.driversLicenseExpiration && { driversLicenseExpiration: new Date(dto.driversLicenseExpiration) }),
      ...(dto.currentEmployer && { currentEmployer: dto.currentEmployer }),
      ...(dto.employerPhone && { employerPhone: employerPhone || dto.employerPhone }),
      ...(dto.jobTitle && { jobTitle: dto.jobTitle }),
      ...(dto.monthlyIncome !== undefined && { monthlyIncome: new Prisma.Decimal(dto.monthlyIncome) }),
      ...(dto.yearsEmployed !== undefined && { yearsEmployed: dto.yearsEmployed }),
      ...(dto.monthsEmployed !== undefined && { monthsEmployed: dto.monthsEmployed }),
      ...(dto.creditScore !== undefined && { creditScore: dto.creditScore }),
      ...(dto.isBusinessBuyer !== undefined && { isBusinessBuyer: dto.isBusinessBuyer }),
      ...(dto.businessName && { businessName: dto.businessName }),
      ...(dto.businessEIN && { businessEIN: dto.businessEIN }),
      ...(dto.source && { source: dto.source }),
      ...(dto.leadType && { leadType: dto.leadType }),
      ...(dto.leadSource && { leadSource: dto.leadSource }),
      ...(dto.inquiryType && { inquiryType: dto.inquiryType }),
      ...(dto.contactMethod && { contactMethod: dto.contactMethod }),
      ...(dto.contactTime && { contactTime: dto.contactTime }),
      ...(dto.notes && { notes: dto.notes }),
      ...(dto.metaValue && { metaValue: dto.metaValue }),
      ...(dto.salesPersonId && { salesperson: { connect: { id: dto.salesPersonId } } }),
      ...(dto.bdcAgentId && { bdcAgent: { connect: { id: dto.bdcAgentId } } }),
    };

    const record = await this.buyer.create({
      data,
      include: BUYER_INCLUDE,
    });

    return new BuyerEntity(record);
  }

  async findAll(query: QueryBuyerDto, tenantId: string): Promise<PaginatedResponseDto<BuyerEntity>> {
    const { page = 1, limit = 10, search, email, lastName, phone, city, state, isBusinessBuyer } = query;
    const where: Prisma.BuyerWhereInput = {
      // Filter by tenant
      tenantId: tenantId || undefined,
    };

    // Search across multiple fields
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phoneMain: { contains: search } },
        { phoneMobile: { contains: search } },
      ];
    }

    if (email) {
      where.email = { contains: email, mode: 'insensitive' };
    }

    if (lastName) {
      where.lastName = { contains: lastName, mode: 'insensitive' };
    }

    if (phone) {
      where.OR = [
        { phoneMain: { contains: phone } },
        { phoneMobile: { contains: phone } },
        { phoneSecondary: { contains: phone } },
      ];
    }

    if (city) {
      where.currentCity = { contains: city, mode: 'insensitive' };
    }

    if (state) {
      where.currentState = { equals: state, mode: 'insensitive' };
    }

    if (isBusinessBuyer !== undefined) {
      where.isBusinessBuyer = isBusinessBuyer;
    }

    const [data, total] = await Promise.all([
      this.buyer.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: BUYER_INCLUDE,
      }),
      this.buyer.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: data.map((row: Record<string, unknown>) => new BuyerEntity(row)),
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async findOne(id: string, tenantId: string): Promise<BuyerEntity> {
    const record = await this.buyer.findFirst({
      where: { id, tenantId: tenantId || undefined },
      include: BUYER_INCLUDE,
    });

    if (!record) {
      throw new NotFoundException(`Buyer ${id} not found`);
    }

    return new BuyerEntity(record);
  }

  async update(id: string, dto: UpdateBuyerDto, tenantId: string): Promise<BuyerEntity> {
    await this.ensureBuyerExists(id, tenantId);

    const data: Prisma.BuyerUpdateInput = {};

    // Phone fields that need E.164 normalization
    const phoneFields = ['phoneMain', 'phoneSecondary', 'phoneMobile', 'employerPhone'];
    for (const field of phoneFields) {
      if ((dto as any)[field] !== undefined) {
        const normalized = normalizePhoneNumber((dto as any)[field]);
        (data as any)[field] = normalized || (dto as any)[field]; // Fallback to original if normalization fails
      }
    }

    // Map simple string/number fields (excluding phone fields handled above)
    const simpleFields = [
      'firstName', 'middleName', 'lastName', 'suffix', 'email',
      'ssn', 'itin', 'citizenship',
      'currentAddress', 'currentCity', 'currentState', 'currentZipCode', 'currentCountry',
      'yearsAtAddress', 'monthsAtAddress', 'housingStatus',
      'previousAddress', 'previousCity', 'previousState', 'previousZipCode', 'previousCountry',
      'yearsAtPreviousAddress', 'monthsAtPreviousAddress',
      'idNumber', 'driversLicenseNumber', 'driversLicenseState',
      'currentEmployer', 'jobTitle', 'yearsEmployed', 'monthsEmployed',
      'creditScore', 'isBusinessBuyer', 'businessName', 'businessEIN',
      'source', 'leadType', 'leadSource', 'inquiryType', 'contactMethod', 'contactTime',
      'notes', 'metaValue',
    ];

    for (const field of simpleFields) {
      if ((dto as any)[field] !== undefined) {
        (data as any)[field] = (dto as any)[field];
      }
    }

    // Date fields
    const dateFields = ['dateOfBirth', 'idExpirationDate', 'idIssueDate', 'driversLicenseExpiration'];
    for (const field of dateFields) {
      if ((dto as any)[field]) {
        (data as any)[field] = new Date((dto as any)[field]);
      }
    }

    // Decimal fields
    const decimalFields = ['monthlyHousingCost', 'monthlyIncome'];
    for (const field of decimalFields) {
      if ((dto as any)[field] !== undefined) {
        (data as any)[field] = new Prisma.Decimal((dto as any)[field]);
      }
    }

    // Relation fields
    if (dto.genderId !== undefined) {
      data.gender = dto.genderId ? { connect: { id: dto.genderId } } : { disconnect: true };
    }
    if (dto.preferredLanguageId !== undefined) {
      data.preferredLanguage = dto.preferredLanguageId ? { connect: { id: dto.preferredLanguageId } } : { disconnect: true };
    }
    if (dto.employmentStatusId !== undefined) {
      data.employmentStatus = dto.employmentStatusId ? { connect: { id: dto.employmentStatusId } } : { disconnect: true };
    }
    if (dto.occupationId !== undefined) {
      data.occupation = dto.occupationId ? { connect: { id: dto.occupationId } } : { disconnect: true };
    }
    if (dto.idTypeId !== undefined) {
      data.idType = dto.idTypeId ? { connect: { id: dto.idTypeId } } : { disconnect: true };
    }
    if (dto.idStateId !== undefined) {
      data.idState = dto.idStateId ? { connect: { id: dto.idStateId } } : { disconnect: true };
    }
    if (dto.salesPersonId !== undefined) {
      data.salesperson = dto.salesPersonId ? { connect: { id: dto.salesPersonId } } : { disconnect: true };
    }
    if (dto.bdcAgentId !== undefined) {
      data.bdcAgent = dto.bdcAgentId ? { connect: { id: dto.bdcAgentId } } : { disconnect: true };
    }

    const record = await this.buyer.update({
      where: { id },
      data,
      include: BUYER_INCLUDE,
    });

    return new BuyerEntity(record);
  }

  async remove(id: string, tenantId: string): Promise<{ message: string }> {
    await this.ensureBuyerExists(id, tenantId);
    await this.buyer.delete({ where: { id } });
    return { message: `Buyer ${id} deleted` };
  }

  // ── Private helpers ──────────────────────────────────────────

  private async ensureBuyerExists(id: string, tenantId: string): Promise<void> {
    const exists = await this.buyer.findFirst({
      where: { id, tenantId: tenantId || undefined },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException(`Buyer ${id} not found`);
    }
  }

  /**
   * Check if a buyer with the given email or phone already exists
   */
  async checkDuplicate(
    tenantId: string,
    email?: string,
    phoneMain?: string,
  ): Promise<{ emailExists: boolean; phoneExists: boolean }> {
    const normalizedPhone = phoneMain ? normalizePhoneNumber(phoneMain) : null;

    const [emailCheck, phoneCheck] = await Promise.all([
      email
        ? this.buyer.findFirst({
            where: { tenantId, email },
            select: { id: true },
          })
        : null,
      normalizedPhone
        ? this.buyer.findFirst({
            where: { tenantId, phoneMain: normalizedPhone },
            select: { id: true },
          })
        : null,
    ]);

    return {
      emailExists: !!emailCheck,
      phoneExists: !!phoneCheck,
    };
  }
}
