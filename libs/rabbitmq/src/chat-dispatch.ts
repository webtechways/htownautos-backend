/**
 * Contrato entre la `api` (publica) y `data-sync` (consume) para sacar una
 * notificacion a los canales de chat del tenant.
 *
 * Va por cola y no en linea porque `notifyTenantStaff` se llama desde caminos
 * que atienden a clientes —`fulfillDepositOrder`, `fulfillInspectionOrder`— y
 * meter ahi varias peticiones HTTP salientes con reintentos alargaria la
 * respuesta del cliente por algo que no le importa.
 */
export const CHAT_DISPATCH_QUEUE = 'notifications.chat.dispatch';

export interface ChatDispatchMessage {
  tenantId: string;
  /** Tipo de notificacion; decide que canales la quieren. */
  type: string;
  title: string;
  message: string;
  priority?: string | null;
  /** Ruta del dashboard a la que lleva; se convierte en boton. */
  actionUrl?: string | null;
}
