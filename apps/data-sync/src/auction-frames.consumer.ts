import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { decodeSolaceFrame, type DecodedFrame } from '@htownautos/common';
import {
  RabbitMQService,
  AUCTION_FRAMES_QUEUE,
  type AuctionFrameMessage,
} from '@htownautos/rabbitmq';

/**
 * Decodifica los frames de la subasta en vivo y los guarda.
 *
 * Cada frame acaba en uno de tres sitios segun su tipo:
 *   BIDREC → auction_bid_events  (muchas por lote)
 *   SOLD   → auction_sale_results (una por lote y fecha)
 *   otro   → se marca `ignored`: keepalives y control de Solace pasan por el
 *            mismo socket y no son un error.
 *
 * El frame crudo se conserva pase lo que pase, asi que un fallo del parser se
 * arregla desplegando y reencolando, sin haber perdido nada.
 */
@Injectable()
export class AuctionFramesConsumer implements OnModuleInit {
  private readonly logger = new Logger(AuctionFramesConsumer.name);

  constructor(
    private readonly rabbitMQ: RabbitMQService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    // prefetch alto: cada mensaje son unas pocas escrituras cortas y en subasta
    // llegan a rafagas.
    await this.rabbitMQ.consume(
      AUCTION_FRAMES_QUEUE,
      async (raw) => this.handle(raw as AuctionFrameMessage),
      { prefetch: 20 },
    );
    this.logger.log('[Frames] Consumidor activo');
  }

  private async handle(msg: AuctionFrameMessage): Promise<void> {
    const row = await this.prisma.auctionRawFrame.findUnique({
      where: { id: msg.frameId },
    });
    // Ya procesado: un reintento de la cola no lo vuelve a escribir.
    if (!row || row.status === 'processed' || row.status === 'ignored') return;

    const decoded = decodeSolaceFrame(row.frame);

    if (!decoded || decoded.event === 'OTHER' || !decoded.lot) {
      await this.prisma.auctionRawFrame.update({
        where: { id: row.id },
        data: {
          status: 'ignored',
          event: decoded?.rawEvent ?? null,
          lot: decoded?.lot ? BigInt(decoded.lot) : null,
          // Se guarda igual: un evento que aun no tratamos —PREBID, SOLDPEND—
          // solo se puede evaluar viendo sus datos.
          summary: decoded ? (this.summarize(decoded) as any) : undefined,
          processedAt: new Date(),
        },
      });
      return;
    }

    try {
      if (decoded.event === 'BIDREC') await this.saveBid(decoded);
      else await this.saveSale(decoded);

      await this.prisma.auctionRawFrame.update({
        where: { id: row.id },
        data: {
          status: 'processed',
          event: decoded.rawEvent,
          lot: BigInt(decoded.lot),
          summary: this.summarize(decoded) as any,
          error: null,
          processedAt: new Date(),
        },
      });
    } catch (err: any) {
      // No se relanza: reintentar un frame que el parser no sabe tratar solo
      // lo devuelve a la cola en bucle. Queda `failed` y se reencola a mano
      // cuando el parser se arregle.
      await this.prisma.auctionRawFrame.update({
        where: { id: row.id },
        data: {
          status: 'failed',
          event: decoded.rawEvent,
          error: String(err?.message ?? err).slice(0, 500),
          processedAt: new Date(),
        },
      });
      this.logger.warn(`[Frames] ${row.id} fallo: ${err?.message}`);
    }
  }

  /** Lo que se enseña en el Live Feed. El payload entero sigue en `raw`. */
  private summarize(d: DecodedFrame) {
    return {
      sale: d.sale,
      lot: d.lot,
      itemNo: d.itemNo,
      amount: d.amount,
      askBid: d.askBid,
      nextBid: d.nextBid,
      increment: d.increment,
      reserveMet: d.reserveMet,
      approved: d.approved,
      buyerNo: d.buyerNo,
      buyerState: d.buyerState,
      buyerCountry: d.buyerCountry,
      emittedAt: d.emittedAt?.toISOString() ?? null,
      // El payload crudo tambien: es donde se ven los campos que todavia no
      // sabemos leer, que es justo lo que hace falta para PREBID y SOLDPEND.
      fields: d.payload,
    };
  }

  /** Una puja. Idempotente por (lot, emittedAt, bid). */
  private async saveBid(d: DecodedFrame): Promise<void> {
    const lot = BigInt(d.lot!);
    await this.prisma.auctionBidEvent
      .create({
        data: {
          lot,
          saleRoom: d.sale,
          itemNo: d.itemNo,
          bid: d.amount,
          askBid: d.askBid,
          nextBid: d.nextBid,
          increment: d.increment,
          reserveMet: d.reserveMet,
          approved: d.approved,
          buyerNo: d.buyerNo,
          buyerState: d.buyerState,
          buyerCountry: d.buyerCountry,
          emittedAt: d.emittedAt,
          raw: d.payload as any,
        },
      })
      .catch((e: any) => {
        // P2002 = la misma puja reenviada por dos VM. Es exito, no error.
        if (e?.code !== 'P2002') throw e;
      });
  }

  /**
   * El resultado de una venta.
   *
   * `saleDate` sale del instante en que Copart emitio el evento: es la fecha en
   * que de verdad se vendio, y es la mitad de la clave unica.
   */
  private async saveSale(d: DecodedFrame): Promise<void> {
    const lot = BigInt(d.lot!);
    const when = d.emittedAt ?? new Date();
    const saleDate =
      when.getUTCFullYear() * 10000 + (when.getUTCMonth() + 1) * 100 + when.getUTCDate();

    // El coche se copia de auction_listings si lo tenemos, para que Stats no
    // tenga que cruzar tablas en cada consulta.
    const listing = await this.prisma.auctionListing.findUnique({ where: { lotNumber: lot } });

    const datos = {
      saleRoom: d.sale,
      itemNo: d.itemNo,
      finalBid: d.amount,
      sold: true,
      reserveMet: d.reserveMet,
      approved: d.approved,
      buyerNo: d.buyerNo,
      buyerState: d.buyerState,
      buyerCountry: d.buyerCountry,
      emittedAt: d.emittedAt,
      receivedAt: new Date(),
      event: 'SOLD',
      matched: !!listing,
      ...(listing
        ? {
            vin: listing.vin,
            year: listing.year,
            make: listing.make,
            model: listing.modelGroup,
            modelDetail: listing.modelDetail,
            trim: listing.trim,
            bodyStyle: listing.bodyStyle,
            color: listing.color,
            damageDescription: listing.damageDescription,
            secondaryDamage: listing.secondaryDamage,
            saleTitleType: listing.saleTitleType,
            saleTitleState: listing.saleTitleState,
            odometer: listing.odometer,
            runsDrives: listing.runsDrives,
            transmission: listing.transmission,
            drive: listing.drive,
            fuelType: listing.fuelType,
            cylinders: listing.cylinders,
            estRetailValue: listing.estRetailValue,
            repairCost: listing.repairCost,
            yardNumber: listing.yardNumber,
            yardName: listing.yardName,
            locationCity: listing.locationCity,
            locationState: listing.locationState,
            locationZip: listing.locationZip,
            sellerName: listing.sellerName,
            sellerCategory: listing.sellerCategory,
          }
        : {}),
    };

    await this.prisma.auctionSaleResult.upsert({
      where: { lot_saleDate: { lot, saleDate } },
      create: { lot, saleDate, ...datos, raw: d.payload as any },
      update: datos,
    });
  }
}
