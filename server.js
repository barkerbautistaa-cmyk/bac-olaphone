/**
 * =============================================================================
 * OLAPHONE — BACKEND CLOUD (v2)
 * =============================================================================
 * ENDPOINTS:
 *   POST /webhook/sync-stock      → Sincronizador de stock (extractor Python)
 *   POST /webhook/cart            → Procesador de carritos del frontend
 *   POST /chatbot/incoming        → Chatbot WhatsApp (Evolution API webhook)
 *   GET  /products.json           → Productos para el frontend
 *   GET  /health                  → Health check
 * =============================================================================
 */

require("dotenv").config();
const express = require("express");
const path    = require("path");
const fs      = require("fs");

// Rutas de los sub-componentes
const syncStockRouter   = require("./routes/syncStock");
const processCartRouter  = require("./routes/processCart");
const chatbotRouter      = require("./routes/chatbot");
const leadCaptureRouter  = require("./routes/leadCapture");

// Cron de recordatorios de leads
const { startLeadReminderCron } = require("./reports/leadReminder");

// Cron de sincronización con Google Sheets (reemplaza al extractor en Python)
const { startCsvSyncCron } = require("./utils/csvSync");

const app  = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// SERVIR FRONTEND ESTÁTICO (carpeta public/)
// ---------------------------------------------------------------------------
// La página web completa se sirve desde el mismo servidor, eliminando CORS.
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// MIDDLEWARE GLOBAL
// ---------------------------------------------------------------------------

// Parseo de JSON en el body de las requests
// Límite 10mb para soportar imágenes de comprobantes en base64
app.use(express.json({ limit: "10mb" }));

// CORS: permite peticiones del frontend en Netlify (y localhost para desarrollo)
app.use((req, res, next) => {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const origin = req.headers.origin;

  // En desarrollo, permitir todo; en producción, filtrar por lista blanca
  if (process.env.NODE_ENV !== "production" || allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Webhook-Secret");
  res.setHeader("Access-Control-Max-Age", "86400"); // Preflight cache 24h

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Logger de requests
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Middleware de autenticación por token secreto
// Aplica solo a endpoints de webhook (no a GET /products.json ni /health)
function requireWebhookAuth(req, res, next) {
  const token = req.headers["x-webhook-secret"];
  if (!token || token !== process.env.WEBHOOK_SECRET) {
    console.warn(`[AUTH] Intento no autorizado desde ${req.ip} — token inválido o ausente`);
    return res.status(401).json({ error: "No autorizado: token secreto inválido o ausente" });
  }
  next();
}

// ---------------------------------------------------------------------------
// RUTA: Servir products.json como endpoint GET estático
// ---------------------------------------------------------------------------
// El frontend hace fetch a esta URL para obtener el catálogo de productos.
// El archivo es generado/actualizado por el sub-componente A (syncStock).
const PRODUCTS_FILE = path.join(__dirname, "data", "products.json");

app.get("/api/catalog.json", (req, res) => {
  if (!fs.existsSync(PRODUCTS_FILE)) {
    return res.status(404).json({ error: "Catálogo de productos no disponible aún." });
  }
  // Cache de 5 minutos — Netlify puede invalidar este caché en cada deploy
  res.setHeader("Cache-Control", "public, max-age=300");
  res.sendFile(PRODUCTS_FILE);
});

// ---------------------------------------------------------------------------
// RUTAS DE WEBHOOKS (autenticadas)
// ---------------------------------------------------------------------------
app.use("/webhook/sync-stock", requireWebhookAuth, syncStockRouter);
app.use("/webhook/cart",       requireWebhookAuth, processCartRouter);

// Chatbot: Evolution API envía los mensajes aquí (sin auth de webhook,
// ya que Evolution usa su propio sistema de verificación por API key)
app.use("/chatbot", chatbotRouter);

// Lead capture: recibe nombre + teléfono del popup de WhatsApp en la web
// Sin autenticación (es pública, accesible desde el frontend)
app.use("/lead", leadCaptureRouter);

// ---------------------------------------------------------------------------
// RUTA: Health Check
// ---------------------------------------------------------------------------
app.get("/health", (req, res) => {
  const productsExist = fs.existsSync(PRODUCTS_FILE);
  res.json({
    status:          "ok",
    timestamp:       new Date().toISOString(),
    products_loaded: productsExist,
    env:             process.env.NODE_ENV || "development",
  });
});

// ---------------------------------------------------------------------------
// MANEJADOR DE ERRORES GLOBAL
// ---------------------------------------------------------------------------
app.use((err, req, res, _next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.stack || err.message);
  res.status(500).json({
    error:   "Error interno del servidor",
    message: process.env.NODE_ENV === "production" ? undefined : err.message,
  });
});

// ---------------------------------------------------------------------------
// ARRANQUE DEL SERVIDOR
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log("=".repeat(60));
  console.log(`  OlaPhone Backend v2 — INICIADO`);
  console.log(`  Puerto: ${PORT}`);
  console.log(`  Entorno: ${process.env.NODE_ENV || "development"}`);
  console.log(`  Endpoints:`);
  console.log(`    POST /webhook/sync-stock   → Stock extractor`);
  console.log(`    POST /webhook/cart          → Carritos`);
  console.log(`    POST /chatbot/incoming      → WhatsApp bot`);
  console.log(`    POST /lead/capture          → Captura de leads`);
  console.log(`    GET  /products.json         → Catálogo`);
  console.log(`    GET  /health                → Estado`);
  console.log("=".repeat(60));

  // Iniciar el cron de recordatorios de leads
  startLeadReminderCron();

  // Iniciar el cron de sincronización con Google Sheets
  startCsvSyncCron();
});

module.exports = app;
