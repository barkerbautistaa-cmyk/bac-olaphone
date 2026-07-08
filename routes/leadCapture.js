/**
 * =============================================================================
 * OLAPHONE — RUTA: POST /lead/capture
 * =============================================================================
 * Recibe los datos del popup de WhatsApp (nombre + teléfono) y los guarda
 * en data/leads.json con timestamp y estado "pending" (sin respuesta aún).
 *
 * El cron de leadReminder.js revisará este archivo cada 30 min y enviará
 * un recordatorio por WhatsApp a los leads que lleven +2 horas sin responder.
 * =============================================================================
 */

"use strict";

const express = require("express");
const fs      = require("fs");
const path    = require("path");
const { v4: uuidv4 } = require("uuid");
const router  = express.Router();

const LEADS_FILE = path.join(__dirname, "..", "data", "leads.json");

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
  const dir = path.dirname(LEADS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2), "utf-8");
}

function normalizePhone(raw) {
  // Eliminar todo lo que no sea dígito
  const digits = String(raw).replace(/\D/g, "");

  // Si ya tiene prefijo 54 internacional → usar directo
  if (digits.startsWith("54") && digits.length >= 10) return digits;

  // Si empieza con 0 (formato local) → quitar el 0 y agregar 54
  if (digits.startsWith("0")) return "54" + digits.slice(1);

  // Cualquier otro → agregar 54
  return "54" + digits;
}

// ── POST /lead/capture ────────────────────────────────────────────────────────
router.post("/capture", (req, res) => {
  const { nombre, telefono, origen, pagina } = req.body || {};

  // Validación básica
  if (!nombre || !telefono) {
    return res.status(400).json({ error: "nombre y telefono son requeridos" });
  }

  const cleanPhone = normalizePhone(telefono);

  // Evitar duplicados recientes (mismo número en las últimas 2 horas)
  const leads = readLeads();
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const recent = leads.find(
    (l) =>
      l.telefono === cleanPhone &&
      Date.now() - new Date(l.capturedAt).getTime() < TWO_HOURS
  );

  if (recent) {
    // Ya existe → solo actualizar timestamp para reiniciar el timer
    recent.capturedAt = new Date().toISOString();
    recent.reminded   = false;   // Reiniciar recordatorio
    writeLeads(leads);
    console.log(`[Lead] Reiniciado timer para: ${nombre} (${cleanPhone})`);
    return res.json({ ok: true, action: "refreshed" });
  }

  // Crear nuevo lead
  const lead = {
    id:          uuidv4(),
    nombre:      nombre.trim().substring(0, 60),
    telefono:    cleanPhone,
    origen:      origen || "wa_float_button",
    pagina:      pagina  || "",
    capturedAt:  new Date().toISOString(),
    reminded:    false,
    remindedAt:  null,
    converted:   false,  // true cuando el cliente envíe un mensaje al bot
    convertedAt: null,
  };

  leads.push(lead);
  writeLeads(leads);

  console.log(`[Lead] Capturado: ${lead.nombre} → ${cleanPhone} (${origen || "web"})`);
  res.json({ ok: true, action: "created", id: lead.id });
});

module.exports = router;
