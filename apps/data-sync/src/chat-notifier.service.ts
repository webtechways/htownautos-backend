import { Injectable, Logger } from '@nestjs/common';
import {
  RabbitMQService,
  CHAT_DISPATCH_QUEUE,
  type ChatDispatchMessage,
} from '@htownautos/rabbitmq';

/**
 * Saca al chat los avisos que genera data-sync.
 *
 * Los notificadores de este worker —coincidencias buscadas, vendedores por
 * clasificar, valores de filtro nuevos— escriben directamente en la tabla
 * `notifications` con `createMany`, en vez de pasar por `notifyTenantStaff` de
 * la api. Esa es una decision razonable (crean cientos de filas de golpe), pero
 * tenia un efecto que no se veia: **nunca llegaban al chat**, asi que marcar
 * esos tipos en un canal no hacia nada.
 *
 * Y son precisamente los que mas disparan en produccion.
 *
 * La regla es un mensaje por evento logico, no por fila: un aviso que llega a
 * ocho miembros del equipo no son ocho mensajes en el grupo de Telegram.
 */
@Injectable()
export class ChatNotifierService {
  private readonly logger = new Logger(ChatNotifierService.name);

  constructor(private readonly rabbitMQ: RabbitMQService) {}

  /**
   * Publica un aviso. Best-effort: `publish` devuelve false si RabbitMQ esta
   * caido y nunca lanza, asi que el notificador que llama no se entera.
   */
  async send(msg: ChatDispatchMessage): Promise<void> {
    try {
      const ok = await this.rabbitMQ.publish(CHAT_DISPATCH_QUEUE, msg);
      if (!ok) {
        this.logger.warn(`[Chat] No se pudo encolar ${msg.type} (RabbitMQ caido)`);
      }
    } catch (err) {
      this.logger.warn(`[Chat] ${msg.type}: ${(err as Error).message}`);
    }
  }
}
