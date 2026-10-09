import { AuctionSearchService } from './auction-search.service';

const URLS = ['https://vis.iaai.com/resizer?imageKeys=45958357~SID~B643~I1~S0~RI0~TH1', 'https://vis.iaai.com/resizer?imageKeys=45958357~SID~B643~I2~S0~RI0~TH1'];

function svc(row: object | null, reclamo = 1, publishOk = true) {
  const prisma = {
    iaaiListing: {
      findUnique: jest.fn().mockResolvedValue(row),
      updateMany: jest.fn().mockResolvedValueOnce({ count: reclamo }).mockResolvedValue({ count: 1 }),
    },
    imageCacheJob: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const rabbitMQ = { publish: jest.fn().mockResolvedValue(publishOk) };
  const s = Object.create(AuctionSearchService.prototype) as any;
  Object.assign(s, { prisma, rabbitMQ, logger: { log: jest.fn(), warn: jest.fn() } });
  return { s: s as AuctionSearchService, prisma, rabbitMQ };
}
const espera = () => new Promise((r) => setTimeout(r, 5));

describe('IAAI gallery on demand', () => {
  it('cacheada: nuestras URLs y no pide nada', async () => {
    const imgs = [{ sequence: 1, thumbnail: 'https://img.htownautos.com/iaai/1/1_thb.jpg', fullSize: 'x' }];
    const { s, rabbitMQ } = svc({ images: { images: imgs }, imageSourceUrls: URLS, imagesStatus: 'done', imagesClaimedAt: null });
    const g = await s.getIaaiGallery('iaai-1');
    expect(g.images).toEqual(imgs);
    expect(g.cached).toBe(true);
    await espera();
    expect(rabbitMQ.publish).not.toHaveBeenCalled();
  });

  it('sin cachear: URLs de IAAI al momento y el cacheo se publica', async () => {
    const { s, prisma, rabbitMQ } = svc({ images: null, imageSourceUrls: URLS, imagesStatus: 'pending', imagesClaimedAt: null });
    const g = await s.getIaaiGallery('45958357');
    expect(g.cached).toBe(false);
    expect(g.imageCount).toBe(2);
    await espera();
    expect(prisma.iaaiListing.updateMany.mock.calls[0][0].data.imagesStatus).toBe('processing');
    expect(prisma.imageCacheJob.updateMany.mock.calls[0][0].data.status).toBe('processing');
    expect(rabbitMQ.publish).toHaveBeenCalledWith('gallery.cache', expect.objectContaining({ lotNumber: '45958357', auction: 'IAAI', jobId: '45958357' }));
  });

  it('ya pedido hace poco: no se vuelve a encolar', async () => {
    const { s, rabbitMQ } = svc({ images: null, imageSourceUrls: URLS, imagesStatus: 'processing', imagesClaimedAt: new Date() });
    await s.getIaaiGallery('45958357');
    await espera();
    expect(rabbitMQ.publish).not.toHaveBeenCalled();
  });

  it('otra peticion gano el reclamo: no se publica dos veces', async () => {
    const { s, rabbitMQ } = svc({ images: null, imageSourceUrls: URLS, imagesStatus: 'pending', imagesClaimedAt: null }, 0);
    await s.getIaaiGallery('45958357');
    await espera();
    expect(rabbitMQ.publish).not.toHaveBeenCalled();
  });

  it('sin RabbitMQ: se devuelve a pendiente para el crawler', async () => {
    const { s, prisma } = svc({ images: null, imageSourceUrls: URLS, imagesStatus: 'pending', imagesClaimedAt: null }, 1, false);
    await s.getIaaiGallery('45958357');
    await espera();
    expect(prisma.imageCacheJob.updateMany.mock.calls.at(-1)[0].data.status).toBe('pending');
  });
});
