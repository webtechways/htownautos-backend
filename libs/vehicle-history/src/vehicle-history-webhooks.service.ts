import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHmac } from 'crypto';
import { PrismaService } from '@htownautos/prisma';

/** Wait before retry N (after the first attempt fails). Then the delivery is given up. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];
const TIMEOUT_MS = 10_000;

/** Only public https endpoints: no IP literals, no localhost or internal names. */
export function isAllowedCallbackUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (/^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return false;
  return raw.length <= 500;
}

/**
 * Tells API callers when an order ends: a POST to its callbackUrl, signed with
 * the caller's own API key — `X-VH-Signature: t=<unix>,v1=<hex>` where
 * v1 = HMAC-SHA256(sha256hex(apiKey), `${t}.${body}`). The body only carries
 * ids and the outcome; callers fetch the order itself with their key.
 */
@Injectable()
export class VehicleHistoryWebhookService {
  private readonly logger = new Logger(VehicleHistoryWebhookService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Queues the notification for an order that just completed or failed, and tries it right away. */
  async enqueue(requestId: string): Promise<void> {
    try {
      const req = await this.prisma.vehicleHistoryRequest.findUnique({ where: { id: requestId }, select: { status: true, callbackUrl: true } });
      if (!req?.callbackUrl || (req.status !== 'completed' && req.status !== 'failed')) return;
      const event = req.status === 'completed' ? 'report.completed' : 'report.failed';
      const hook = await this.prisma.vehicleHistoryWebhook.create({ data: { requestId, url: req.callbackUrl, event } });
      void this.deliver(hook.id);
    } catch (err) {
      this.logger.warn(`Could not queue the webhook for ${requestId}: ${(err as Error).message}`);
    }
  }

  @Cron('* * * * *')
  async dispatchDue() {
    const due = await this.prisma.vehicleHistoryWebhook.findMany({
      where: { status: 'pending', nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: 'asc' },
      take: 50,
      select: { id: true },
    });
    for (const h of due) await this.deliver(h.id);
  }

  async deliver(id: string): Promise<void> {
    const hook = await this.prisma.vehicleHistoryWebhook.findUnique({ where: { id }, include: { request: true } });
    if (!hook || hook.status !== 'pending') return;
    const r = hook.request;
    const body = JSON.stringify({
      event: hook.event,
      deliveryId: hook.id,
      requestId: r.id,
      vin: r.vin,
      reportType: r.reportType,
      status: r.status,
      cacheHit: r.cacheHit,
      reportId: r.reportId,
      errorCode: r.errorCode,
      occurredAt: (r.completedAt ?? new Date()).toISOString(),
    });
    const t = Math.floor(Date.now() / 1000);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'vehicle-history-webhooks/1',
      'X-VH-Event': hook.event,
      'X-VH-Delivery': hook.id,
    };
    const keyId = r.requestedBy?.startsWith('api-key:') ? r.requestedBy.slice('api-key:'.length) : null;
    const key = keyId ? await this.prisma.apiKey.findUnique({ where: { id: keyId }, select: { hashedKey: true } }) : null;
    if (key) headers['X-VH-Signature'] = `t=${t},v1=${createHmac('sha256', key.hashedKey).update(`${t}.${body}`).digest('hex')}`;

    let status: number | null = null;
    let error: string | null = null;
    try {
      const res = await fetch(hook.url, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
      status = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (err) {
      error = String((err as Error)?.message ?? err).slice(0, 300);
    }
    const attempts = hook.attempts + 1;
    if (!error) {
      await this.prisma.vehicleHistoryWebhook.update({ where: { id }, data: { status: 'delivered', attempts, lastStatus: status, lastError: null, deliveredAt: new Date() } });
      return;
    }
    const wait = BACKOFF_MS[attempts - 1];
    await this.prisma.vehicleHistoryWebhook.update({
      where: { id },
      data: wait
        ? { attempts, lastStatus: status, lastError: error, nextAttemptAt: new Date(Date.now() + wait) }
        : { attempts, lastStatus: status, lastError: error, status: 'failed' },
    });
    this.logger.warn(`Webhook ${id} for ${r.id} failed (attempt ${attempts}): ${error}`);
  }
}
