import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { ClerkService, PORTAL_TENANT_ID } from '@htownautos/auth';
import { CreateBuyerDto } from './dto/create-buyer.dto';
import { UpdateBuyerDto } from './dto/update-buyer.dto';
import { QueryBuyerDto } from './dto/query-buyer.dto';
import { BuyerEntity } from './entities/buyer.entity';
import { PaginatedResponseDto } from '@htownautos/common';
import { normalizePhoneNumber, S3Service } from '@htownautos/common';
import { randomBytes } from 'crypto';

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

/** Minimum password length for auto-generated Clerk passwords. */
const GENERATED_PASSWORD_BYTES = 32;

@Injectable()
export class BuyersService {
  private readonly logger = new Logger(BuyersService.name);
  private readonly buyer: ReturnType<PrismaService['getModel']>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clerkService: ClerkService,
    private readonly s3: S3Service,
  ) {
    this.buyer = prisma.getModel('buyer');
  }

  // ── Buyer files (PDF/images/docs — private S3, staff-only) ─────────────────

  async presignFile(
    id: string,
    tenantId: string,
    filename: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; key: string }> {
    await this.ensureBuyerExists(id, tenantId);
    const ext = (filename.split('.').pop() || 'bin').toLowerCase().slice(0, 8);
    const { uploadUrl, key } = await this.s3.generatePresignedPutUrl(
      `files/buyers/${id}`,
      ext,
      contentType,
      true, // private
    );
    return { uploadUrl, key };
  }

  async saveFile(
    id: string,
    tenantId: string,
    body: { key: string; filename: string; contentType: string; size: number },
  ): Promise<{ id: string; filename: string }> {
    await this.ensureBuyerExists(id, tenantId);
    if (!body.key.startsWith(`files/buyers/${id}/`)) {
      throw new NotFoundException('Invalid file key');
    }
    const mediaType = body.contentType === 'application/pdf'
      ? 'document'
      : body.contentType.startsWith('image/')
        ? 'image'
        : 'document';
    const media = await this.prisma.media.create({
      data: {
        filename: body.filename,
        url: this.s3.buildPublicUrl(body.key),
        mimeType: body.contentType,
        size: body.size || 0,
        mediaType,
        category: 'file',
        storageKey: body.key,
        isPublic: false,
        buyerId: id,
        tenantId: tenantId || undefined,
      },
      select: { id: true, filename: true },
    });
    return media;
  }

  async listFiles(
    id: string,
    tenantId: string,
  ): Promise<Array<{ id: string; filename: string; mimeType: string; size: number; createdAt: Date; url: string | null }>> {
    await this.ensureBuyerExists(id, tenantId);
    const rows = await this.prisma.media.findMany({
      where: { buyerId: id, category: 'file', isActive: true },
      select: { id: true, filename: true, mimeType: true, size: true, createdAt: true, storageKey: true },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        filename: r.filename,
        mimeType: r.mimeType,
        size: r.size,
        createdAt: r.createdAt,
        url: r.storageKey ? await this.s3.getSignedUrl(r.storageKey, 300) : null,
      })),
    );
  }

  async deleteFile(id: string, tenantId: string, mediaId: string): Promise<{ ok: true }> {
    await this.ensureBuyerExists(id, tenantId);
    await this.prisma.media.updateMany({
      where: { id: mediaId, buyerId: id },
      data: { isActive: false },
    });
    return { ok: true };
  }

  // ── KYC ID documents (private S3, staff-only) ──────────────────────────────

  /** Presigned PUT URL to upload an ID document (front/back) to a private key. */
  async presignIdDocument(
    id: string,
    tenantId: string,
    side: 'front' | 'back',
    contentType: string,
  ): Promise<{ uploadUrl: string; key: string }> {
    await this.ensureBuyerExists(id, tenantId);
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const { uploadUrl, key } = await this.s3.generatePresignedPutUrl(
      `kyc/buyers/${id}/${side}`,
      ext,
      contentType,
      true, // private
    );
    return { uploadUrl, key };
  }

  /** Persist the uploaded ID document key on the buyer. */
  async saveIdDocument(
    id: string,
    tenantId: string,
    side: 'front' | 'back',
    key: string,
  ): Promise<{ ok: true }> {
    await this.ensureBuyerExists(id, tenantId);
    // Only accept keys under this buyer's KYC prefix — never an arbitrary key.
    if (!key.startsWith(`kyc/buyers/${id}/`)) {
      throw new NotFoundException('Invalid document key');
    }
    await this.buyer.update({
      where: { id },
      data: side === 'front' ? { idFrontKey: key } : { idBackKey: key },
    });
    return { ok: true };
  }

  /**
   * Persist an ID document from a Media row uploaded via an upload-session
   * (e.g. the customer's phone through the QR link). Verifies the media belongs
   * to this buyer before adopting its storage key.
   */
  async saveIdDocumentFromMedia(
    id: string,
    tenantId: string,
    side: 'front' | 'back',
    mediaId: string,
  ): Promise<{ ok: true }> {
    await this.ensureBuyerExists(id, tenantId);
    const media = await this.prisma.media.findFirst({
      where: { id: mediaId, buyerId: id },
      select: { storageKey: true, url: true },
    });
    if (!media?.storageKey) throw new NotFoundException('Media not found for this buyer');
    await this.buyer.update({
      where: { id },
      data: side === 'front' ? { idFrontKey: media.storageKey } : { idBackKey: media.storageKey },
    });
    return { ok: true };
  }

  /** Short-lived presigned GET URL to view an ID document, or null if unset. */
  async getIdDocumentUrl(
    id: string,
    tenantId: string,
    side: 'front' | 'back',
  ): Promise<{ url: string | null }> {
    await this.ensureBuyerExists(id, tenantId);
    const row = await this.buyer.findUnique({
      where: { id },
      select: { idFrontKey: true, idBackKey: true },
    });
    const key = side === 'front' ? row?.idFrontKey : row?.idBackKey;
    if (!key) return { url: null };
    const url = await this.s3.getSignedUrl(key, 300);
    return { url };
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

    // For the canonical portal tenant, auto-create a Clerk account so the
    // customer can sign in to htownautos.com immediately.  This is best-effort:
    // a Clerk failure must NOT block the staff workflow.
    // P0 hotfix (2026-09-24): auto-linking on create disabled. createUser()
    // could silently reset the password of a pre-existing Clerk account for
    // this email, enabling account takeover. Re-enable once a proper
    // verified-email sync design ships (see clerk-jwt.guard.ts linking rules).

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

    // Best-effort: if this buyer is in the portal tenant and still has no
    // clerkUserId but now has an email, attempt to create/link a Clerk account.
    // P0 hotfix (2026-09-24): auto-linking on update disabled, same reason
    // as the create path above — see clerk-jwt.guard.ts linking rules.

    return new BuyerEntity(record);
  }

  async remove(id: string, tenantId: string): Promise<{ message: string }> {
    await this.ensureBuyerExists(id, tenantId);
    await this.buyer.delete({ where: { id } });
    return { message: `Buyer ${id} deleted` };
  }

  async removeBulk(ids: string[], tenantId: string): Promise<{ message: string; count: number }> {
    const buyers = await this.buyer.findMany({
      where: { id: { in: ids }, tenantId: tenantId || undefined },
      select: { id: true },
    });

    const foundIds = buyers.map((b) => b.id);
    const notFound = ids.filter((id) => !foundIds.includes(id));
    if (notFound.length > 0) {
      throw new NotFoundException(
        `Buyers not found or not accessible: ${notFound.join(', ')}`,
      );
    }

    const result = await this.buyer.deleteMany({
      where: { id: { in: foundIds }, tenantId: tenantId || undefined },
    });

    return {
      message: `${result.count} customer(s) have been successfully deleted`,
      count: result.count,
    };
  }

  // ── Private helpers ──────────────────────────────────────────

  /**
   * Attempt to create (or link) a Clerk standalone account for a portal buyer.
   *
   * Rules:
   *  - Generates a cryptographically strong random password.  The customer
   *    never uses it — they authenticate via Clerk email-code or password-reset.
   *  - ClerkService.createUser() transparently handles "email already exists"
   *    by returning the existing user's id (via handleExistingUser).
   *  - If another Buyer row already owns the returned clerkUserId (dedup edge
   *    case), we log and skip to avoid violating the unique constraint.
   *  - All Clerk / DB errors are swallowed here: staff workflow continues.
   */
  private async linkClerkAccount(
    buyerId: string,
    email: string,
    firstName: string,
    lastName: string,
  ): Promise<void> {
    try {
      const password = randomBytes(GENERATED_PASSWORD_BYTES).toString('hex');

      const { clerkUserId } = await this.clerkService.createUser({
        email,
        password,
        firstName,
        lastName,
      });

      // Guard: check whether another buyer already holds this clerkUserId
      // (can happen when Clerk deduplication returns an id already linked
      //  to a different row in this tenant).
      const conflict = await this.prisma.buyer.findUnique({
        where: { clerkUserId },
        select: { id: true },
      });

      if (conflict && conflict.id !== buyerId) {
        this.logger.warn(
          `Clerk account ${clerkUserId} (${email}) is already linked to buyer ${conflict.id} — skipping link for buyer ${buyerId}`,
        );
        return;
      }

      await this.prisma.buyer.update({
        where: { id: buyerId },
        data: { clerkUserId },
      });

      this.logger.log(
        `Linked Clerk account ${clerkUserId} to buyer ${buyerId} (${email})`,
      );
    } catch (err: any) {
      this.logger.warn(
        `Best-effort Clerk account creation failed for buyer ${buyerId} (${email}): ${err?.message ?? String(err)}`,
      );
    }
  }

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
