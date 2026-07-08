/**
 * =============================================================================
 * OLAPHONE — CHATBOT: VERIFICADOR DE COMPROBANTES DE PAGO
 * =============================================================================
 * Analiza una imagen de comprobante de pago usando Google Gemini Vision API.
 * Extrae monto, banco, fecha, destinatario y valida contra el pedido pendiente.
 * =============================================================================
 */

"use strict";

const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs   = require("fs");
const path = require("path");

const GEMINI_API_KEY  = process.env.GEMINI_API_KEY || "";
const PENDING_ORDERS_FILE = path.join(__dirname, "../data/pending_orders.json");

// ── LEER/GUARDAR PEDIDOS PENDIENTES ──────────────────────────────────────────
function loadPendingOrders() {
  try {
    if (!fs.existsSync(PENDING_ORDERS_FILE)) return {};
    return JSON.parse(fs.readFileSync(PENDING_ORDERS_FILE, "utf8"));
  } catch { return {}; }
}

function savePendingOrders(orders) {
  try {
    fs.writeFileSync(PENDING_ORDERS_FILE, JSON.stringify(orders, null, 2), "utf8");
  } catch (e) {
    console.error("[PaymentVerifier] Error guardando pedidos:", e.message);
  }
}

/**
 * Registra un nuevo pedido como pendiente de pago.
 * @param {object} order - Payload del checkout
 */
function registerPendingOrder(order) {
  const orders = loadPendingOrders();
  const phone  = order.cliente?.telefono?.replace(/\D/g, "").slice(-10);
  if (!phone) return;
  orders[phone] = {
    ...order,
    status:     "PENDING_PAYMENT",
    registeredAt: new Date().toISOString(),
  };
  savePendingOrders(orders);
  console.log(`[PaymentVerifier] Pedido ${order.id_pedido} registrado como pendiente (tel: ${phone})`);
}

/**
 * Obtiene el pedido pendiente de un número de teléfono.
 * @param {string} phone - Número de teléfono (solo dígitos, sin prefijo país)
 */
function getPendingOrder(phone) {
  const orders = loadPendingOrders();
  const last10 = phone.replace(/\D/g, "").slice(-10);
  return orders[last10] || null;
}

/**
 * Marca un pedido como pagado.
 * @param {string} phone
 * @param {object} paymentData - Datos extraídos del comprobante
 */
function markOrderPaid(phone, paymentData) {
  const orders = loadPendingOrders();
  const last10 = phone.replace(/\D/g, "").slice(-10);
  if (!orders[last10]) return;
  orders[last10] = {
    ...orders[last10],
    status:    "PAID",
    paidAt:    new Date().toISOString(),
    payment:   paymentData,
  };
  savePendingOrders(orders);
}

// ── ANÁLISIS DE IMAGEN CON GEMINI VISION ────────────────────────────────────
const PROMPT_ANALYZE_RECEIPT = `
Analizá esta imagen. Es supuestamente un comprobante de transferencia bancaria argentina.

Respondé ÚNICAMENTE con un JSON válido (sin markdown, sin explicaciones extra) con este formato exacto:
{
  "is_payment_receipt": true/false,
  "bank": "nombre del banco o billetera (Galicia, Brubank, Naranja X, Mercado Pago, etc.)",
  "amount": 0,
  "currency": "ARS",
  "date": "dd/mm/aaaa o null si no se ve",
  "time": "hh:mm o null",
  "recipient_name": "nombre del destinatario o null",
  "recipient_cbu_alias": "CBU, CVU, alias o null",
  "reference_number": "número de operación o null",
  "is_recent": true/false,
  "is_outgoing": true/false,
  "confidence": 0.0,
  "issues": []
}

Reglas:
- is_recent = true si la fecha es de hoy o ayer
- is_outgoing = true si el dinero SALIÓ de la cuenta (el cliente pagó)
- confidence = qué tan seguro estás de que es un comprobante legítimo (0.0 a 1.0)
- issues = lista de problemas encontrados (ej: "imagen borrosa", "fecha no legible", "parece editada")
- Si NO es un comprobante de pago, devolvé is_payment_receipt: false y el resto en null
`.trim();

/**
 * Analiza la imagen con Gemini Vision y devuelve los datos del comprobante.
 * @param {string|Buffer} imageData - URL de la imagen o buffer
 * @param {string} mimeType - "image/jpeg" | "image/png" | "image/webp"
 * @returns {Promise<object>} Datos extraídos del comprobante
 */
async function analyzeReceipt(imageData, mimeType = "image/jpeg") {
  if (!GEMINI_API_KEY) {
    console.warn("[PaymentVerifier] GEMINI_API_KEY no configurada — usando análisis manual");
    return { is_payment_receipt: null, error: "API_KEY_MISSING", manual_review_needed: true };
  }

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Preparar la imagen para la API
    let imagePart;
    if (typeof imageData === "string" && imageData.startsWith("http")) {
      // URL pública — descargar primero
      const fetch = (await import("node-fetch")).default;
      const res   = await fetch(imageData);
      const buf   = await res.buffer();
      imagePart   = {
        inlineData: { data: buf.toString("base64"), mimeType },
      };
    } else if (Buffer.isBuffer(imageData)) {
      imagePart = {
        inlineData: { data: imageData.toString("base64"), mimeType },
      };
    } else {
      // Base64 directo
      imagePart = {
        inlineData: { data: String(imageData), mimeType },
      };
    }

    const result   = await model.generateContent([PROMPT_ANALYZE_RECEIPT, imagePart]);
    const rawText  = result.response.text().trim();

    // Limpiar posible markdown de la respuesta
    const jsonStr  = rawText.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
    const parsed   = JSON.parse(jsonStr);

    console.log("[PaymentVerifier] Análisis Gemini:", JSON.stringify(parsed, null, 2));
    return parsed;

  } catch (err) {
    console.error("[PaymentVerifier] Error en Gemini Vision:", err.message);
    return {
      is_payment_receipt: null,
      error: err.message,
      manual_review_needed: true,
    };
  }
}

/**
 * Valida el comprobante contra el pedido pendiente del cliente.
 * @param {object} receipt - Datos del comprobante (de analyzeReceipt)
 * @param {object} order   - Pedido pendiente del cliente
 * @returns {{ valid: boolean, reason: string }}
 */
function validateAgainstOrder(receipt, order) {
  if (!receipt.is_payment_receipt) {
    return { valid: false, reason: "NO_RECEIPT" };
  }
  if (receipt.manual_review_needed || receipt.error) {
    return { valid: false, reason: "MANUAL_REVIEW" };
  }
  if (receipt.confidence < 0.5) {
    return { valid: false, reason: "LOW_CONFIDENCE" };
  }
  if (!receipt.is_outgoing) {
    return { valid: false, reason: "NOT_OUTGOING" };
  }
  if (!receipt.is_recent) {
    return { valid: false, reason: "NOT_RECENT" };
  }

  // Validar monto (tolerancia del 1% por diferencias de redondeo)
  const expectedAmount = order.total;
  const receivedAmount = receipt.amount || 0;
  const tolerance      = expectedAmount * 0.01;
  if (Math.abs(receivedAmount - expectedAmount) > tolerance) {
    return {
      valid: false,
      reason: "AMOUNT_MISMATCH",
      expected: expectedAmount,
      received: receivedAmount,
    };
  }

  return { valid: true, reason: "OK" };
}

module.exports = {
  analyzeReceipt,
  validateAgainstOrder,
  registerPendingOrder,
  getPendingOrder,
  markOrderPaid,
};
