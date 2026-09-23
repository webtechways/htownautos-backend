import { messengerMessenger, instagramMessenger } from './meta-dm.messenger';
import { whatsappMessenger } from './whatsapp.messenger';
import { xMessenger } from './x.messenger';

const HOUR = 60 * 60 * 1000;

describe('messaging window rules', () => {
  describe('Messenger (Facebook) — 24h RESPONSE window + 7d HUMAN_AGENT extension', () => {
    it('canReply within 24h', () => {
      const info = messengerMessenger.windowInfo(new Date(Date.now() - 1 * HOUR));
      expect(info.canReply).toBe(true);
      expect(info.replyRequiresTemplate).toBe(false);
    });

    it('still canReply between 24h and 7d (HUMAN_AGENT tag extension)', () => {
      const info = messengerMessenger.windowInfo(new Date(Date.now() - 48 * HOUR));
      expect(info.canReply).toBe(true);
    });

    it('cannot reply past 7 days', () => {
      const info = messengerMessenger.windowInfo(new Date(Date.now() - 8 * 24 * HOUR));
      expect(info.canReply).toBe(false);
    });

    it('no inbound message at all → cannot reply', () => {
      const info = messengerMessenger.windowInfo(null);
      expect(info.canReply).toBe(false);
      expect(info.windowExpiresAt).toBeNull();
    });
  });

  describe('Instagram — strict 24h, no HUMAN_AGENT extension', () => {
    it('canReply within 24h', () => {
      expect(instagramMessenger.windowInfo(new Date(Date.now() - 1 * HOUR)).canReply).toBe(true);
    });

    it('cannot reply once 24h has passed (unlike Messenger)', () => {
      expect(instagramMessenger.windowInfo(new Date(Date.now() - 48 * HOUR)).canReply).toBe(false);
    });
  });

  describe('WhatsApp Cloud — 24h customer-service window, template required outside it', () => {
    it('within window: can reply freely, no template required', () => {
      const info = whatsappMessenger.windowInfo(new Date(Date.now() - 1 * HOUR));
      expect(info.canReply).toBe(true);
      expect(info.replyRequiresTemplate).toBe(false);
    });

    it('outside window: replyRequiresTemplate flips true', () => {
      const info = whatsappMessenger.windowInfo(new Date(Date.now() - 25 * HOUR));
      expect(info.replyRequiresTemplate).toBe(true);
    });

    it('no inbound message yet: still requires a template (can only start with one)', () => {
      const info = whatsappMessenger.windowInfo(null);
      expect(info.replyRequiresTemplate).toBe(true);
    });
  });

  describe('X — no time window modeled (DMs stay open)', () => {
    it('always canReply, regardless of lastInboundAt', () => {
      expect(xMessenger.windowInfo(null).canReply).toBe(true);
      expect(xMessenger.windowInfo(new Date(Date.now() - 30 * 24 * HOUR)).canReply).toBe(true);
    });
  });
});
