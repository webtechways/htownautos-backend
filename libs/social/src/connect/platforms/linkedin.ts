import { socialFetch } from '../../http/social-http';
import type { ConnectedAccount, RefreshedProfile } from '../types';

/** Member profile + organization (company page) posting and stats. */
export const LINKEDIN_SCOPES = [
  'openid',
  'profile',
  'w_member_social',
  'r_organization_social',
  'w_organization_social',
  'rw_organization_admin',
];

export function buildLinkedInOAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: LINKEDIN_SCOPES.join(' '),
    response_type: 'code',
    state,
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}

interface LinkedInTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

interface LinkedInProfile {
  sub: string;
  name?: string;
  picture?: string;
}

interface LinkedInOrgAcl {
  elements?: { organizationalTarget: string; role: string }[];
}

interface LinkedInOrg {
  id: number;
  localizedName?: string;
  logoV2?: { original?: string };
}

async function exchangeLinkedInCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<LinkedInTokenResponse> {
  const res = await socialFetch('https://www.linkedin.com/oauth/v2/accessToken', {
    platform: 'linkedin',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  return res.json() as Promise<LinkedInTokenResponse>;
}

/**
 * Connects the member profile plus every organization (company page) the
 * member administers, per CONTRACT.md ("member + organizations"). Each
 * organization shares the member's access token — LinkedIn scopes
 * `w_organization_social` on the member grant, not on a separate token.
 */
export async function connectLinkedIn(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<ConnectedAccount[]> {
  const data = await exchangeLinkedInCode(clientId, clientSecret, code, redirectUri);
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);

  const profileRes = await socialFetch('https://api.linkedin.com/v2/userinfo', {
    platform: 'linkedin',
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  const profile = (await profileRes.json()) as LinkedInProfile;

  const accounts: ConnectedAccount[] = [
    {
      platform: 'linkedin',
      accountType: 'profile',
      platformAccountId: profile.sub,
      name: profile.name || 'LinkedIn Profile',
      avatarUrl: profile.picture ?? null,
      profileUrl: null,
      tokens: { accessToken: data.access_token, refreshToken: data.refresh_token ?? null, expiresAt },
      scopes: LINKEDIN_SCOPES,
    },
  ];

  try {
    const aclUrl = new URL('https://api.linkedin.com/v2/organizationAcls');
    aclUrl.searchParams.set('q', 'roleAssignee');
    aclUrl.searchParams.set('role', 'ADMINISTRATOR');
    aclUrl.searchParams.set('projection', '(elements*(organizationalTarget~(id,localizedName,logoV2(original~:playableStreams))))');
    const aclRes = await socialFetch(aclUrl.toString(), {
      platform: 'linkedin',
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    const aclData = (await aclRes.json()) as LinkedInOrgAcl & {
      elements?: { 'organizationalTarget~'?: LinkedInOrg }[];
    };
    for (const el of aclData.elements || []) {
      const org = el['organizationalTarget~'];
      if (!org) continue;
      accounts.push({
        platform: 'linkedin',
        accountType: 'organization',
        platformAccountId: String(org.id),
        name: org.localizedName || 'LinkedIn Organization',
        avatarUrl: null,
        profileUrl: `https://www.linkedin.com/company/${org.id}`,
        tokens: { accessToken: data.access_token, refreshToken: data.refresh_token ?? null, expiresAt },
        scopes: LINKEDIN_SCOPES,
      });
    }
  } catch {
    // Organization ACL lookup is best-effort — the member profile alone is still a valid connect.
  }

  return accounts;
}

/** Re-fetches the member's own profile — same `userinfo` call `connectLinkedIn` makes for the member account. Organization pages have no equivalent single-org GET in this connector, so `refresh()` only calls this for `accountType === 'profile'`. */
export async function fetchLinkedInProfile(accessToken: string): Promise<RefreshedProfile> {
  const res = await socialFetch('https://api.linkedin.com/v2/userinfo', {
    platform: 'linkedin',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = (await res.json()) as LinkedInProfile;
  return { name: profile.name || 'LinkedIn Profile', username: null, avatarUrl: profile.picture ?? null, profileUrl: null };
}

export async function refreshLinkedInToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: Date }> {
  const res = await socialFetch('https://www.linkedin.com/oauth/v2/accessToken', {
    platform: 'linkedin',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const data = (await res.json()) as LinkedInTokenResponse;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}
