/**
 * =============================================================================
 * OLAPHONE — CHATBOT: CONSULTA DE ESTADO DE PEDIDO
 * =============================================================================
 */

"use strict";

const { loadPendingOrders } = require("./paymentVerifier");
const { getPendingOrder }   = require("./paymentVerifier");

function fmtARS(n) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);
}

const STATUS_LABELS = {
  PENDING_PAYMENT: "⏳ Esperando comprobante de pago",
  PAID:            "✅ Pago confirmado — en preparación",
  SHIPPED:         "🚚 Despachado",
  DELIVERED:       "📬 Entregado",
  CANCELLED:       "❌ Cancelado",
};

/**
 * Responde con el estado de un pedido.
 * @param {string} phone    - Teléfono del cliente
 * @param {string} orderId  - ID de pedido (opcional, si se especificó en el mensaje)
 * @returns {string}
 */
function buildOrderStatusResponse(phone, orderId = null) {
  const order = getPendingOrder(phone);

  if (!order) {
    return (
      `❓ No encontré pedidos asociados a tu número.\n\n` +
      `Si hiciste un pedido recientemente, asegurate de escribir desde\n` +
      `el mismo WhatsApp que usaste al comprar.\n\n` +
      `💬 ¿Necesitás ayuda? Un asesor te atiende en breve.`
    );
  }

  const status = STATUS_LABELS[order.status] || "🔄 En proceso";
  const items  = (order.productos || [])
    .map((p) => `  • ${p.cantidad}× ${p.nombre}`)
    .join("\n");

  return (
    `📋 *Estado de tu pedido*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `N° \`${order.id_pedido}\`\n\n` +
    `*Estado:* ${status}\n\n` +
    `📦 *Productos:*\n${items}\n\n` +
    `💰 *Total:* ${fmtARS(order.total)}\n\n` +
    (order.status === "PENDING_PAYMENT"
      ? `⚠️ *Acción requerida:* Envianos el comprobante de la transferencia como imagen por este chat para confirmar tu pedido.`
      : `✅ ¡Gracias por tu compra! Cualquier consulta escribinos.`)
  );
}

module.exports = { buildOrderStatusResponse };
