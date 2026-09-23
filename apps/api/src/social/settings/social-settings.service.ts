import { Injectable } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import type { AuthenticatedUser } from '@htownautos/auth';
import { SocialAccessService } from './social-access.service';
import { UpdateSocialSettingsDto } from './dto/update-social-settings.dto';

/** Response shape matches contract.ts `SocialSettings` exactly. */
export interface SocialSettingsResponse {
  approvalRequired: boolean;
  defaultTimezone: string;
  shortenLinks: boolean;
  utm: {
    enabled: boolean;
    source: string | null;
    medium: string;
    campaign: string | null;
  };
  canApprove: boolean;
  needsApproval: boolean;
}

@Injectable()
export class SocialSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SocialAccessService,
  ) {}

  async get(tenantId: string, user: AuthenticatedUser): Promise<SocialSettingsResponse> {
    const [row, canApprove] = await Promise.all([
      this.access.getSettings(tenantId),
      this.access.isAdmin(user, tenantId),
    ]);
    return this.toResponse(row, canApprove);
  }

  async update(
    tenantId: string,
    user: AuthenticatedUser,
    dto: UpdateSocialSettingsDto,
  ): Promise<SocialSettingsResponse> {
    // Ensures the row exists before the PATCH (upsert semantics for the whole flow).
    await this.access.getSettings(tenantId);

    const row = await this.prisma.socialSettings.update({
      where: { tenantId },
      data: {
        ...(dto.approvalRequired !== undefined ? { approvalRequired: dto.approvalRequired } : {}),
        ...(dto.defaultTimezone !== undefined ? { defaultTimezone: dto.defaultTimezone } : {}),
        ...(dto.shortenLinks !== undefined ? { shortenLinks: dto.shortenLinks } : {}),
        ...(dto.utm !== undefined
          ? {
              utmEnabled: dto.utm.enabled,
              utmSource: dto.utm.source ?? null,
              utmMedium: dto.utm.medium,
              utmCampaign: dto.utm.campaign ?? null,
            }
          : {}),
      },
    });

    const canApprove = await this.access.isAdmin(user, tenantId);
    return this.toResponse(row, canApprove);
  }

  private toResponse(
    row: Awaited<ReturnType<SocialAccessService['getSettings']>>,
    canApprove: boolean,
  ): SocialSettingsResponse {
    return {
      approvalRequired: row.approvalRequired,
      defaultTimezone: row.defaultTimezone,
      shortenLinks: row.shortenLinks,
      utm: {
        enabled: row.utmEnabled,
        source: row.utmSource,
        medium: row.utmMedium,
        campaign: row.utmCampaign,
      },
      canApprove,
      needsApproval: row.approvalRequired && !canApprove,
    };
  }
}
