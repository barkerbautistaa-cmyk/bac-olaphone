/**
 * =============================================================================
 * OLAPHONE — CHATBOT: GENERADOR DE INFORME DE DESPACHO
 * =============================================================================
 * Genera el mensaje formateado para enviar al grupo de WhatsApp de empleados
 * cuando un pedido es confirmado/pagado.
 * =============================================================================
 */

"use strict";

const { sendWhatsApp } = require("../utils/evolutionApi");

const STAFF_GROUP_PHONE = process.env.STAFF_GROUP_PHONE || "";
const STORE_NAME        = "OlaPhone Olavarría";

// ── FORMATEO DE MONEDA ────────────────────────────────────────────────────────
function fmtARS(n) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);
}

// ── FORMATEO DE FECHA ────────────────────────────────────────────────────────
function fmtDate(isoStr) {
  try {
    return new Date(isoStr).toLocaleString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return isoStr; }
}

/**
 * Genera el texto del informe de despacho para el grupo de empleados.
 * @param {object} order    - Pedido completo
 * @param {object} payment  - Datos del comprobante verificado (opcional)
 * @param {string} mode     - "paid" | "pending" | "alert"
 * @returns {string} Texto formateado para WhatsApp
 */
function buildDispatchReport(order, payment = null, mode = "paid") {
  const items = (order.productos || [])
    .map((p) => `  • ${p.cantidad}× *${p.nombre}* = ${fmtARS(p.precio_unitario * p.cantidad)}`)
    .join("\n");

  const separator = "━━━━━━━━━━━━━━━━━━━━━━━━";

  let header, paymentBlock, action;

  switch (mode) {
    case "paid":
      header       = `✅ *PEDIDO CONFIRMADO — DESPACHAR*`;
      paymentBlock = payment
        ? `\n💳 *Pago verificado automáticamente:*\n` +
          `  Banco: ${payment.bank || "N/D"}\n` +
          `  Monto: ${fmtARS(payment.amount || order.total)}\n` +
          `  Fecha: ${payment.date || "N/D"} ${payment.time || ""}\n` +
          `  Ref: ${payment.reference_number || "N/D"}`
        : `\n💳 *Pago:* Verificado manualmente`;
      action = `📦 *ACCIÓN:* Preparar y despachar el pedido.`;
      break;

    case "pending":
      header       = `⏳ *NUEVO PEDIDO — ESPERANDO PAGO*`;
      paymentBlock = `\n💳 *Estado:* Esperando comprobante de transferencia del cliente.`;
      action = `👀 *ACCIÓN:* Esperar que el cliente envíe el comprobante.`;
      break;

    case "alert":
      header       = `⚠️ *ALERTA — REVISIÓN MANUAL REQUERIDA*`;
      paymentBlock = payment
        ? `\n⚠️ *Problema con el comprobante:*\n` +
          `  El bot no pudo verificar automáticamente.\n` +
          `  Issues: ${(payment.issues || []).join(", ") || "desconocido"}`
        : `\n⚠️ *El cliente envió un comprobante que requiere revisión manual.*`;
      action = `👁️ *ACCIÓN:* Revisar el comprobante y confirmar manualmente.`;
      break;
  }

  const report = [
    `${header}`,
    separator,
    `🏪 *${STORE_NAME}*`,
    `📋 *Pedido:* \`${order.id_pedido || "N/D"}\``,
    `🕐 *Registrado:* ${fmtDate(order.registeredAt || order.createdAt || new Date().toISOString())}`,
    separator,
    `👤 *Cliente:*`,
    `  Nombre: ${order.cliente?.nombre || "N/D"}`,
    `  WhatsApp: +${order.cliente?.telefono || "N/D"}`,
    order.notas ? `  Notas: _${order.notas}_` : null,
    separator,
    `📦 *Items a despachar:*`,
    items,
    `\n💰 *TOTAL: ${fmtARS(order.total || 0)}*`,
    paymentBlock,
    separator,
    action,
    `\n_Generado automáticamente por el sistema OlaPhone_`,
  ].filter(Boolean).join("\n");

  return report;
}

/**
 * Envía el informe al grupo de empleados vía WhatsApp.
 * @param {object} order
 * @param {object} payment
 * @param {string} mode
 */
async function sendDispatchReport(order, payment = null, mode = "paid") {
  if (!STAFF_GROUP_PHONE) {
    console.warn("[DispatchReport] STAFF_GROUP_PHONE no configurado — informe no enviado");
    return { sent: false, reason: "NO_STAFF_PHONE" };
  }

  const message = buildDispatchReport(order, payment, mode);

  try {
    await sendWhatsApp(STAFF_GROUP_PHONE, message, { isGroup: true });
    console.log(`[DispatchReport] ✓ Informe enviado al grupo (modo: ${mode})`);
    return { sent: true, mode };
  } catch (err) {
    console.error("[DispatchReport] Error enviando al grupo:", err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = { buildDispatchReport, sendDispatchReport };
