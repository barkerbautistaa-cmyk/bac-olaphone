/**
 * =============================================================================
 * OLAPHONE — RUTA: /chatbot/incoming
 * =============================================================================
 * Endpoint principal que recibe todos los webhooks de Evolution API,
 * clasifica el mensaje, ejecuta el handler correspondiente y responde
 * al cliente por WhatsApp.
 *
 * Flujo:
 *   Evolution API → POST /chatbot/incoming
 *      → Normalizar mensaje
 *      → Clasificar intención
 *      → Ejecutar handler
 *      → Responder al cliente
 *      → (si corresponde) Notificar grupo de empleados
 * =============================================================================
 */

"use strict";

const express = require("express");
const router  = express.Router();

const { classifyIntent }            = require("../handlers/intentClassifier");
const { buildProductResponse, buildCatalogMenu } = require("../handlers/catalogQuery");
const { buildOrderStatusResponse }  = require("../handlers/orderStatus");
const {
  analyzeReceipt,
  validateAgainstOrder,
  getPendingOrder,
  markOrderPaid,
} = require("../handlers/paymentVerifier");
const { sendDispatchReport }        = require("../reports/dispatchReport");
const { sendWhatsApp, downloadMedia } = require("../utils/evolutionApi");
const { markLeadConverted }         = require("../reports/leadReminder");

// Ignorar mensajes propios del bot o de grupos si no se configuró para ellos
const IGNORE_FROM_ME = true;

// ── NORMALIZACIÓN DEL MENSAJE DE EVOLUTION API ───────────────────────────────
/**
 * Normaliza el payload de Evolution API a un objeto estándar.
 * @param {object} payload - Body del webhook
 * @returns {object|null} - Mensaje normalizado o null si debe ignorarse
 */
function normalizeMessage(payload) {
  try {
    const event   = payload.event || payload.type;
    const data    = payload.data  || payload;

    // Solo procesar mensajes entrantes
    if (event !== "messages.upsert" && event !== "message") return null;

    const msg    = data.messages?.[0] || data.message || data;
    const key    = msg.key || {};
    const fromMe = key.fromMe || false;

    // Ignorar mensajes propios
    if (IGNORE_FROM_ME && fromMe) return null;

    const sender    = key.remoteJid || data.sender || "";
    const phone     = sender.replace(/@s\.whatsapp\.net|@g\.us/g, "");
    const isGroup   = sender.includes("@g.us");
    const msgContent= msg.message || {};

    // Extraer texto e tipo
    let text = "";
    let type = "text";
    let mediaMessageId = null;

    if (msgContent.conversation) {
      text = msgContent.conversation;
    } else if (msgContent.extendedTextMessage?.text) {
      text = msgContent.extendedTextMessage.text;
    } else if (msgContent.imageMessage) {
      type = "image";
      text = msgContent.imageMessage.caption || "";
      mediaMessageId = key.id;
    } else if (msgContent.documentMessage) {
      type = "document";
      text = msgContent.documentMessage.caption || "";
      mediaMessageId = key.id;
    } else if (msgContent.audioMessage) {
      type = "audio";
    }

    return {
      phone,
      sender,
      isGroup,
      text:           text.trim(),
      type,
      messageId:      key.id,
      mediaMessageId,
      timestamp:      msg.messageTimestamp || Date.now(),
    };

  } catch (err) {
    console.error("[Chatbot] Error normalizando mensaje:", err.message);
    return null;
  }
}

// ── RESPUESTAS ESTÁTICAS ──────────────────────────────────────────────────────
const STORE_HOURS   = process.env.STORE_HOURS   || "Lun-Vie 9-18hs, Sáb 9-13hs";
const STORE_ADDR_1  = process.env.STORE_ADDRESS_1 || "Necochea 2936, Olavarría";
const STORE_ADDR_2  = process.env.STORE_ADDRESS_2 || "Vicente López 2969, Olavarría";

const RESPONSES = {
  greeting: () =>
    `¡Hola! 👋 Bienvenido a *OlaPhone Olavarría*. 📱\n\n` +
    `¿En qué te puedo ayudar?\n\n` +
    `1️⃣ Ver catálogo / precios\n` +
    `2️⃣ Estado de mi pedido\n` +
    `3️⃣ Horarios y ubicación\n` +
    `4️⃣ Enviar comprobante de pago\n` +
    `5️⃣ Hablar con un asesor\n\n` +
    `_Respondé con el número o escribí tu consulta directamente_ 😊`,

  location: () =>
    `📍 *Dónde encontrarnos:*\n\n` +
    `🏪 ${STORE_ADDR_1}\n` +
    `🏪 ${STORE_ADDR_2}\n\n` +
    `📅 *Horarios:* ${STORE_HOURS}\n\n` +
    `🌐 También podés comprar online en *olaphone.com.ar*\n` +
    `con envío a todo el país 🚚`,

  hours: () =>
    `🕐 *Horarios de atención:*\n\n` +
    `${STORE_HOURS}\n\n` +
    `📍 *Sucursales:*\n` +
    `• ${STORE_ADDR_1}\n` +
    `• ${STORE_ADDR_2}`,

  shipping: () =>
    `🚚 *Envíos a todo el país:*\n\n` +
    `✅ Correo Argentino\n` +
    `✅ OCA\n` +
    `✅ Seguimiento en tiempo real\n` +
    `✅ Embalaje seguro\n\n` +
    `⏱️ Demora estimada: 2-5 días hábiles según destino.\n\n` +
    `💬 Consultanos el costo de envío a tu ciudad.`,

  thanks: () =>
    `¡Gracias a vos! 🙌 Si necesitás algo más, acá estamos. 😊`,

  unknown: () =>
    `🤔 No entendí bien tu consulta.\n\n` +
    `Podés escribir:\n` +
    `• *catálogo* — ver productos\n` +
    `• *precio [producto]* — buscar un precio\n` +
    `• *pedido* — ver tu pedido\n` +
    `• *dirección* — dónde estamos\n\n` +
    `O esperá un momento y un asesor te responde. 😊`,
};

// ── WEBHOOK HANDLER ───────────────────────────────────────────────────────────
router.post("/incoming", async (req, res) => {
  // Responder 200 inmediatamente para no bloquear Evolution API
  res.status(200).json({ received: true });

  const msg = normalizeMessage(req.body);
  if (!msg) return;

  // No responder en grupos (solo en chats privados)
  if (msg.isGroup) return;

  console.log(`[Chatbot] Mensaje de ${msg.phone} — tipo: ${msg.type} — "${msg.text.substring(0, 60)}"`);

  // Si el remitente era un lead (visitó la web y dejó su número),
  // marcarlo como convertido para cancelar el recordatorio automático
  markLeadConverted(msg.phone);

  const { intent, orderId } = classifyIntent(msg);
  console.log(`[Chatbot] Intent detectado: ${intent}${orderId ? ` (pedido: ${orderId})` : ""}`);

  let reply = null;

  try {
    switch (intent) {
      case "greeting":
        reply = RESPONSES.greeting();
        break;

      case "catalog":
        reply = buildCatalogMenu();
        break;

      case "price_query": {
        // Buscar el producto mencionado en el texto
        const searchTerm = msg.text.replace(/precio|cuesta|sale|vale|valor|de|del|el|la/gi, "").trim();
        reply = searchTerm.length > 2
          ? buildProductResponse(searchTerm)
          : buildCatalogMenu();
        break;
      }

      case "order_status":
        reply = buildOrderStatusResponse(msg.phone, orderId);
        break;

      case "location":
        reply = RESPONSES.location();
        break;

      case "hours":
        reply = RESPONSES.hours();
        break;

      case "shipping":
        reply = RESPONSES.shipping();
        break;

      case "thanks":
        reply = RESPONSES.thanks();
        break;

      case "payment":
        // El cliente dice que pagó pero sin imagen → pedirle el comprobante
        reply =
          `✅ ¡Perfecto! Para confirmar tu pago, por favor envianos el *comprobante de transferencia como imagen* 📷\n\n` +
          `(foto o captura de pantalla del comprobante del banco/billetera)`;
        break;

      case "image_received": {
        // ── FLUJO DE VERIFICACIÓN DE COMPROBANTE ────────────────────────
        reply = `⏳ Recibí tu imagen. Estoy verificando el comprobante... (esto tarda unos segundos)`;
        await sendWhatsApp(msg.sender, reply);
        reply = null; // Ya enviamos el reply de "procesando"

        const pendingOrder = getPendingOrder(msg.phone);

        if (!pendingOrder) {
          reply =
            `❓ No encontré ningún pedido pendiente de pago asociado a tu número.\n\n` +
            `Si realizaste el pedido con otro WhatsApp, escribínos con el número de pedido (OLA-XXXX).`;
          break;
        }

        // Descargar y analizar la imagen
        let receipt = null;
        try {
          const { buffer, mimeType } = await downloadMedia(msg.mediaMessageId);
          receipt = await analyzeReceipt(buffer, mimeType);
        } catch (dlErr) {
          console.error("[Chatbot] Error descargando media:", dlErr.message);
          receipt = { manual_review_needed: true, error: dlErr.message };
        }

        const validation = validateAgainstOrder(receipt, pendingOrder);

        if (validation.valid) {
          // ✅ COMPROBANTE VÁLIDO
          markOrderPaid(msg.phone, receipt);

          reply =
            `✅ *¡Pago confirmado!*\n\n` +
            `Recibimos tu transferencia de *${receipt.amount ? `$${receipt.amount.toLocaleString("es-AR")}` : "el monto correcto"}* correctamente.\n\n` +
            `📦 Tu pedido *${pendingOrder.id_pedido}* ya está en preparación.\n` +
            `📬 Te avisamos cuando sea despachado. ¡Gracias por tu compra! 🎉`;

          // Notificar a empleados
          await sendDispatchReport(pendingOrder, receipt, "paid");

        } else if (validation.reason === "AMOUNT_MISMATCH") {
          reply =
            `⚠️ *El monto no coincide con tu pedido.*\n\n` +
            `Monto esperado: *$${(validation.expected || 0).toLocaleString("es-AR")}*\n` +
            `Monto recibido: *$${(validation.received || 0).toLocaleString("es-AR")}*\n\n` +
            `Si hay un error, por favor contactate con un asesor.`;

          await sendDispatchReport(pendingOrder, receipt, "alert");

        } else if (validation.reason === "NOT_RECENT") {
          reply =
            `⚠️ El comprobante parece ser de una fecha anterior. ` +
            `¿Podés enviarnos uno más reciente? Si ya realizaste el pago hoy, escribínos y un asesor te ayuda.`;

          await sendDispatchReport(pendingOrder, receipt, "alert");

        } else if (validation.reason === "MANUAL_REVIEW" || validation.reason === "LOW_CONFIDENCE") {
          reply =
            `🔍 No pude verificar el comprobante automáticamente (imagen borrosa o poco legible).\n\n` +
            `Un asesor va a revisarlo manualmente y te confirma en breve. ¡Gracias por la paciencia! 😊`;

          await sendDispatchReport(pendingOrder, receipt, "alert");

        } else if (validation.reason === "NO_RECEIPT") {
          reply =
            `❌ La imagen que enviaste no parece ser un comprobante de transferencia.\n\n` +
            `Envianos una *foto o captura del comprobante del banco/billetera* y lo procesamos de inmediato.`;
        } else {
          reply =
            `⚠️ Hubo un problema al verificar el comprobante. Un asesor lo revisa y te confirma. 😊`;
          await sendDispatchReport(pendingOrder, receipt, "alert");
        }

        break;
      }

      case "whatsapp_cart":
        // El pedido fue enviado directo desde la web — registrar y confirmar
        reply =
          `✅ ¡Recibimos tu pedido! Para confirmar la compra, realizá la transferencia al alias/CBU:\n\n` +
          `🏦 *Alias:* OLAPHONE.OLAVARRIA\n` +
          `💰 Monto exacto del pedido\n\n` +
          `Luego envianos el *comprobante como imagen* por este chat y lo procesamos al toque. 🙌`;
        break;

      case "unknown":
      default:
        reply = RESPONSES.unknown();
        break;
    }

    if (reply) {
      await sendWhatsApp(msg.sender, reply);
    }

  } catch (err) {
    console.error("[Chatbot] Error procesando mensaje:", err.message, err.stack);
    try {
      await sendWhatsApp(
        msg.sender,
        `⚠️ Hubo un problema procesando tu mensaje. Un asesor te atiende en breve. Disculpá las molestias.`
      );
    } catch {}
  }
});

// Ping de verificación de Evolution API
router.get("/incoming", (req, res) => {
  res.json({ status: "ok", service: "OlaPhone Chatbot", timestamp: new Date().toISOString() });
});

module.exports = router;
