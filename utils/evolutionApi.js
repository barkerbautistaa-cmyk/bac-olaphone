/**
 * =============================================================================
 * OLAPHONE — CHATBOT: UTILIDAD DE ENVÍO POR EVOLUTION API
 * =============================================================================
 * Wrapper para enviar mensajes de texto e imágenes vía Evolution API.
 * =============================================================================
 */

"use strict";

const https = require("https");
const http  = require("http");
const url   = require("url");

const EVOLUTION_BASE_URL    = process.env.EVOLUTION_BASE_URL    || "http://localhost:8080";
const EVOLUTION_INSTANCE    = process.env.EVOLUTION_INSTANCE    || "olaphone";
const EVOLUTION_API_KEY     = process.env.EVOLUTION_API_KEY     || "";

/**
 * Hace una petición HTTP/HTTPS a la Evolution API.
 */
function evolutionRequest(endpoint, body) {
  return new Promise((resolve, reject) => {
    const parsed  = url.parse(`${EVOLUTION_BASE_URL}${endpoint}`);
    const isHttps = parsed.protocol === "https:";
    const client  = isHttps ? https : http;
    const payload = JSON.stringify(body);

    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.path,
      method:   "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(payload),
        apikey:           EVOLUTION_API_KEY,
      },
    };

    const req = client.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Envía un mensaje de texto por WhatsApp.
 * @param {string} to       - Número destino (E.164 sin +) o ID de grupo
 * @param {string} text     - Texto del mensaje
 * @param {object} options  - { isGroup: false }
 */
async function sendWhatsApp(to, text, options = {}) {
  const endpoint = `/message/sendText/${EVOLUTION_INSTANCE}`;
  const body = {
    number: to,
    text,
    delay: 1000,
  };

  try {
    const res = await evolutionRequest(endpoint, body);
    if (res.status >= 200 && res.status < 300) {
      return { success: true, messageId: res.body?.key?.id };
    }
    throw new Error(`Evolution API respondió ${res.status}: ${JSON.stringify(res.body)}`);
  } catch (err) {
    console.error("[EvolutionAPI] Error enviando mensaje:", err.message);
    throw err;
  }
}

/**
 * Descarga una imagen desde la URL de Evolution API y devuelve el buffer.
 * @param {string} messageId - ID del mensaje con imagen
 * @returns {Promise<{ buffer: Buffer, mimeType: string }>}
 */
async function downloadMedia(messageId) {
  const endpoint = `/chat/getBase64FromMediaMessage/${EVOLUTION_INSTANCE}`;
  const body     = { message: { key: { id: messageId } }, convertToMp4: false };

  const res = await evolutionRequest(endpoint, body);
  if (!res.body?.base64) throw new Error("No se pudo descargar la imagen.");

  return {
    buffer:   Buffer.from(res.body.base64, "base64"),
    mimeType: res.body.mimetype || "image/jpeg",
  };
}

module.exports = { sendWhatsApp, downloadMedia };
