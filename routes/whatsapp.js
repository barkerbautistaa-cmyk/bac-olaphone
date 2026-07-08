/**
 * =============================================================================
 * SUB-COMPONENTE C: INTEGRACIÓN WHATSAPP API
 * =============================================================================
 * Abstracción agnóstica para envío de mensajes WhatsApp via HTTP.
 * Compatible con Evolution API (self-hosted), Twilio, 360dialog u otros
 * proveedores que acepten HTTP REST.
 *
 * Configurable completamente via variables de entorno.
 *
 * MENSAJES QUE GENERA:
 *   1. Al cliente: Confirmación de pedido con detalle + datos de pago (CBU/Alias)
 *   2. Al dueño/empleados: Alerta de nuevo pedido pendiente de aprobación
 * =============================================================================
 */

const axios = require("axios");

// ---------------------------------------------------------------------------
// CONFIGURACIÓN (desde variables de entorno)
// ---------------------------------------------------------------------------
const WA_API_URL      = process.env.WA_API_URL || "http://localhost:8080";
const WA_API_KEY      = process.env.WA_API_KEY  || "";
const WA_INSTANCE     = process.env.WA_INSTANCE || "ecommerce";
const OWNER_PHONE     = process.env.OWNER_PHONE || "5491100000000";
const CBU             = process.env.CBU_BANCO    || "0000003100000000000000";
const ALIAS           = process.env.ALIAS_BANCO  || "TU.ALIAS.AQUI";
const STORE_NAME      = process.env.STORE_NAME   || "Mi Tienda Online";

// ---------------------------------------------------------------------------
// FORMATEO DE MONEDA
// ---------------------------------------------------------------------------
function formatPrecio(amount) {
  return new Intl.NumberFormat("es-AR", {
    style:    "currency",
    currency: "ARS",
  }).format(amount);
}

// ---------------------------------------------------------------------------
// GENERADORES DE MENSAJES
// ---------------------------------------------------------------------------

/**
 * Genera el mensaje de confirmación para el cliente.
 * Incluye: detalle de productos, total y datos de pago.
 */
function buildClienteMessage(pedido) {
  const lineasProductos = pedido.productos
    .map(
      (p) =>
        `▸ ${p.nombre}\n` +
        `  Cantidad: ${p.cantidad} × ${formatPrecio(p.precio_unitario)} = ${formatPrecio(p.cantidad * p.precio_unitario)}`
    )
    .join("\n\n");

  return (
    `✅ *¡Tu pedido fue recibido, ${pedido.cliente.nombre}!*\n` +
    `─────────────────────\n` +
    `🛍️ *${STORE_NAME}*\n` +
    `📋 Pedido N°: \`${pedido.id_pedido}\`\n` +
    `📅 Fecha: ${new Date(pedido.fecha).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}\n\n` +
    `*📦 Detalle del Pedido:*\n\n` +
    `${lineasProductos}\n\n` +
    `─────────────────────\n` +
    `💰 *TOTAL: ${formatPrecio(pedido.total)}*\n\n` +
    `*💳 Datos para la transferencia:*\n` +
    `🏦 CBU: \`${CBU}\`\n` +
    `🔤 Alias: \`${ALIAS}\`\n\n` +
    `⚠️ *Importante:* Una vez realizada la transferencia, envianos el comprobante por este chat. Tu pedido se confirma al verificar el pago.\n\n` +
    `${pedido.notas ? `📝 Nota: ${pedido.notas}\n\n` : ""}` +
    `Ante cualquier consulta, estamos a tu disposición. ¡Gracias por tu compra! 🙏`
  );
}

/**
 * Genera el mensaje de alerta para el dueño/empleados.
 * Incluye todos los datos del pedido para una rápida gestión.
 */
function buildDuenoMessage(pedido) {
  const lineasProductos = pedido.productos
    .map(
      (p) =>
        `  • [${p.id}] ${p.nombre}\n    ${p.cantidad} unid. × ${formatPrecio(p.precio_unitario)}`
    )
    .join("\n");

  return (
    `🔔 *NUEVO PEDIDO PENDIENTE DE PAGO*\n` +
    `═══════════════════════════════\n` +
    `📋 ID Pedido:  \`${pedido.id_pedido}\`\n` +
    `🆔 ID Interno: \`${pedido.id_interno}\`\n` +
    `📅 Recibido:   ${new Date(pedido.fecha).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}\n\n` +
    `👤 *Cliente:*\n` +
    `  Nombre:    ${pedido.cliente.nombre}\n` +
    `  Teléfono:  +${pedido.cliente.telefono}\n\n` +
    `📦 *Productos:*\n${lineasProductos}\n\n` +
    `─────────────────────────────\n` +
    `💰 *TOTAL A COBRAR: ${formatPrecio(pedido.total)}*\n` +
    `📊 Estado: 🟡 PENDIENTE DE PAGO\n\n` +
    `${pedido.notas ? `📝 Notas del cliente: _${pedido.notas}_\n\n` : ""}` +
    `⚡ *Acción requerida:* Verificar transferencia bancaria y confirmar el pedido.`
  );
}

// ---------------------------------------------------------------------------
// ENVÍO VIA EVOLUTION API (adaptable)
// ---------------------------------------------------------------------------

/**
 * Envía un mensaje de texto via Evolution API.
 *
 * COMPATIBILIDAD:
 * - Evolution API: POST /message/sendText/{instance}
 *   Header: apikey: <WA_API_KEY>
 *   Body: { "number": "<phone>", "text": "<message>" }
 *
 * Para otros proveedores, modificar la construcción de `url` y `payload`
 * sin cambiar la firma de la función.
 *
 * @param {string} toPhone - Número destino en formato E.164 sin + (ej: "5491112345678")
 * @param {string} message - Texto del mensaje (acepta formato WhatsApp: *negrita*, _cursiva_, etc.)
 */
async function sendEvolutionApiMessage(toPhone, message) {
  const url = `${WA_API_URL}/message/sendText/${WA_INSTANCE}`;

  const response = await axios.post(
    url,
    {
      number: toPhone,
      text:   message,
    },
    {
      headers: {
        "apikey":       WA_API_KEY,
        "Content-Type": "application/json",
      },
      timeout: 10000, // 10 segundos
    }
  );

  return response.data;
}

// ---------------------------------------------------------------------------
// FUNCIÓN PRINCIPAL (PÚBLICA)
// ---------------------------------------------------------------------------

/**
 * Envía el mensaje de WhatsApp correspondiente según el tipo de destinatario.
 *
 * @param {"cliente" | "dueno"} tipo - Destinatario del mensaje
 * @param {Object} pedido             - Objeto pedido enriquecido
 * @returns {Promise<Object>}         - Respuesta de la API
 * @throws Error si la API falla
 */
async function sendWhatsAppMessage(tipo, pedido) {
  let toPhone, message;

  if (tipo === "cliente") {
    toPhone = pedido.cliente.telefono;
    message = buildClienteMessage(pedido);
  } else if (tipo === "dueno") {
    toPhone = OWNER_PHONE;
    message = buildDuenoMessage(pedido);
  } else {
    throw new Error(`Tipo de destinatario inválido: "${tipo}". Usar "cliente" o "dueno".`);
  }

  if (!toPhone) {
    throw new Error(`Teléfono no configurado para tipo "${tipo}"`);
  }

  console.log(`[WhatsApp] Enviando mensaje "${tipo}" a +${toPhone} (${message.length} chars)...`);

  // Si no hay API configurada, simular el envío en desarrollo
  if (!WA_API_URL || WA_API_URL === "http://localhost:8080" && process.env.NODE_ENV !== "production") {
    console.log(`[WhatsApp] 🔧 MODO DEV — Mensaje simulado para "${tipo}":`);
    console.log("-".repeat(50));
    console.log(message);
    console.log("-".repeat(50));
    return { simulated: true, tipo, toPhone };
  }

  const result = await sendEvolutionApiMessage(toPhone, message);
  console.log(`[WhatsApp] Respuesta API:`, JSON.stringify(result).substring(0, 200));
  return result;
}

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------
module.exports = {
  sendWhatsAppMessage,
  buildClienteMessage,
  buildDuenoMessage,
};
