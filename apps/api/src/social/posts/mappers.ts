import type { Prisma, SocialAccount as PrismaSocialAccount, TenantUser, User } from '@prisma/client';
import { MediaResolverService } from '@htownautos/social';
import { PrismaService } from '@htownautos/prisma';
import type {
  AccountStatus,
  AccountType,
  MediaKind,
  PublishMethod,
  SocialPlatform,
  ThreadItem,
} from '@htownautos/social';

/** Verbatim shape of contract.ts `AccountSummary`. */
export interface AccountSummaryView {
  id: string;
  platform: SocialPlatform;
  accountType: AccountType | null;
  publishMethod: PublishMethod;
  status: AccountStatus;
  name: string;
  username: string | null;
  avatarUrl: string | null;
}

/** Verbatim shape of contract.ts `UserSummary`. */
export interface UserSummaryView {
  id: string;
  name: string | null;
  email: string;
  avatar: string | null;
}

/** Verbatim shape of contract.ts `SocialMediaItem`. */
export interface SocialMediaItemView {
  id: string;
  kind: MediaKind;
  mimeType: string;
  fileName: string | null;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  altText: string | null;
  url: string;
  thumbnailUrl: string | null;
  createdAt: string;
}

/** Verbatim shape of contract.ts `PlatformOptions` — a bag keyed by platform, read loosely (JSON column). */
export type PlatformOptionsView = Record<string, Record<string, unknown> | undefined>;

export function toAccountSummary(account: PrismaSocialAccount): AccountSummaryView {
  return {
    id: account.id,
    platform: account.platform as SocialPlatform,
    accountType: (account.accountType as AccountType | null) ?? null,
    publishMethod: account.publishMethod as PublishMethod,
    status: account.status as AccountStatus,
    name: account.name,
    username: account.username,
    avatarUrl: account.avatarUrl,
  };
}

type TenantUserWithUser = TenantUser & { user: Pick<User, 'id' | 'name' | 'email' | 'avatar'> };

export function toUserSummary(tenantUser: TenantUserWithUser | null | undefined): UserSummaryView | null {
  if (!tenantUser) return null;
  return {
    id: tenantUser.user.id,
    name: tenantUser.user.name,
    email: tenantUser.user.email,
    avatar: tenantUser.user.avatar,
  };
}

export function toThreadItems(json: Prisma.JsonValue | null | undefined): ThreadItem[] {
  if (!Array.isArray(json)) return [];
  return json as unknown as ThreadItem[];
}

export function toPlatformOptions(json: Prisma.JsonValue | null | undefined): PlatformOptionsView {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {};
  return json as unknown as PlatformOptionsView;
}

export function toMediaIdsOverride(json: Prisma.JsonValue | null | undefined): string[] | null {
  if (!Array.isArray(json)) return null;
  return json as unknown as string[];
}

/**
 * Resolves a batch of `SocialMedia` ids into signed-URL view objects in one
 * shot — used to build every post/target's `media` field without an N+1
 * (one `findMany` + one parallel `signedUrl` per row, shared across a whole
 * list response).
 */
export async function resolveMediaMap(
  prisma: PrismaService,
  resolver: MediaResolverService,
  tenantId: string,
  mediaIds: readonly string[],
): Promise<Map<string, SocialMediaItemView>> {
  const uniqueIds = Array.from(new Set(mediaIds)).filter(Boolean);
  if (uniqueIds.length === 0) return new Map();

  const rows = await prisma.socialMedia.findMany({ where: { id: { in: uniqueIds }, tenantId } });
  const entries = await Promise.all(
    rows.map(async (row): Promise<[string, SocialMediaItemView]> => {
      const [url, thumbnailUrl] = await Promise.all([
        resolver.signedUrl(row),
        row.thumbnailKey ? resolver.signedUrl(row.thumbnailKey) : Promise.resolve(null),
      ]);
      return [
        row.id,
        {
          id: row.id,
          kind: row.kind as MediaKind,
          mimeType: row.mimeType,
          fileName: row.fileName,
          sizeBytes: row.sizeBytes,
          width: row.width,
          height: row.height,
          durationSec: row.durationSec,
          altText: row.altText,
          url,
          thumbnailUrl,
          createdAt: row.createdAt.toISOString(),
        },
      ];
    }),
  );
  return new Map(entries);
}
