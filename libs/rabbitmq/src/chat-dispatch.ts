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
  /** Vacio cuando el destino va en `channelIds` (p. ej. el calendario, que es global). */
  tenantId: string;
  /** Tipo de notificacion; decide que canales la quieren. */
  type: string;
  title: string;
  message: string;
  priority?: string | null;
  /** Ruta del dashboard a la que lleva; se convierte en boton. */
  actionUrl?: string | null;

  /**
   * Entregar a estos canales concretos, saltandose el filtro por tipos.
   *
   * Lo usa el calendario, donde el usuario ya eligio los canales a mano en esa
   * pantalla: obligarle ademas a marcar un tipo en cada canal serian dos
   * controles para lo mismo, y el "lo configure y no llega" estaria garantizado.
   */
  channelIds?: string[];
}
