import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import {
  bidNoPriceId,
  broadcastAuctionOf,
  decodeBroadcastMessage,
  decodeSolaceFrame,
  isBidEvent,
  isSaleEvent,
  saleDayMMDDYYYY,
  type DecodedFrame,
} from '@htownautos/common';
import {
  RabbitMQService,
  AUCTION_FRAMES_QUEUE,
  type AuctionFrameMessage,
} from '@htownautos/rabbitmq';

/**
 * Decodifica los frames de la subasta en vivo y los guarda.
 *
 * Llegan de dos sockets distintos (`source` en la fila):
 *   room      → Solace binario en base64, tres capas que hay que abrir.
 *   broadcast → Socket.IO en texto de AutoBidMaster, ya estructurado.
 * Los dos decodificadores devuelven la misma forma y a partir de ahi el
 * camino es uno solo.
 *
 * Cada frame acaba en uno de tres sitios segun su tipo:
 *   BIDREC → auction_bid_events  (muchas por lote)
 *   SOLD   → auction_sale_results (una por lote y fecha)
 *   otro   → se marca `ignored`: keepalives y control de Solace pasan por el
 *            mismo socket y no son un error.
 *
 * El frame crudo **solo se conserva cuando la decodificacion fallo**, que es el
 * unico caso en que es irreemplazable. Si se decodifico, `summary.fields` ya
 * tiene el payload entero en forma legible: guardar ademas el base64 original
 * es pagar 1.220 bytes por fila —el 60% de la tabla— por una copia peor de algo
 * que ya esta ahi.
 *
 * Un `ignored` conserva por tanto todo lo que hace falta para decidir que hacer
 * con un evento nuevo, que es justo para lo que existe.
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
    // Los frames IAAI con importe que llegaron antes de existir sus tablas se
    // quedaron `ignored`; se recuperan una vez, en segundo plano.
    void this.recuperarIaaiPendientes().catch((err) =>
      this.logger.warn(`[Frames] recuperacion IAAI fallo: ${err?.message ?? err}`),
    );
  }

  private async handle(msg: AuctionFrameMessage): Promise<void> {
    const row = await this.prisma.auctionRawFrame.findUnique({
      where: { id: msg.frameId },
    });
    // Ya procesado: un reintento de la cola no lo vuelve a escribir.
    if (!row || row.status === 'processed' || row.status === 'ignored') return;

    const broadcast = row.source === 'broadcast';
    const decoded = broadcast
      ? decodeBroadcastMessage(row.frame, row.capturedAt ?? row.receivedAt)
      : decodeSolaceFrame(row.frame);

    // De que subasta es: las salas `iaa-*` (SalvageBid) nunca van a las tablas
    // de Copart — sus lotes son stock numbers de IAAI y podrian chocar.
    const subasta = broadcast ? broadcastAuctionOf((decoded?.payload as any)?.auction) : 'copart';
    const sinImporte = !!decoded && decoded.amount == null && decoded.askBid == null;

    if (broadcast && subasta === 'iaai' && decoded && !sinImporte) {
      // IAAI con importe (fuente con sesion) → iaai_bid_events, y la venta a
      // iaai_sale_results.
      await this.procesarIaaiConImporte(row.id, decoded, row.capturedAt ?? row.receivedAt);
      return;
    }

    // Puja de difusion sin importe (fuente sin sesion): a bid_no_price o
    // bid_no_price_iaai segun la sala.
    if (broadcast && subasta && decoded && decoded.event !== 'OTHER' && decoded.lot && sinImporte) {
      try {
        const at = row.capturedAt ?? row.receivedAt;
        const id = await this.saveBidNoPrice(
          subasta === 'iaai' ? 'bid_no_price_iaai' : 'bid_no_price',
          decoded,
          at,
        );
        // IAAI vendido sin importe: la venta se registra igual (sin precio); si
        // otra fuente trae el importe, lo completa.
        if (id && subasta === 'iaai' && isSaleEvent(decoded.event)) await this.saveIaaiSale(decoded, at);
        await this.prisma.auctionRawFrame.update({
          where: { id: row.id },
          data: {
            status: id ? 'processed' : 'ignored',
            event: decoded.rawEvent,
            lot: BigInt(decoded.lot),
            summary: { ...(this.summarize(decoded) as object), bidNoPriceId: id } as any,
            frame: '',
            error: id ? null : 'sin order: no se puede identificar la puja',
            processedAt: new Date(),
          },
        });
      } catch (err: any) {
        await this.prisma.auctionRawFrame.update({
          where: { id: row.id },
          data: { status: 'failed', event: decoded.rawEvent, error: String(err?.message ?? err).slice(0, 500), processedAt: new Date() },
        });
        this.logger.warn(`[Frames] ${row.id} (sin importe) fallo: ${err?.message}`);
      }
      return;
    }

    if (!decoded || decoded.event === 'OTHER' || !decoded.lot) {
      await this.prisma.auctionRawFrame.update({
        where: { id: row.id },
        data: {
          status: 'ignored',
          event: decoded?.rawEvent ?? null,
          lot: decoded?.lot ? BigInt(decoded.lot) : null,
          // Se decodifico: el payload vive en `summary.fields` y el base64 ya
          // no aporta. Si NO se decodifico, se conserva — es lo unico que
          // permitiria arreglarlo.
          frame: decoded ? '' : undefined,
          // Se guarda igual: un evento que aun no tratamos —PREBID, SOLDPEND—
          // solo se puede evaluar viendo sus datos.
          summary: decoded ? (this.summarize(decoded) as any) : undefined,
          processedAt: new Date(),
        },
      });
      return;
    }

    try {
      if (isBidEvent(decoded.event)) {
        await (broadcast ? this.saveBroadcastBid(decoded) : this.saveBid(decoded));
      } else {
        await this.saveSale(decoded);
      }

      await this.prisma.auctionRawFrame.update({
        where: { id: row.id },
        data: {
          status: 'processed',
          event: decoded.rawEvent,
          lot: BigInt(decoded.lot),
          summary: this.summarize(decoded) as any,
          // Guardado en su tabla con forma: el base64 es duplicado.
          frame: '',
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

  /** Una puja, en vivo o previa. Idempotente por (lot, tipo, instante, importe). */
  private async saveBid(d: DecodedFrame): Promise<void> {
    const lot = BigInt(d.lot!);
    await this.prisma.auctionBidEvent
      .create({
        data: {
          lot,
          eventType: d.event,
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
   * Una puja de difusion sin importe, en una sola sentencia atomica.
   *
   * Pueden llegar a la vez la misma puja desde diez fuentes (prefetch 20 y
   * varias VM): la clave primaria `{order}-{sala}-{lote}-{MMDDYYYY}` hace que
   * Postgres deje una sola fila, y ON CONFLICT fusiona en vez de fallar:
   *   - sold: true si cualquier copia lo trae (la venta reusa el order de la
   *     ultima puja, asi que llega como "duplicado" de esa puja);
   *   - round: el mayor visto; ticks: el de la venta si la hay;
   *   - firstSeenAt / lastSeenAt: el primero y el ultimo; seenCount: +1.
   * Devuelve el id, o null si falta el order.
   */
  private async saveBidNoPrice(
    tabla: 'bid_no_price' | 'bid_no_price_iaai',
    d: DecodedFrame,
    at: Date,
  ): Promise<string | null> {
    const p = d.payload as Record<string, any>;
    const id = bidNoPriceId(p.auction, d.lot, p.order, at);
    if (!id) return null;
    const room = String(p.auction).trim().toLowerCase();
    const sold = p.sold === true;
    const round = Number.isFinite(Number(p.round)) ? Number(p.round) : null;
    const ticks = Number.isFinite(Number(p.ticks)) ? Number(p.ticks) : null;
    const reserve = typeof p.reserve === 'boolean' ? p.reserve : null;
    const saleDay = id.slice(id.lastIndexOf('-') + 1);

    // El nombre de la tabla viene de la union de arriba, nunca de los datos.
    const t = Prisma.raw(tabla === 'bid_no_price_iaai' ? 'bid_no_price_iaai' : 'bid_no_price');
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO ${t} AS b
        (id, room, "saleRoom", lot, "order", "saleDay", country, sold, round, ticks, reserve,
         "seenCount", "firstSeenAt", "lastSeenAt", raw)
      VALUES
        (${id}, ${room}, ${d.sale}, ${BigInt(d.lot!)}, ${Number(p.order)}, ${saleDay}, ${d.buyerCountry},
         ${sold}, ${round}, ${ticks}, ${reserve}, 1, ${at}, ${at}, ${JSON.stringify(p)}::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        sold          = b.sold OR EXCLUDED.sold,
        round         = GREATEST(b.round, EXCLUDED.round),
        ticks         = CASE WHEN EXCLUDED.sold THEN EXCLUDED.ticks ELSE b.ticks END,
        country       = COALESCE(b.country, EXCLUDED.country),
        reserve       = COALESCE(EXCLUDED.reserve, b.reserve),
        raw           = CASE WHEN EXCLUDED.sold AND NOT b.sold THEN EXCLUDED.raw ELSE b.raw END,
        "seenCount"   = b."seenCount" + 1,
        "firstSeenAt" = LEAST(b."firstSeenAt", EXCLUDED."firstSeenAt"),
        "lastSeenAt"  = GREATEST(b."lastSeenAt", EXCLUDED."lastSeenAt")`);
    return id;
  }

  /** Puja (y venta si lo es) de IAAI con importe; marca el frame. */
  private async procesarIaaiConImporte(frameId: string, d: DecodedFrame, at: Date): Promise<void> {
    const where = { id: frameId };
    try {
      const id = await this.saveIaaiBid(d, at);
      if (isSaleEvent(d.event)) await this.saveIaaiSale(d, at);
      await this.prisma.auctionRawFrame.update({
        where,
        data: {
          status: id ? 'processed' : 'ignored',
          event: d.rawEvent,
          lot: d.lot ? BigInt(d.lot) : null,
          summary: { ...(this.summarize(d) as object), iaaiBidId: id } as any,
          frame: '',
          error: id ? null : 'sin order: no se puede identificar la puja',
          processedAt: new Date(),
        },
      });
    } catch (err: any) {
      await this.prisma.auctionRawFrame.update({
        where,
        data: { status: 'failed', event: d.rawEvent, error: String(err?.message ?? err).slice(0, 500), processedAt: new Date() },
      });
      this.logger.warn(`[Frames] ${frameId} (IAAI) fallo: ${err?.message}`);
    }
  }

  /**
   * Una puja IAAI con importe, idempotente: mismo id que bid_no_price_iaai
   * (`{order}-{sala}-{lote}-{MMDDYYYY}`). La venta reusa el order de la ultima
   * puja, asi que llega como esa puja con `sold: true` y la marca vendida.
   * Devuelve el id, o null si falta el order o el lote.
   */
  private async saveIaaiBid(d: DecodedFrame, at: Date): Promise<string | null> {
    const p = d.payload as Record<string, any>;
    if (!d.lot) return null;
    const id = bidNoPriceId(p.auction, d.lot, p.order, at);
    if (!id) return null;
    const room = String(p.auction).trim().toLowerCase();
    const sold = p.sold === true || isSaleEvent(d.event);
    const round = Number.isFinite(Number(p.round)) ? Number(p.round) : null;
    const ticks = Number.isFinite(Number(p.ticks)) ? Number(p.ticks) : null;
    const reserve = typeof p.reserve === 'boolean' ? p.reserve : null;
    const saleDay = id.slice(id.lastIndexOf('-') + 1);
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO iaai_bid_events AS b
        (id, room, "saleRoom", lot, "order", "saleDay", bid, asking, increment, country, sold, round, ticks, reserve,
         "seenCount", "firstSeenAt", "lastSeenAt", raw)
      VALUES
        (${id}, ${room}, ${d.sale}, ${BigInt(d.lot)}, ${Number(p.order)}, ${saleDay}, ${d.amount}, ${d.askBid}, ${d.increment},
         ${d.buyerCountry}, ${sold}, ${round}, ${ticks}, ${reserve}, 1, ${at}, ${at}, ${JSON.stringify(p)}::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        bid           = GREATEST(b.bid, EXCLUDED.bid),
        asking        = GREATEST(b.asking, EXCLUDED.asking),
        increment     = COALESCE(EXCLUDED.increment, b.increment),
        sold          = b.sold OR EXCLUDED.sold,
        round         = GREATEST(b.round, EXCLUDED.round),
        ticks         = CASE WHEN EXCLUDED.sold THEN EXCLUDED.ticks ELSE b.ticks END,
        country       = COALESCE(b.country, EXCLUDED.country),
        reserve       = COALESCE(EXCLUDED.reserve, b.reserve),
        raw           = CASE WHEN EXCLUDED.sold AND NOT b.sold THEN EXCLUDED.raw ELSE b.raw END,
        "seenCount"   = b."seenCount" + 1,
        "firstSeenAt" = LEAST(b."firstSeenAt", EXCLUDED."firstSeenAt"),
        "lastSeenAt"  = GREATEST(b."lastSeenAt", EXCLUDED."lastSeenAt")`);
    return id;
  }

  /**
   * La venta de un lote IAAI → iaai_sale_results (una por stock number y dia de
   * subasta, hora de Chicago). Columnas iguales que auction_sale_results; el
   * coche se copia de iaai_listings. El mismo SOLD llega de varias fuentes y
   * durante minutos: el upsert lo deja en una fila y nunca borra un importe
   * con un null.
   */
  private async saveIaaiSale(d: DecodedFrame, at: Date): Promise<void> {
    if (!d.lot) return;
    const p = d.payload as Record<string, any>;
    const lot = BigInt(d.lot);
    const dia = saleDayMMDDYYYY(at); // MMDDYYYY
    const saleDate = Number(dia.slice(4) + dia.slice(0, 2) + dia.slice(2, 4));
    const l = await this.prisma.iaaiListing.findUnique({ where: { stockNumber: d.lot } });
    const order = Number.isFinite(Number(p.order)) ? Number(p.order) : null;

    const venta = {
      auctionSession: typeof p.auction === 'string' ? p.auction.trim().toLowerCase() : null,
      saleRoom: d.sale,
      finalBid: d.amount,
      askingPrice: d.askBid,
      reserve: typeof p.reserve === 'boolean' ? p.reserve : null,
      sold: true,
      ticks: Number.isFinite(Number(p.ticks)) ? Number(p.ticks) : null,
      round: Number.isFinite(Number(p.round)) ? Number(p.round) : null,
      saleOrder: order,
      event: d.event,
      buyerCountry: d.buyerCountry,
      emittedAt: d.emittedAt ?? at,
    };
    const coche = l
      ? {
          matched: true,
          vin: l.vin,
          year: l.year,
          make: l.make,
          model: l.model,
          modelDetail: l.series,
          bodyStyle: l.bodyStyle,
          color: l.color,
          damageDescription: l.primaryDamage,
          secondaryDamage: l.secondaryDamage,
          saleTitleType: l.saleDocument,
          saleTitleState: l.certState,
          odometer: l.odometer,
          runsDrives: l.runAndDrive ? 'Run & Drive' : l.startCode,
          engine: l.engineSize,
          transmission: l.transmission,
          drive: l.drivelineType,
          fuelType: l.fuelType,
          cylinders: l.cylinders,
          estRetailValue: l.acv,
          repairCost: l.repairCost,
          highBidAtSync: l.currentBid,
          yardNumber: l.branchCode,
          yardName: l.branchName,
          locationCity: l.locationCity,
          locationState: l.locationState,
          locationZip: l.locationZip,
          sellerName: l.seller,
        }
      : { matched: false };
    // En el update solo lo que trae valor: una copia sin importe no pisa la que si.
    const update = Object.fromEntries(Object.entries({ ...venta, ...coche }).filter(([, v]) => v !== null && v !== undefined));

    await this.prisma.iaaiSaleResult.upsert({
      where: { lot_saleDate: { lot, saleDate } },
      create: { lot, saleDate, ...venta, ...coche, receivedAt: new Date(), raw: p as any },
      update,
    });
  }

  /**
   * Una sola vez: los frames IAAI con importe que se marcaron `ignored` antes
   * de que hubiera tabla. Su base64 ya se borro, pero `summary` guarda el
   * payload entero y lo decodificado, que es lo que hace falta.
   */
  private async recuperarIaaiPendientes(): Promise<void> {
    let total = 0;
    let lastId = '';
    for (;;) {
      const rows = await this.prisma.auctionRawFrame.findMany({
        where: { error: 'IAAI con importe: pendiente de tabla', id: { gt: lastId } },
        orderBy: { id: 'asc' },
        take: 200,
        select: { id: true, event: true, summary: true, capturedAt: true, receivedAt: true },
      });
      if (!rows.length) break;
      for (const r of rows) {
        lastId = r.id;
        const sm = (r.summary ?? {}) as Record<string, any>;
        const ev = (r.event ?? 'OTHER') as DecodedFrame['event'];
        const d: DecodedFrame = {
          sale: sm.sale ?? null,
          event: ev,
          rawEvent: r.event,
          emittedAt: sm.emittedAt ? new Date(sm.emittedAt) : null,
          lot: sm.lot ?? null,
          itemNo: null,
          amount: sm.amount ?? null,
          askBid: sm.askBid ?? null,
          nextBid: sm.nextBid ?? null,
          increment: sm.increment ?? null,
          reserveMet: null,
          approved: null,
          buyerNo: null,
          buyerState: null,
          buyerCountry: sm.buyerCountry ?? null,
          payload: sm.fields ?? {},
        };
        if (!d.lot || !(isBidEvent(ev) || isSaleEvent(ev))) continue;
        await this.procesarIaaiConImporte(r.id, d, r.capturedAt ?? r.receivedAt);
        total++;
      }
    }
    if (total) this.logger.log(`[Frames] IAAI recuperados: ${total} frames con importe`);
  }

  /** Cuanto atras se busca una puja igual de difusion para no duplicarla. */
  private static readonly VENTANA_DEDUP_MS = 12 * 3_600_000;

  /**
   * Una puja del socket de difusion, sin duplicados.
   *
   * La clave unica de `auction_bid_events` incluye `emittedAt`, y aqui no hay
   * instante de Copart sino el de captura de cada VM: dos VM —o la misma puja
   * repetida en otra `round` ("a la de dos")— darian filas distintas. Una
   * puja de un lote se identifica por su tipo e importe (las pujas suben), asi
   * que se busca una igual en las ultimas horas antes de crear.
   *
   * El cerrojo por lote hace que dos mensajes del mismo lote procesados a la
   * vez (prefetch 20) no pasen los dos la comprobacion.
   */
  private async saveBroadcastBid(d: DecodedFrame): Promise<void> {
    const lot = BigInt(d.lot!);
    const when = d.emittedAt ?? new Date();
    await this.prisma.$transaction(async (tx) => {
      // `::text`: Prisma no sabe deserializar la columna `void` que devuelve.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lot})::text`;
      const existe = await tx.auctionBidEvent.findFirst({
        where: {
          lot,
          eventType: d.event,
          bid: d.amount,
          emittedAt: { gte: new Date(when.getTime() - AuctionFramesConsumer.VENTANA_DEDUP_MS) },
        },
        select: { id: true },
      });
      if (existe) return;
      await tx.auctionBidEvent.create({
        data: {
          lot,
          eventType: d.event,
          saleRoom: d.sale,
          bid: d.amount,
          askBid: d.askBid,
          nextBid: d.nextBid,
          increment: d.increment,
          buyerCountry: d.buyerCountry,
          emittedAt: when,
          raw: d.payload as any,
        },
      });
    });
  }

  /**
   * El resultado de una venta.
   *
   * `saleDate` sale del instante en que Copart emitio el evento: es la fecha en
   * que de verdad se vendio, y es la mitad de la clave unica.
   */
  private async saveSale(d: DecodedFrame): Promise<void> {
    if (!isSaleEvent(d.event)) return;
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
      // SOLDPEND es una adjudicacion a la espera de que el vendedor acepte. Se
      // guarda como venta —lo es— pero marcada, para no contar como cerrado algo
      // que todavia puede caerse. Un SOLD posterior del mismo lote la confirma.
      pendingApproval: d.event === 'SOLDPEND',
      reserveMet: d.reserveMet,
      approved: d.approved,
      buyerNo: d.buyerNo,
      buyerState: d.buyerState,
      buyerCountry: d.buyerCountry,
      emittedAt: d.emittedAt,
      receivedAt: new Date(),
      event: d.event,
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
