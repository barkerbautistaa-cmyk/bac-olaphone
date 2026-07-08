/**
 * =============================================================================
 * OLAPHONE — CHATBOT: CLASIFICADOR DE INTENCIÓN
 * =============================================================================
 * Determina qué tipo de mensaje envió el cliente y devuelve la intención
 * correspondiente para que el router del chatbot sepa cómo responder.
 * =============================================================================
 */

"use strict";

// ── PATRONES POR INTENCIÓN ────────────────────────────────────────────────────
const INTENTS = {
  greeting: {
    patterns: [/^(hola|buenas|buen(os|as)|hey|hi|saludos|ola)/i],
    priority: 1,
  },
  order_status: {
    patterns: [/OLA-[A-Z0-9\-]+/i, /pedido|orden|estado|seguimiento/i],
    priority: 2,
  },
  catalog: {
    patterns: [/cat[aá]logo|productos|qu[eé] tienen|qu[eé] venden|qu[eé] hay/i],
    priority: 2,
  },
  price_query: {
    patterns: [/precio|cu[aá]nto (cuesta|sale|vale)|valor|costo/i],
    priority: 2,
  },
  location: {
    patterns: [/direcci[oó]n|d[oó]nde est[aá]n|ubicaci[oó]n|local|donde quedan/i],
    priority: 2,
  },
  hours: {
    patterns: [/horario|qu[eé] hora|cu[aá]ndo abren|abren|atienden/i],
    priority: 2,
  },
  payment: {
    patterns: [/pago|pag[ué]|transfer|comprobante|recibo|ya pagu[eé]|hice el pago/i],
    priority: 3,
  },
  shipping: {
    patterns: [/env[ií]o|mand[aá]n|despacho|correo|oca|andreani|despachar/i],
    priority: 2,
  },
  whatsapp_cart: {
    // Este intent se activa cuando llega un pedido formateado desde la web
    patterns: [/NUEVO PEDIDO — OlaPhone/i, /OLA-\d{13}/i],
    priority: 5,
  },
  image_received: {
    // Se detecta por tipo de mensaje, no por texto
    patterns: [],
    priority: 4,
  },
  thanks: {
    patterns: [/gracias|muchas gracias|perfecto|genial|ok gracias|dale gracias/i],
    priority: 1,
  },
  unknown: {
    patterns: [],
    priority: 0,
  },
};

/**
 * Clasifica el mensaje entrante.
 * @param {object} msg - Mensaje normalizado de Evolution API
 * @returns {{ intent: string, orderId?: string, confidence: number }}
 */
function classifyIntent(msg) {
  const text     = (msg.text || "").trim();
  const msgType  = msg.type || "text"; // text | image | audio | document

  // Imagen → siempre intent de comprobante
  if (msgType === "image" || msgType === "document") {
    return { intent: "image_received", confidence: 1.0 };
  }

  // Buscar número de pedido
  const orderMatch = text.match(/OLA-\d{13}-[A-Z0-9]+/i);
  const orderId    = orderMatch ? orderMatch[0].toUpperCase() : null;

  // Mensaje de pedido desde la web (muy larga, comienza con bloque de pedido)
  if (INTENTS.whatsapp_cart.patterns.some((p) => p.test(text))) {
    return { intent: "whatsapp_cart", orderId, confidence: 1.0 };
  }

  // Evaluar cada intención por prioridad descendente
  const matches = Object.entries(INTENTS)
    .filter(([key]) => key !== "unknown" && key !== "image_received" && key !== "whatsapp_cart")
    .filter(([, def]) => def.patterns.some((p) => p.test(text)))
    .sort(([, a], [, b]) => b.priority - a.priority);

  if (matches.length > 0) {
    const [intent] = matches[0];
    return { intent, orderId, confidence: 0.85 };
  }

  return { intent: "unknown", orderId: null, confidence: 0.0 };
}

module.exports = { classifyIntent };
