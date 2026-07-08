/**
 * =============================================================================
 * OLAPHONE — CRON: RECORDATORIO AUTOMÁTICO DE LEADS
 * =============================================================================
 * Se ejecuta cada 30 minutos (usando setInterval en Node.js).
 * Lógica:
 *   1. Lee todos los leads de data/leads.json
 *   2. Filtra los que llevan >= 2 horas sin recibir un mensaje del bot
 *      y que aún no fueron recordados ni convirtieron
 *   3. Envía un mensaje de WhatsApp de recordatorio vía Evolution API
 *   4. Marca el lead como reminded = true
 *
 * INTEGRACIÓN CON EL CHATBOT:
 * Cuando el cliente responde al bot (cualquier mensaje entrante),
 * el chatbot llama a markLeadConverted(phone) para marcar converted = true
 * y así el cron ya no enviará más recordatorios.
 * =============================================================================
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { sendWhatsApp } = require("../utils/evolutionApi");

const LEADS_FILE       = path.join(__dirname, "..", "data", "leads.json");
const REMINDER_DELAY   = parseInt(process.env.LEAD_REMINDER_HOURS || "2", 10) * 60 * 60 * 1000; // 2h en ms
const CHECK_INTERVAL   = parseInt(process.env.LEAD_CHECK_MINUTES  || "30", 10) * 60 * 1000;     // 30 min en ms

// ── HELPERS ───────────────────────────────────────────────────────────────────

function readLeads() {
  try {
    if (!fs.existsSync(LEADS_FILE)) return [];
    return JSON.parse(fs.readFileSync(LEADS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeLeads(leads) {
  try {
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2), "utf-8");
  } catch (err) {
    console.error("[LeadReminder] Error escribiendo leads.json:", err.message);
  }
}

// ── MENSAJE DE RECORDATORIO ───────────────────────────────────────────────────

function buildReminderMessage(nombre) {
  const firstName = nombre.split(" ")[0]; // Solo el primer nombre
  return (
    `¡Hola ${firstName}! 👋 Soy el asistente de *OlaPhone Olavarría*.\n\n` +
    `Notamos que visitaste nuestra web hace un rato y quisimos ver si necesitás ayuda. 😊\n\n` +
    `Podemos ayudarte con:\n` +
    `📱 Precios y stock de celulares\n` +
    `🔋 Accesorios y fundas\n` +
    `🔧 Servicio técnico\n` +
    `🚚 Envíos a todo el país\n\n` +
    `¿En qué te puedo asesorar?`
  );
}

// ── PROCESO PRINCIPAL ─────────────────────────────────────────────────────────

async function processReminders() {
  const leads    = readLeads();
  const now      = Date.now();
  let   modified = false;

  const pendingLeads = leads.filter((lead) => {
    if (lead.converted)  return false;  // Ya compró/respondió
    if (lead.reminded)   return false;  // Ya recibió recordatorio
    const age = now - new Date(lead.capturedAt).getTime();
    return age >= REMINDER_DELAY;
  });

  if (pendingLeads.length === 0) {
    console.log(`[LeadReminder] Sin leads pendientes. Próxima revisión en ${CHECK_INTERVAL / 60000} min.`);
    return;
  }

  console.log(`[LeadReminder] ${pendingLeads.length} lead(s) para recordar...`);

  for (const lead of pendingLeads) {
    try {
      const jid     = `${lead.telefono}@s.whatsapp.net`;
      const message = buildReminderMessage(lead.nombre);

      await sendWhatsApp(jid, message);

      // Marcar como recordado
      const idx = leads.findIndex((l) => l.id === lead.id);
      if (idx !== -1) {
        leads[idx].reminded   = true;
        leads[idx].remindedAt = new Date().toISOString();
        modified = true;
      }

      console.log(`[LeadReminder] ✓ Recordatorio enviado a ${lead.nombre} (${lead.telefono})`);

      // Pequeña pausa entre mensajes para no saturar la API
      await new Promise((r) => setTimeout(r, 1500));

    } catch (err) {
      console.error(`[LeadReminder] Error enviando a ${lead.nombre} (${lead.telefono}):`, err.message);
    }
  }

  if (modified) writeLeads(leads);
}

// ── MARCAR LEAD COMO CONVERTIDO (llamado desde chatbot.js) ───────────────────

/**
 * Cuando el chatbot recibe un mensaje de un número que es lead,
 * lo marca como converted = true para que no reciba recordatorios.
 * @param {string} phone - Número en formato E.164 sin "+" (ej: "542284641652")
 */
function markLeadConverted(phone) {
  try {
    const cleanPhone = String(phone).replace(/\D/g, "");
    const leads      = readLeads();
    const lead       = leads.find(
      (l) => l.telefono === cleanPhone || cleanPhone.endsWith(l.telefono)
    );

    if (lead && !lead.converted) {
      lead.converted   = true;
      lead.convertedAt = new Date().toISOString();
      writeLeads(leads);
      console.log(`[LeadReminder] Lead convertido: ${lead.nombre} (${cleanPhone})`);
    }
  } catch (err) {
    console.error("[LeadReminder] Error marcando convertido:", err.message);
  }
}

// ── INICIAR EL CRON ──────────────────────────────────────────────────────────

function startLeadReminderCron() {
  console.log(`[LeadReminder] Cron iniciado. Revisión cada ${CHECK_INTERVAL / 60000} min, recordatorio a las ${REMINDER_DELAY / 3600000}h.`);

  // Primera ejecución al iniciar (después de 1 minuto para que el servidor esté listo)
  setTimeout(processReminders, 60 * 1000);

  // Luego cada CHECK_INTERVAL
  setInterval(processReminders, CHECK_INTERVAL);
}

module.exports = { startLeadReminderCron, markLeadConverted };
