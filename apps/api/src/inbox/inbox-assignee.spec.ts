import { NotFoundException } from '@nestjs/common';
import { InboxService } from './inbox.service';

const TENANT_ID = 'tenant-1';
const USER_ID = 'user-42'; // contract's `assignedToId` — a User id
const TENANT_USER_ID = 'tenant-user-7'; // the DB column's actual value — a TenantUser id
const CONVERSATION_ID = 'conv-1';

/** Conversation row shape `ensureConversation`/`toView` read. */
const baseConversation = {
  id: CONVERSATION_ID,
  tenantId: TENANT_ID,
  channel: 'sms',
  provider: 'twilio',
  senderKind: 'twilio_number',
  senderKey: 'phone-1',
  socialAccountId: null,
  twilioPhoneNumberId: 'phone-1',
  contactExternalId: '+15550001111',
  contactName: null,
  contactHandle: null,
  contactPhone: '+15550001111',
  contactAvatarUrl: null,
  buyerId: null,
  status: 'open',
  assignedToId: null as string | null,
  unreadCount: 0,
  lastMessageAt: null,
  lastMessagePreview: null,
  lastDirection: null,
  lastInboundAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function buildService() {
  const tenantUserRow = { id: TENANT_USER_ID, tenantId: TENANT_ID, userId: USER_ID, user: { id: USER_ID, name: 'Ana Agente', email: 'ana@htownautos.com', avatar: null } };

  const conversations = new Map<string, typeof baseConversation>([[CONVERSATION_ID, { ...baseConversation }]]);

  const prisma = {
    inboxConversation: {
      findFirst: jest.fn(({ where }: any) => Promise.resolve(where.tenantId === TENANT_ID ? (conversations.get(where.id) ?? null) : null)),
      update: jest.fn(({ where, data }: any) => {
        const row = conversations.get(where.id)!;
        if (data.assignedTo?.connect) row.assignedToId = data.assignedTo.connect.id;
        if (data.assignedTo?.disconnect) row.assignedToId = null;
        conversations.set(where.id, row);
        return Promise.resolve({ ...row });
      }),
    },
    tenantUser: {
      // `assignedToId` write path: resolve a User id -> TenantUser id, tenant-scoped.
      findFirst: jest.fn(({ where }: any) => Promise.resolve(where.tenantId === TENANT_ID && where.userId === USER_ID ? tenantUserRow : null)),
      // `assignedTo` read path: load the TenantUser (+ user) for the view.
      findUnique: jest.fn(({ where }: any) => Promise.resolve(where.id === TENANT_USER_ID ? tenantUserRow : null)),
    },
    buyer: { findFirst: jest.fn(), findUnique: jest.fn(() => Promise.resolve(null)) },
    twilioPhoneNumber: { findFirst: jest.fn(() => Promise.resolve(null)) },
    socialAccount: { findFirst: jest.fn(() => Promise.resolve(null)) },
  };

  const realtime = { emit: jest.fn().mockResolvedValue(undefined) };
  const service = new InboxService(prisma as any, {} as any, {} as any, {} as any, realtime as any, {} as any, {} as any);
  return { service, prisma, realtime, conversations };
}

describe('InboxService — assignedToId translation (User id <-> TenantUser id)', () => {
  it('PATCH with a User id resolves it to the TenantUser id before storing', async () => {
    const { service, prisma } = buildService();

    const view = await service.updateConversation(TENANT_ID, CONVERSATION_ID, { assignedToId: USER_ID });

    // Stored value in the DB call must be the TenantUser id, never the raw User id.
    expect(prisma.inboxConversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignedTo: { connect: { id: TENANT_USER_ID } } }) }),
    );
    // What the response hands back is translated the other way: UserSummary.id === the original User id.
    expect(view.assignedTo).toEqual({ id: USER_ID, name: 'Ana Agente', email: 'ana@htownautos.com', avatar: null });
  });

  it('PATCH with null unassigns', async () => {
    const { service, prisma } = buildService();
    await service.updateConversation(TENANT_ID, CONVERSATION_ID, { assignedToId: USER_ID });

    const view = await service.updateConversation(TENANT_ID, CONVERSATION_ID, { assignedToId: null });

    expect(prisma.inboxConversation.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignedTo: { disconnect: true } }) }),
    );
    expect(view.assignedTo).toBeNull();
  });

  it('a User id from outside the tenant is rejected with 404, not silently stored', async () => {
    const { service } = buildService();
    await expect(service.updateConversation(TENANT_ID, CONVERSATION_ID, { assignedToId: 'someone-from-another-tenant' })).rejects.toThrow(NotFoundException);
  });
});
