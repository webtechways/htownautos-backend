import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { AiChatToolsService, TOOL_DEFS } from './ai-chat.tools';
import { StatsService } from '../auction-sale-results/stats.service';

/**
 * Tope de vueltas del bucle de herramientas.
 *
 * Sin el, un modelo confundido encadena llamadas hasta agotar el presupuesto:
 * resuelve un valor, no le gusta, resuelve otro, y asi. Cinco vueltas sobran
 * para una pregunta legitima ("resuelve el modelo → pide precios → pide un
 * desglose → responde").
 */
const MAX_VUELTAS = 5;

/** Cuantos turnos previos se mandan como contexto. */
const HISTORIAL_TURNOS = 12;

@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);
  private readonly openai: OpenAI | null;
  private readonly model = process.env.AI_CHAT_MODEL || 'gpt-4o-mini';

  constructor(
    private readonly prisma: PrismaService,
    private readonly tools: AiChatToolsService,
    private readonly stats: StatsService,
  ) {
    // El mismo respaldo que usa max-bid: en produccion la clave de OpenAI esta
    // guardada como TTS_API_KEY, no como OPENAI_API_KEY. Sin esta linea el chat
    // saldria muerto aunque la clave lleve meses configurada.
    const apiKey = process.env.OPENAI_API_KEY || process.env.TTS_API_KEY;
    // No se lanza en el constructor: dejaria la api entera sin arrancar por una
    // funcion opcional. Se avisa al usar.
    this.openai = apiKey ? new OpenAI({ apiKey }) : null;
    if (!apiKey) {
      this.logger.warn('[AiChat] Sin OPENAI_API_KEY ni TTS_API_KEY: el chat respondera con error');
    }
  }

  // ── Conversaciones ────────────────────────────────────────────────────────

  async listConversations(userId: string) {
    return this.prisma.aiChatConversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });
  }

  async getConversation(id: string, userId: string) {
    const conv = await this.prisma.aiChatConversation.findFirst({
      where: { id, userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, role: true, content: true, toolCalls: true, createdAt: true,
          },
        },
      },
    });
    if (!conv) throw new NotFoundException('Conversacion no encontrada');
    return conv;
  }

  async remove(id: string, userId: string) {
    const conv = await this.prisma.aiChatConversation.findFirst({ where: { id, userId } });
    if (!conv) throw new NotFoundException('Conversacion no encontrada');
    await this.prisma.aiChatConversation.delete({ where: { id } });
    return { deleted: true };
  }

  // ── Preguntar ─────────────────────────────────────────────────────────────

  async ask(params: {
    tenantId: string;
    userId: string;
    conversationId?: string;
    question: string;
  }) {
    if (!this.openai) {
      throw new BadRequestException(
        'El chat no esta configurado en el servidor (falta OPENAI_API_KEY o TTS_API_KEY)',
      );
    }
    const pregunta = params.question.trim();
    if (!pregunta) throw new BadRequestException('La pregunta esta vacia');

    // Conversacion: existente (validando dueño) o nueva, titulada con la
    // primera pregunta para poder reconocerla en la lista.
    let conversacion = params.conversationId
      ? await this.prisma.aiChatConversation.findFirst({
          where: { id: params.conversationId, userId: params.userId },
        })
      : null;
    if (params.conversationId && !conversacion) {
      throw new NotFoundException('Conversacion no encontrada');
    }
    if (!conversacion) {
      conversacion = await this.prisma.aiChatConversation.create({
        data: {
          tenantId: params.tenantId,
          userId: params.userId,
          title: pregunta.slice(0, 80),
        },
      });
    }

    const previos = await this.prisma.aiChatMessage.findMany({
      where: { conversationId: conversacion.id },
      orderBy: { createdAt: 'desc' },
      take: HISTORIAL_TURNOS,
      select: { role: true, content: true },
    });

    await this.prisma.aiChatMessage.create({
      data: { conversationId: conversacion.id, role: 'user', content: pregunta },
    });

    const mensajes: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: await this.systemPrompt() },
      ...previos.reverse().map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: pregunta },
    ];

    const inicio = Date.now();
    const usadas: { nombre: string; args: unknown }[] = [];
    let tokensIn = 0;
    let tokensOut = 0;
    let respuesta = '';

    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: mensajes,
        tools: TOOL_DEFS,
        temperature: 0.2, // datos, no prosa creativa
        max_tokens: 1200,
      });

      tokensIn += completion.usage?.prompt_tokens ?? 0;
      tokensOut += completion.usage?.completion_tokens ?? 0;

      const msg = completion.choices[0]?.message;
      if (!msg) break;

      if (!msg.tool_calls?.length) {
        respuesta = msg.content?.trim() ?? '';
        break;
      }

      mensajes.push(msg);
      // Las herramientas de una misma vuelta son independientes entre si.
      const resultados = await Promise.all(
        msg.tool_calls.map(async (tc) => {
          const fn = (tc as any).function;
          let args: any = {};
          try {
            args = JSON.parse(fn.arguments || '{}');
          } catch {
            args = {};
          }
          usadas.push({ nombre: fn.name, args });
          const salida = await this.tools.run(fn.name, args);
          return { id: tc.id, salida };
        }),
      );
      for (const r of resultados) {
        mensajes.push({
          role: 'tool',
          tool_call_id: r.id,
          content: JSON.stringify(r.salida),
        });
      }

      // Si se agotan las vueltas sin respuesta, se dice; no se inventa una.
      if (vuelta === MAX_VUELTAS - 1) {
        respuesta =
          'No he podido cerrar la consulta en los pasos disponibles. Prueba a concretar mas la pregunta.';
      }
    }

    const latencyMs = Date.now() - inicio;
    const fila = await this.prisma.aiChatMessage.create({
      data: {
        conversationId: conversacion.id,
        role: 'assistant',
        content: respuesta || 'No he podido responder.',
        toolCalls: usadas.length ? (usadas as unknown as Prisma.InputJsonValue) : undefined,
        tokensIn,
        tokensOut,
        model: this.model,
        latencyMs,
      },
    });
    await this.prisma.aiChatConversation.update({
      where: { id: conversacion.id },
      data: { updatedAt: new Date() },
    });

    this.logger.log(
      `[AiChat] ${usadas.length} herramienta(s), ${tokensIn}+${tokensOut} tokens, ${latencyMs}ms`,
    );

    return {
      conversationId: conversacion.id,
      messageId: fila.id,
      answer: fila.content,
      toolsUsed: usadas.map((u) => u.nombre),
      tokensIn,
      tokensOut,
      latencyMs,
    };
  }

  /**
   * Las instrucciones. La mitad de esto existe para evitar el unico fallo que
   * de verdad importa: que responda una cifra plausible que no sale de los datos.
   */
  private async systemPrompt(): Promise<string> {
    const c = await this.stats.coverage();
    const dias =
      c.desde && c.hasta
        ? Math.max(1, Math.round((c.hasta.getTime() - c.desde.getTime()) / 86_400_000))
        : 0;

    return [
      'Eres el asistente de datos de subastas de HtownAutos. Respondes en español, directo y breve.',
      '',
      'REGLAS, por orden de importancia:',
      '1. NUNCA des una cifra que no venga de una herramienta. No estimes, no redondees "de memoria",',
      '   no uses conocimiento general sobre precios de coches. Si no llamaste a una herramienta, no hay cifra.',
      '2. Antes de filtrar por marca, modelo, version, daño, color o estado, llama a `resolver_valores`.',
      '   Los datos usan el vocabulario de la subasta: "F-150" y "F150" existen como valores distintos.',
      '   Si filtras por un valor inventado te saldran cero ventas y concluiras mal.',
      '3. Di siempre sobre cuantas ventas se calcula ("segun 1.825 ventas"). Si la herramienta marca la',
      '   muestra como insuficiente, dilo en vez de dar la cifra como fiable.',
      '4. Usa la MEDIANA como precio de referencia y los percentiles 25-75 como rango habitual.',
      '   La media se desvia con un solo lote caro y no representa lo que se paga.',
      `5. Los datos cubren ${dias} dia(s) (${c.totalVentas} ventas registradas). NO respondas preguntas de`,
      '   tendencia, evolucion o comparacion entre periodos: no hay historia suficiente. Dilo claramente.',
      '6. Si la pregunta no va de datos de subasta (inventario propio, clientes, contabilidad), dilo:',
      '   solo tienes acceso a resultados de subasta y lotes.',
      '',
      'FORMATO: cifras en dolares sin decimales. Cuando des varios grupos, usa una tabla markdown.',
      'Cuando cites lotes concretos, escribe el numero de lote para que se pueda comprobar.',
    ].join('\n');
  }
}
