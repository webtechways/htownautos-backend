import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Inject,
  forwardRef,
  Res,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { CustomerGuard, CurrentBuyer, TenantOptional, AllowCustomer } from '@htownautos/auth';
import type { PortalBuyer } from '@htownautos/auth';
import { PortalService } from './portal.service';
import { StripeService } from '../stripe/stripe.service';
import { BuyerFavoritesService } from '../buyer-favorites/buyer-favorites.service';
import { ReceiptPdfService } from './receipt-pdf.service';
import { ToggleBuyerFavoriteDto } from '../buyer-favorites/dto/toggle-buyer-favorite.dto';
import { UpdatePortalProfileDto } from './dto/update-portal-profile.dto';
import { InspectionCartDto } from './dto/inspection-cart.dto';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { AddInspectionRequestDto } from './dto/add-inspection-request.dto';
import { CreateDepositReleaseRequestDto } from './dto/create-deposit-release-request.dto';
import { FindACarCheckoutDto } from './dto/find-a-car-checkout.dto';
import { CancelInspectionDto } from './dto/cancel-inspection.dto';

// CustomerGuard resolves the tenant from the Buyer, so the global TenantGuard
// must not require an org-based tenant on these routes. @AllowCustomer() is
// required too — TenantGuard now default-denies CUSTOMER-type users with
// STAFF_ONLY before it even reaches the tenantOptional check.
@TenantOptional()
@AllowCustomer()
@UseGuards(CustomerGuard)
@Controller('portal')
export class PortalController {
  constructor(
    private readonly portalService: PortalService,
    private readonly favoritesService: BuyerFavoritesService,
    private readonly receiptPdfService: ReceiptPdfService,
    @Inject(forwardRef(() => StripeService))
    private readonly stripeService: StripeService,
  ) {}

  // ── Profile ───────────────────────────────────────────────────────────────

  /**
   * GET /api/v1/portal/me
   * Returns safe Buyer profile fields. Does NOT expose SSN, credit, or income.
   */
  @Get('me')
  getMe(@CurrentBuyer() buyer: PortalBuyer) {
    return this.portalService.getProfile(buyer);
  }

  /**
   * PATCH /api/v1/portal/me
   * Updates name and phone numbers. All other fields require staff action.
   */
  @Patch('me')
  @HttpCode(HttpStatus.OK)
  updateMe(
    @CurrentBuyer() buyer: PortalBuyer,
    @Body() dto: UpdatePortalProfileDto,
  ) {
    return this.portalService.updateProfile(buyer, dto);
  }

  // Listings + pricing are PUBLIC — see PortalPublicController.

  // ── Inspections ───────────────────────────────────────────────────────────

  /**
   * GET /api/v1/portal/inspections
   * Returns only the calling buyer's inspections.
   */
  @Get('inspections')
  getInspections(@CurrentBuyer() buyer: PortalBuyer) {
    return this.portalService.getInspections(buyer);
  }

  /**
   * GET /api/v1/portal/inspections/:id
   * Returns a single inspection — 404 if it belongs to another buyer.
   * Response includes `carfax` array (same shape as dashboard CarfaxBlock).
   */
  @Get('inspections/:id')
  getInspection(
    @Param('id') id: string,
    @CurrentBuyer() buyer: PortalBuyer,
  ) {
    return this.portalService.getInspection(id, buyer);
  }

  /**
   * POST /api/v1/portal/inspections/:id/requests
   * Customer adds a special request note while inspection is REQUESTED.
   * Returns the created InspectionRequestItem.
   */
  @Post('inspections/:id/requests')
  @HttpCode(HttpStatus.CREATED)
  addInspectionRequest(
    @Param('id') id: string,
    @CurrentBuyer() buyer: PortalBuyer,
    @Body() dto: AddInspectionRequestDto,
  ) {
    return this.portalService.addInspectionRequest(id, buyer, dto.text);
  }

  /**
   * POST /api/v1/portal/inspections/:id/cancel
   * Customer cancels an inspection they requested.
   * Only cancellable while status is REQUESTED or IN_PROGRESS.
   */
  @Post('inspections/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelInspection(
    @Param('id') id: string,
    @CurrentBuyer() buyer: PortalBuyer,
    @Body() dto: CancelInspectionDto,
  ) {
    return this.portalService.cancelInspection(id, buyer, dto.reason);
  }

  // inspections/quote is PUBLIC — see PortalPublicController.

  /**
   * POST /api/v1/portal/inspections/checkout
   * Recomputes total server-side, creates ONE PortalOrder (INSPECTION, PENDING)
   * with the full cart in metadata, creates a Stripe Checkout Session, and
   * returns the checkout URL.
   *
   * Body: { items: [{ lotNumber, vin?, yardId, yardName? }, ...] }
   */
  @Post('inspections/checkout')
  @HttpCode(HttpStatus.CREATED)
  checkoutInspections(
    @CurrentBuyer() buyer: PortalBuyer,
    @Body() dto: InspectionCartDto,
  ) {
    return this.portalService.checkoutInspections(buyer, dto);
  }

  // ── Favorites ─────────────────────────────────────────────────────────────

  /**
   * GET /api/v1/portal/favorites
   * The calling buyer's favorite auction lots, with full listing detail.
   */
  @Get('favorites')
  getFavorites(@CurrentBuyer() buyer: PortalBuyer) {
    return this.favoritesService.list(buyer.id, buyer.tenantId);
  }

  /**
   * GET /api/v1/portal/favorites/ids
   * Lot numbers the buyer favorited — used by the web to paint heart state.
   */
  @Get('favorites/ids')
  async getFavoriteIds(@CurrentBuyer() buyer: PortalBuyer) {
    return { ids: await this.favoritesService.getIds(buyer.id) };
  }

  /**
   * POST /api/v1/portal/favorites  { lotNumber }
   * Adds a lot to the buyer's favorites (idempotent).
   */
  @Post('favorites')
  @HttpCode(HttpStatus.CREATED)
  addFavorite(
    @CurrentBuyer() buyer: PortalBuyer,
    @Body() dto: ToggleBuyerFavoriteDto,
  ) {
    return this.favoritesService.add(buyer.id, buyer.tenantId, {
      lotNumber: dto.lotNumber,
      vin: dto.vin,
    });
  }

  /**
   * DELETE /api/v1/portal/favorites/:lotNumber
   * Removes a lot from the buyer's favorites (idempotent).
   */
  @Delete('favorites/:lotNumber')
  @HttpCode(HttpStatus.OK)
  removeFavorite(
    @CurrentBuyer() buyer: PortalBuyer,
    @Param('lotNumber') lotNumber: string,
  ) {
    return this.favoritesService.remove(buyer.id, lotNumber);
  }

  // ── Orders / receipt ────────────────────────────────────────────────────────

  /**
   * GET /api/v1/portal/orders/by-session/:sessionId
   * Returns the receipt for a Stripe checkout session and, as a fallback to the
   * webhook, fulfils the order (creates inspections / credits deposit) if Stripe
   * confirms the session is paid. Used by the payment-success page.
   */
  @Get('orders/by-session/:sessionId')
  getOrderBySession(
    @CurrentBuyer() buyer: PortalBuyer,
    @Param('sessionId') sessionId: string,
  ) {
    return this.portalService.confirmOrderBySession(buyer, sessionId);
  }

  // ── Ledger ────────────────────────────────────────────────────────────────

  /**
   * GET /api/v1/portal/ledger
   * Returns all ledger entries + computed balance for the calling buyer.
   */
  @Get('ledger')
  getLedger(@CurrentBuyer() buyer: PortalBuyer) {
    return this.portalService.getLedger(buyer);
  }

  // ── Deposits ──────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/portal/deposits
   * Creates a Stripe Checkout Session for an arbitrary deposit amount (min $10).
   * Returns the checkout URL. LedgerEntry created on payment.
   */
  @Post('deposits')
  @HttpCode(HttpStatus.CREATED)
  createDeposit(
    @CurrentBuyer() buyer: PortalBuyer,
    @Body() dto: CreateDepositDto,
  ) {
    return this.portalService.createDeposit(buyer, dto);
  }

  // ── Find a Car for Me ─────────────────────────────────────────────────────

  /**
   * POST /api/v1/portal/find-a-car/checkout
   * Creates a Stripe Checkout Session for the "Find a Car for Me" service ($500).
   * Body: { preferences: WantedVehicleDto[], acceptedTerms: boolean }
   * Returns: { orderId, url, checkoutUrl }
   *
   * Vehicle preferences are stored in PortalOrder.metadata until payment is
   * confirmed; fulfillment creates BuyerVehiclePreference rows per preference.
   */
  @Post('find-a-car/checkout')
  @HttpCode(HttpStatus.CREATED)
  checkoutFindACar(
    @CurrentBuyer() buyer: PortalBuyer,
    @Body() dto: FindACarCheckoutDto,
  ) {
    return this.portalService.checkoutFindACar(buyer, dto);
  }

  // ── Billing ───────────────────────────────────────────────────────────────

  /**
   * GET /api/v1/portal/payment-summary
   * Returns deposit balance, total deposited, and payment counts for the buyer.
   */
  @Get('payment-summary')
  getPaymentSummary(@CurrentBuyer() buyer: PortalBuyer) {
    return this.stripeService.getPaymentSummary(buyer.id, buyer.tenantId);
  }

  /**
   * GET /api/v1/portal/payment-methods
   * Returns saved Stripe payment methods (cards) for the buyer.
   */
  @Get('payment-methods')
  listPaymentMethods(@CurrentBuyer() buyer: PortalBuyer) {
    return this.stripeService.listPaymentMethods(buyer.id, buyer.tenantId);
  }

  /**
   * GET /api/v1/portal/payments?startingAfter=<cursor>
   * Returns paginated Stripe payment events with order/receipt enrichment.
   * Default page size: 50. Use `startingAfter` (Stripe event ID) to page forward.
   */
  @Get('payments')
  listPayments(
    @CurrentBuyer() buyer: PortalBuyer,
    @Query('startingAfter') startingAfter?: string,
  ) {
    return this.stripeService.listPayments(buyer.id, buyer.tenantId, 50, startingAfter);
  }

  // ── Payment method management ─────────────────────────────────────────────

  /**
   * POST /api/v1/portal/payment-methods/setup-intent
   * Creates a Stripe SetupIntent so the web can collect a card via Stripe.js.
   */
  @Post('payment-methods/setup-intent')
  @HttpCode(HttpStatus.CREATED)
  createSetupIntent(@CurrentBuyer() buyer: PortalBuyer) {
    return this.stripeService.createSetupIntent(buyer.id, buyer.tenantId);
  }

  /**
   * DELETE /api/v1/portal/payment-methods/:id
   * Detaches a saved card from the buyer's Stripe customer.
   */
  @Delete('payment-methods/:id')
  @HttpCode(HttpStatus.OK)
  detachPaymentMethod(
    @CurrentBuyer() buyer: PortalBuyer,
    @Param('id') id: string,
  ) {
    return this.stripeService.detachPaymentMethod(buyer.id, id, buyer.tenantId);
  }

  /**
   * POST /api/v1/portal/payment-methods/:id/default
   * Sets a saved card as the buyer's default payment method.
   */
  @Post('payment-methods/:id/default')
  @HttpCode(HttpStatus.OK)
  setDefaultPaymentMethod(
    @CurrentBuyer() buyer: PortalBuyer,
    @Param('id') id: string,
  ) {
    return this.stripeService.setDefaultPaymentMethod(buyer.id, id, buyer.tenantId);
  }

  // ── Receipt PDF ───────────────────────────────────────────────────────────

  /**
   * GET /api/v1/portal/orders/:orderId/receipt.pdf
   * Generates and streams a PDF receipt for the given order.
   * 404 if the order does not belong to the calling buyer.
   */
  @Get('orders/:orderId/receipt.pdf')
  async getOrderReceiptPdf(
    @CurrentBuyer() buyer: PortalBuyer,
    @Param('orderId') orderId: string,
    @Res() res: Response,
  ) {
    const order = await this.portalService.getOrderForBuyer(orderId, buyer);
    const receiptNumber = order.id.slice(0, 8).toUpperCase();
    const bytes = await this.receiptPdfService.buildOrderReceiptPdf(order as any, {
      buyerName: `${buyer.firstName} ${buyer.lastName}`.trim(),
      buyerEmail: buyer.email ?? '',
      buyerPhone: buyer.phoneMain ?? undefined,
    });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="recibo-${receiptNumber}.pdf"`,
    });
    res.end(Buffer.from(bytes));
  }

  // ── Deposit release requests ───────────────────────────────────────────────

  /**
   * POST /api/v1/portal/deposits/release-request
   * Buyer requests a release of their deposit balance.
   * Idempotent: returns existing PENDING request if one exists.
   */
  @Post('deposits/release-request')
  @HttpCode(HttpStatus.CREATED)
  createDepositReleaseRequest(
    @CurrentBuyer() buyer: PortalBuyer,
    @Body() dto: CreateDepositReleaseRequestDto,
  ) {
    return this.portalService.createDepositReleaseRequest(buyer, dto.note);
  }

  /**
   * GET /api/v1/portal/deposits/release-request
   * Returns the most recent DepositReleaseRequest for the buyer (or null).
   */
  @Get('deposits/release-request')
  getLatestDepositReleaseRequest(@CurrentBuyer() buyer: PortalBuyer) {
    return this.portalService.getLatestDepositReleaseRequest(buyer);
  }
}
