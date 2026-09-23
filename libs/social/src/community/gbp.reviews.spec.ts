import { toNormalized, type GbpReview } from './gbp.reviews';

function review(overrides: Partial<GbpReview>): GbpReview {
  return {
    reviewId: 'r1',
    reviewer: { displayName: 'Jane Doe', profilePhotoUrl: 'https://example.com/jane.jpg' },
    starRating: 'FOUR',
    comment: 'Great service!',
    createTime: '2026-01-01T00:00:00.000Z',
    updateTime: '2026-01-02T00:00:00.000Z',
    name: 'accounts/1/locations/2/reviews/r1',
    ...overrides,
  };
}

describe('gbp.reviews toNormalized', () => {
  it('maps the star rating enum to a 1..5 int', () => {
    expect(toNormalized('t1', 'a1', review({ starRating: 'ONE' })).rating).toBe(1);
    expect(toNormalized('t1', 'a1', review({ starRating: 'THREE' })).rating).toBe(3);
    expect(toNormalized('t1', 'a1', review({ starRating: 'FIVE' })).rating).toBe(5);
  });

  it('rating is null when the platform omits starRating', () => {
    const node = review({});
    delete node.starRating;
    expect(toNormalized('t1', 'a1', node).rating).toBeNull();
  });

  it('maps the rest of the fields verbatim, kind "review", externalPostId always null', () => {
    const n = toNormalized('tenant-1', 'account-1', review({}));
    expect(n).toMatchObject({
      tenantId: 'tenant-1',
      accountId: 'account-1',
      platform: 'gbp',
      kind: 'review',
      externalId: 'accounts/1/locations/2/reviews/r1',
      externalPostId: null,
      externalParentId: null,
      authorName: 'Jane Doe',
      authorAvatarUrl: 'https://example.com/jane.jpg',
      body: 'Great service!',
      fromUs: false,
    });
    // Prefers updateTime over createTime for platformCreatedAt (so an edited review resurfaces on the next poll).
    expect(n.platformCreatedAt).toEqual(new Date('2026-01-02T00:00:00.000Z'));
  });

  it('falls back to a generic author name when the platform gives none', () => {
    const node = review({ reviewer: undefined });
    expect(toNormalized('t1', 'a1', node).authorName).toBe('Google user');
  });
});
