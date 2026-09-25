/**
 * Contrato entre la `api` (produce) y `data-sync` (consume) para empujar el
 * estado de un `User` hacia Clerk — ver docs/identity/CLERK-SYNC-DESIGN.md
 * (paquete B2, CRM -> Clerk).
 *
 * El mensaje solo lleva el id: el consumidor siempre relee el `User` y sus
 * `Buyer` mas recientes desde la base antes de tocar Clerk, asi que un
 * reintento (o dos mensajes en vuelo para el mismo usuario) es idempotente
 * por diseno, no por suerte.
 */
export const CLERK_PUSH_QUEUE = 'identity.clerk.push';

export interface IdentityClerkPushMessage {
  userId: string;
}
