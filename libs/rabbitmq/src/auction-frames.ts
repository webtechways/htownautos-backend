/**
 * Contrato entre la api (que encola) y data-sync (que procesa) para los frames
 * de la subasta en vivo.
 *
 * La api no decodifica: guarda el frame crudo, encola su id y responde. Con 49
 * salas abiertas llegan rafagas, y bloquear la peticion HTTP para parsear y
 * escribir en base de datos convierte cualquier pico en timeouts en las VM.
 */
export const AUCTION_FRAMES_QUEUE = 'auctions.frames.decode';

export interface AuctionFrameMessage {
  /** Fila de `auction_raw_frames`. El frame vive ahi, no en el mensaje. */
  frameId: string;
}
