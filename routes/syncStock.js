/**
 * =============================================================================
 * SUB-COMPONENTE A: SINCRONIZADOR DE STOCK
 * =============================================================================
 * Recibe el payload del extractor Python con el inventario actualizado.
 * Realiza un merge inteligente sobre products.json (no reemplaza, actualiza).
 * Dispara el Deploy Hook de Netlify para publicar los cambios al frontend.
 *
 * ENDPOINT: POST /webhook/sync-stock
 *
 * PAYLOAD ESPERADO:
 * {
 *   "source":    "extractor_local",
 *   "file_hash": "abc123...",
 *   "timestamp": "2024-01-15T10:30:00Z",
 *   "productos": [
 *     { "id": "PROD-001", "nombre": "...", "stock": 15, "precio": 89999.99 },
 *     ...
 *   ]
 * }
 * =============================================================================
 */

const express = require("express");
const fs      = require("fs");
const path    = require("path");
const { triggerNetlifyDeploy } = require("../utils/netlifyDeploy");

const router       = express.Router();
const PRODUCTS_FILE = path.join(__dirname, "../data/products.json");
const DATA_DIR      = path.join(__dirname, "../data");

// ---------------------------------------------------------------------------
// VALIDACIÓN DEL PAYLOAD
// ---------------------------------------------------------------------------
function validatePayload(body) {
  const errors = [];

  if (!body || typeof body !== "object")      errors.push("Body debe ser un objeto JSON");
  if (!Array.isArray(body.productos))          errors.push("'productos' debe ser un array");
  if (typeof body.file_hash !== "string")      errors.push("'file_hash' es requerido");
  if (typeof body.timestamp !== "string")      errors.push("'timestamp' es requerido");

  if (Array.isArray(body.productos)) {
    body.productos.forEach((p, i) => {
      if (!p.id)                               errors.push(`productos[${i}]: 'id' faltante`);
      if (!p.nombre)                           errors.push(`productos[${i}]: 'nombre' faltante`);
      if (typeof p.stock !== "number")         errors.push(`productos[${i}]: 'stock' debe ser número`);
      if (typeof p.precio !== "number")        errors.push(`productos[${i}]: 'precio' debe ser número`);
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// MERGE INTELIGENTE DE PRODUCTOS
// ---------------------------------------------------------------------------
/**
 * Combina los productos recibidos con el catálogo existente en disco.
 * Estrategia:
 *  - Si el producto ya existe (por ID): actualiza stock y precio.
 *  - Si es nuevo: lo agrega al catálogo.
 *  - Los productos del catálogo que NO vienen en el nuevo payload
 *    se mantienen (podrían ser productos manuales cargados desde el panel).
 *  - El campo `updatedAt` se registra para trazabilidad.
 *
 * @param {Array} existingProducts - Productos actuales en products.json
 * @param {Array} incomingProducts - Productos recibidos del extractor
 * @returns {Array} Catálogo fusionado y actualizado
 */
function mergeProducts(existingProducts, incomingProducts) {
  const now = new Date().toISOString();

  // Indexar el catálogo existente por ID para búsqueda O(1)
  const productMap = new Map(existingProducts.map((p) => [p.id, { ...p }]));

  let added   = 0;
  let updated = 0;

  for (const incoming of incomingProducts) {
    if (productMap.has(incoming.id)) {
      // Actualizar campos dinámicos; preservar campos manuales (imagen, descripción, etc.)
      const existing = productMap.get(incoming.id);
      existing.nombre    = incoming.nombre;
      existing.stock     = incoming.stock;
      existing.precio    = incoming.precio;
      existing.updatedAt = now;
      productMap.set(incoming.id, existing);
      updated++;
    } else {
      // Producto nuevo
      productMap.set(incoming.id, {
        id:          incoming.id,
        nombre:      incoming.nombre,
        stock:       incoming.stock,
        precio:      incoming.precio,
        imagen:      null,          // Se puede completar manualmente
        descripcion: null,          // Se puede completar manualmente
        createdAt:   now,
        updatedAt:   now,
      });
      added++;
    }
  }

  const merged = Array.from(productMap.values());
  console.log(`[syncStock] Merge completado: ${updated} actualizados, ${added} nuevos. Total: ${merged.length}`);
  return merged;
}

// ---------------------------------------------------------------------------
// ESCRITURA ATÓMICA DEL ARCHIVO
// ---------------------------------------------------------------------------
/**
 * Escribe products.json de forma atómica:
 * 1. Escribe a un archivo temporal (.tmp).
 * 2. Renombra el .tmp al archivo final (operación atómica en la mayoría de OS).
 * Evita que el frontend lea un archivo parcialmente escrito.
 */
function writeProductsAtomic(products) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const tempFile = PRODUCTS_FILE + ".tmp";
  const payload  = JSON.stringify(
    {
      updatedAt: new Date().toISOString(),
      count:     products.length,
      productos: products,
    },
    null,
    2 // Indentación para legibilidad
  );

  fs.writeFileSync(tempFile, payload, "utf8");
  fs.renameSync(tempFile, PRODUCTS_FILE);
  console.log(`[syncStock] products.json actualizado (${products.length} productos)`);
}

// ---------------------------------------------------------------------------
// HANDLER PRINCIPAL DEL ENDPOINT
// ---------------------------------------------------------------------------
router.post("/", async (req, res) => {
  const body = req.body;

  // 1. Validar estructura del payload
  const errors = validatePayload(body);
  if (errors.length > 0) {
    console.warn("[syncStock] Payload inválido:", errors);
    return res.status(400).json({
      error:   "Payload inválido",
      details: errors,
    });
  }

  try {
    // 2. Leer catálogo existente (o inicializar vacío si no existe)
    let existingProducts = [];
    if (fs.existsSync(PRODUCTS_FILE)) {
      const raw      = fs.readFileSync(PRODUCTS_FILE, "utf8");
      const parsed   = JSON.parse(raw);
      existingProducts = parsed.productos || [];
    }

    // 3. Merge inteligente
    const mergedProducts = mergeProducts(existingProducts, body.productos);

    // 4. Escritura atómica en disco
    writeProductsAtomic(mergedProducts);

    // 5. Disparar deploy de Netlify (no bloquea la respuesta)
    triggerNetlifyDeploy()
      .then(({ success, message }) => {
        if (success) {
          console.log(`[syncStock] Netlify Deploy Trigger exitoso: ${message}`);
        } else {
          console.warn(`[syncStock] Netlify Deploy Trigger falló: ${message}`);
        }
      })
      .catch((err) => {
        console.error("[syncStock] Error inesperado en Netlify Deploy:", err.message);
      });

    // 6. Responder inmediatamente al extractor (no esperar el deploy)
    return res.status(200).json({
      success:          true,
      message:          "Stock sincronizado correctamente",
      productos_totales: mergedProducts.length,
      timestamp:        new Date().toISOString(),
    });

  } catch (err) {
    console.error("[syncStock] Error crítico:", err);
    return res.status(500).json({
      error:   "Error interno al sincronizar stock",
      message: err.message,
    });
  }
});

module.exports = router;
