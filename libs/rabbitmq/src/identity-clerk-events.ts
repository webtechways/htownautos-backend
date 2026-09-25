/**
 * Contrato entre el controlador de webhooks de Clerk (`api`) y su consumidor
 * en `data-sync` — ver docs/identity/CLERK-SYNC-DESIGN.md (paquete B3,
 * Clerk -> CRM).
 *
 * El controlador ya verifico la firma svix e insertó el evento en
 * `clerk_webhook_events` (idempotente via `ON CONFLICT DO NOTHING` sobre el
 * svix-id) antes de publicar. El mensaje solo lleva el id de esa fila: el
 * consumidor siempre relee el evento fresco, así que una redelivery de
 * RabbitMQ es un no-op, no un doble procesamiento.
 */
export const CLERK_EVENTS_QUEUE = 'identity.clerk.events';

export interface IdentityClerkEventMessage {
  eventId: string;
}
