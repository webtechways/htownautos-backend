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
import { VocabularyService } from '../auction-sale-results/vocabulary.service';

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
    private readonly vocab: VocabularyService,
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
    /**
     * Se llama segun avanza. Existe para el modo en streaming: sin esto, el
     * usuario mira un texto fijo 3,3 segundos de mediana (y hasta 8 en el peor
     * caso), que es justo lo que hace que no se sienta fluido.
     */
    onEvent?: (e: { type: 'tool'; name: string } | { type: 'delta'; text: string }) => void;
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
      { role: 'system', content: this.systemPrompt() },
      ...previos.reverse().map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: pregunta },
    ];

    // Pistas resueltas por nuestro lado ANTES de hablar con OpenAI. Ahorran la
    // vuelta que se gastaba siempre en `resolver_valores`, que son ~2s de los 5
    // que tarda una respuesta. Solo van si la coincidencia es exacta.
    const pistas = await this.vocab.hints(pregunta).catch(() => ({}));
    if (Object.keys(pistas).length) {
      mensajes.push({
        role: 'system',
        content:
          'Ya identificado en la pregunta (no hace falta resolver_valores para esto): ' +
          JSON.stringify(pistas) +
          '. Usa estos valores tal cual al filtrar.',
      });
    }

    const inicio = Date.now();
    const usadas: { nombre: string; args: unknown }[] = [];
    // Si la ultima herramienta ofrecio opciones, se devuelven aparte para que
    // la UI las pinte como botones: tener que teclear "2023" rompe el ritmo.
    let sugerencias: string[] = [];
    let tokensIn = 0;
    let tokensOut = 0;
    let respuesta = '';

    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      const peticion = {
        model: this.model,
        messages: mensajes,
        tools: TOOL_DEFS,
        temperature: 0.2, // datos, no prosa creativa
        max_tokens: 1200,
        // Agrupa las peticiones de este chat para que OpenAI acierte mas veces
        // con la cache del prefijo comun (prompt de sistema + herramientas).
        prompt_cache_key: 'htownautos-ai-chat-v1',
      } as const;

      let msg: OpenAI.Chat.ChatCompletionMessage | undefined;

      if (params.onEvent) {
        // En streaming se reconstruye el mensaje a trozos. Los deltas de texto
        // salen ya hacia el usuario; los de herramienta se acumulan porque solo
        // sirven completos.
        const stream = await this.openai.chat.completions.create({
          ...peticion,
          stream: true,
          stream_options: { include_usage: true },
        });
        let contenido = '';
        const llamadas: any[] = [];
        for await (const trozo of stream) {
          if (trozo.usage) {
            tokensIn += trozo.usage.prompt_tokens ?? 0;
            tokensOut += trozo.usage.completion_tokens ?? 0;
          }
          const d = trozo.choices[0]?.delta;
          if (!d) continue;
          if (d.content) {
            contenido += d.content;
            params.onEvent({ type: 'delta', text: d.content });
          }
          for (const tc of d.tool_calls ?? []) {
            const i = tc.index ?? 0;
            llamadas[i] ??= { id: '', type: 'function', function: { name: '', arguments: '' } };
            if (tc.id) llamadas[i].id = tc.id;
            if (tc.function?.name) llamadas[i].function.name += tc.function.name;
            if (tc.function?.arguments) llamadas[i].function.arguments += tc.function.arguments;
          }
        }
        msg = {
          role: 'assistant',
          content: contenido || null,
          ...(llamadas.length ? { tool_calls: llamadas } : {}),
        } as OpenAI.Chat.ChatCompletionMessage;
      } else {
        const completion = await this.openai.chat.completions.create(peticion);
        tokensIn += completion.usage?.prompt_tokens ?? 0;
        tokensOut += completion.usage?.completion_tokens ?? 0;
        msg = completion.choices[0]?.message;
      }

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
          params.onEvent?.({ type: 'tool', name: fn.name });
          const salida = await this.tools.run(fn.name, args);
          // Tanto la herramienta de opciones como el corte por consulta
          // demasiado amplia ofrecen valores a elegir.
          const ops = (salida as any)?.opciones;
          if (fn.name === 'opciones_para_elegir' || (salida as any)?.faltaPrecisar) {
            if (Array.isArray(ops)) {
              sugerencias = ops
                .map((o: any) => (o?.valor == null ? null : String(o.valor)))
                .filter((x: string | null): x is string => !!x)
                .slice(0, 12);
            }
          }
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
      suggestions: sugerencias,
      tokensIn,
      tokensOut,
      latencyMs,
    };
  }

  /**
   * Las instrucciones. La mitad de esto existe para evitar el unico fallo que
   * de verdad importa: que responda una cifra plausible que no sale de los datos.
   */
  private systemPrompt(): string {
    // Sin datos variables aqui. OpenAI cachea prefijos de >=1024 tokens con
    // coincidencia EXACTA: meter el total de ventas —que sube cada pocos
    // segundos— hacia que el prefijo no coincidiera nunca y se pagara tarifa
    // completa en cada llamada. El periodo cubierto lo da `cobertura_de_datos`.
    return [
      'Eres el asistente de datos de subastas de HtownAutos. Respondes en español, directo y breve.',
      '',
      'REGLAS, por orden de importancia:',
      '1. NUNCA des una cifra que no venga de una herramienta. No estimes, no redondees "de memoria",',
      '   no uses conocimiento general sobre precios de coches. Si no llamaste a una herramienta, no hay cifra.',
      '2. Antes de filtrar por marca, modelo, version, daño, color o estado, llama a `resolver_valores`',
      '   UNA SOLA VEZ, resolviendo todos los campos que necesites en la misma llamada.',
      '   Tolera erratas y agrupa las distintas grafias, asi que al filtrar usa el campo `valor` tal cual:',
      '   NO menciones las variantes internas ni separes la respuesta por ellas. Al usuario le da igual',
      '   que en los datos convivan "F-150" y "F150"; quiere UNA cifra para la F-150.',
      '3. Si `exacto` es false pero hay un resultado claramente mejor, USALO y corrige de paso',
      '   ("Entiendo que te refieres al Corolla: ..."). NO te pares a preguntar si acertaste;',
      '   preguntar por cada errata convierte el chat en un formulario. Pregunta solo si hay',
      '   varias opciones de peso parecido y elegir mal cambiaria mucho la respuesta.',
      '4. Di siempre sobre cuantas ventas se calcula ("segun 1.825 ventas"). Si la herramienta marca la',
      '   muestra como insuficiente, dilo en vez de dar la cifra como fiable.',
      '   Comprueba `filtrosAplicados` en la respuesta de la herramienta: si falta algo que el usuario',
      '   pidio (por ejemplo el año), NO afirmes ese dato en tu respuesta. Vuelve a llamar con el filtro.',
      '',
      'PREGUNTAR LO QUE FALTA (importante para que sea util):',
      'Un precio sin año ni version sirve de poco: un F-150 de 2023 y uno de 2010 no tienen nada que ver.',
      'Si el usuario no da todos los datos, NO respondas con la media de todo: pide lo que falta,',
      'DE UNO EN UNO y en este orden: marca -> modelo -> año -> version.',
      'Cada vez que pidas un dato, llama antes a `opciones_para_elegir` con lo que ya sabes y OFRECE esa',
      'lista. Preguntar "¿que año?" sin opciones obliga al usuario a adivinar que hay en los datos.',
      'Formato de esa pregunta: una frase corta diciendo que ya sabes y que te falta, y despues las',
      'opciones separadas por " · " en una sola linea. Nada mas: no adelantes precios todavia.',
      'Excepcion: si el usuario pide explicitamente el conjunto ("todos los F-150", "en general"),',
      'responde sin pedir mas datos.',
      '5. Usa la MEDIANA como precio de referencia y los percentiles 25-75 como rango habitual.',
      '   La media se desvia con un solo lote caro y no representa lo que se paga.',
      '6. Los datos abarcan un periodo CORTO (pocos dias). NO respondas preguntas de tendencia,',
      '   evolucion o comparacion entre periodos. Si te preguntan eso, llama a `cobertura_de_datos`',
      '   para saber el periodo exacto y explica que no hay historia suficiente.',
      '7. Si la pregunta no va de datos de subasta (inventario propio, clientes, contabilidad), dilo:',
      '   solo tienes acceso a resultados de subasta y lotes.',
      '',
      'FORMATO: cifras en dolares sin decimales. Cuando des varios grupos, usa una tabla markdown.',
      'Cuando cites lotes concretos, escribe el numero de lote para que se pueda comprobar.',
    ].join('\n');
  }
}
