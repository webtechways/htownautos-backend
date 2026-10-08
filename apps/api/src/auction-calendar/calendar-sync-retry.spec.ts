import { AuctionCalendarService } from './auction-calendar.service';

const ok = (body: unknown) => ({ proxy: '9.9.9.9:80', status: 200, body: Buffer.from(JSON.stringify(body)), contentType: 'application/json', error: null, ms: 5 });
const blocked = (proxy: string) => ({ proxy, status: 403, body: Buffer.from('<html>'), contentType: 'text/html', error: null, ms: 5 });

function svc(fetchOnce: jest.Mock) {
  return new AuctionCalendarService({} as any, { fetchOnce } as any) as any;
}

describe('calendar sync retries', () => {
  it('reintenta por otro proxy y apunta cada intento', async () => {
    const fetchOnce = jest.fn()
      .mockResolvedValueOnce(blocked('1.1.1.1:80'))
      .mockResolvedValueOnce({ proxy: '2.2.2.2:80', status: 200, body: Buffer.from('<html>challenge'), contentType: 'text/html', error: null, ms: 5 })
      .mockResolvedValueOnce(ok({ auctions: { live: {} } }));
    const attempts: any[] = [];
    const json = await svc(fetchOnce).fetchCalendarJson({ maxAttempts: 4, retryDelaySeconds: 0 }, attempts);
    expect(json.auctions).toBeDefined();
    expect(attempts.map((a) => [a.n, a.proxy, a.status])).toEqual([[1, '1.1.1.1:80', 403], [2, '2.2.2.2:80', 200], [3, '9.9.9.9:80', 200]]);
    expect(attempts[0].error).toMatch(/403/);
    expect(attempts[1].error).toMatch(/no es JSON/);
    expect(attempts[2].error).toBeNull();
  });

  it('agota los intentos y lanza con el ultimo error', async () => {
    const fetchOnce = jest.fn().mockResolvedValue(blocked('1.1.1.1:80'));
    const attempts: any[] = [];
    await expect(svc(fetchOnce).fetchCalendarJson({ maxAttempts: 3, retryDelaySeconds: 0 }, attempts)).rejects.toThrow(/3 intento\(s\).*403/);
    expect(fetchOnce).toHaveBeenCalledTimes(3);
  });

  it('espera entre intentos lo configurado', async () => {
    jest.useFakeTimers();
    const fetchOnce = jest.fn().mockResolvedValueOnce(blocked('a:1')).mockResolvedValueOnce(ok({ auctions: {} }));
    const p = svc(fetchOnce).fetchCalendarJson({ maxAttempts: 2, retryDelaySeconds: 30 }, []);
    await jest.advanceTimersByTimeAsync(29_000);
    expect(fetchOnce).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1_000);
    await p;
    expect(fetchOnce).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});
