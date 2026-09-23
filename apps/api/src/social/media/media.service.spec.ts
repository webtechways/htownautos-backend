import { ConflictException } from '@nestjs/common';
import { SocialMediaService } from './media.service';

const TENANT_ID = 'tenant-1';
const MEDIA_ID = 'media-1';

const mediaRow = {
  id: MEDIA_ID,
  tenantId: TENANT_ID,
  key: 'social/tenant-1/foo.jpg',
  kind: 'image',
  mimeType: 'image/jpeg',
  fileName: 'foo.jpg',
  sizeBytes: 100,
  width: null,
  height: null,
  durationSec: null,
  altText: null,
  thumbnailKey: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

/** `$queryRaw` is a tagged-template call — the mock must accept `(strings, ...values)` like the real client. */
function buildService(queryRawResult: Array<{ id: string }>) {
  const queryRaw = jest.fn((_strings: TemplateStringsArray, ...values: unknown[]) => {
    // Sanity check the call actually carries the tenant + media id as bound params, not string-concatenated.
    expect(values).toEqual(expect.arrayContaining([TENANT_ID]));
    return Promise.resolve(queryRawResult);
  });

  const prisma = {
    socialMedia: {
      findFirst: jest.fn(() => Promise.resolve(mediaRow)),
      delete: jest.fn(() => Promise.resolve(mediaRow)),
    },
    socialPost: { findFirst: jest.fn(() => Promise.resolve(null)) },
    socialIdea: { findFirst: jest.fn(() => Promise.resolve(null)) },
    $queryRaw: queryRaw,
  };

  const s3 = { deleteFile: jest.fn().mockResolvedValue(undefined) };
  const resolver = {};
  const service = new SocialMediaService(prisma as any, s3 as any, resolver as any);
  return { service, prisma, s3 };
}

describe('SocialMediaService.remove — SocialPostTarget.mediaOverride usage check', () => {
  it('409s when a not-yet-published target references the media in mediaOverride', async () => {
    const { service, prisma } = buildService([{ id: 'target-1' }]);

    await expect(service.remove(TENANT_ID, MEDIA_ID)).rejects.toThrow(ConflictException);
    expect(prisma.socialMedia.delete).not.toHaveBeenCalled();
  });

  it('deletes when no post, idea, or target references the media', async () => {
    const { service, prisma, s3 } = buildService([]);

    const result = await service.remove(TENANT_ID, MEDIA_ID);

    expect(result).toEqual({ message: 'Archivo eliminado' });
    expect(prisma.socialMedia.delete).toHaveBeenCalledWith({ where: { id: MEDIA_ID } });
    expect(s3.deleteFile).toHaveBeenCalledWith(mediaRow.key);
  });
});
