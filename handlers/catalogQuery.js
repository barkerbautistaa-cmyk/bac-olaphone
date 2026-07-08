/**
 * =============================================================================
 * OLAPHONE — CHATBOT: CONSULTA DE CATÁLOGO Y PRECIOS
 * =============================================================================
 * Permite al cliente consultar productos, precios y disponibilidad
 * directamente por WhatsApp.
 * =============================================================================
 */

"use strict";

const fs   = require("fs");
const path = require("path");

const PRODUCTS_FILE = path.join(__dirname, "../data/products.json");

function loadProducts() {
  try {
    const raw  = fs.readFileSync(PRODUCTS_FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : (data.productos || []);
  } catch { return []; }
}

function fmtARS(n) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);
}

/**
 * Busca productos por nombre aproximado.
 * @param {string} query
 * @returns {Array}
 */
function searchProducts(query) {
  const products = loadProducts();
  const terms    = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  return products.filter((p) =>
    terms.some(
      (t) =>
        p.nombre.toLowerCase().includes(t) ||
        (p.descripcion || "").toLowerCase().includes(t)
    )
  );
}

/**
 * Genera el mensaje de respuesta para una búsqueda de producto.
 * @param {string} query - Texto buscado
 * @returns {string}
 */
function buildProductResponse(query) {
  const results = searchProducts(query);

  if (results.length === 0) {
    return (
      `❌ No encontré "${query}" en nuestro catálogo.\n\n` +
      `📋 Podés ver todo el catálogo en: *olaphone.com.ar*\n` +
      `💬 O escribínos con el nombre exacto del producto.`
    );
  }

  const lines = results.slice(0, 4).map((p) => {
    const stockBadge =
      p.stock <= 0     ? "❌ Sin stock"
      : p.stock <= 3   ? `⚠️ Últimas ${p.stock} unidades`
      : `✅ En stock (${p.stock} disponibles)`;
    return (
      `📱 *${p.nombre}*\n` +
      `  💰 ${fmtARS(p.precio)}\n` +
      `  ${stockBadge}\n` +
      (p.descripcion ? `  _${p.descripcion.substring(0, 80)}${p.descripcion.length > 80 ? "..." : ""}_` : "")
    );
  });

  const moreCount = results.length - 4;
  const moreText  = moreCount > 0 ? `\n\n_...y ${moreCount} resultado(s) más. Ver todo en olaphone.com.ar_` : "";

  return (
    `🔍 Resultados para *"${query}"*:\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    lines.join("\n\n") +
    moreText +
    `\n\n💬 ¿Te interesa alguno? ¡Escribínos!`
  );
}

/**
 * Genera el menú de categorías disponibles.
 * @returns {string}
 */
function buildCatalogMenu() {
  const products  = loadProducts();
  const byCategory = {};

  products.forEach((p) => {
    const cat = p.categoria || "otros";
    if (!byCategory[cat]) byCategory[cat] = { total: 0, inStock: 0 };
    byCategory[cat].total++;
    if (p.stock > 0) byCategory[cat].inStock++;
  });

  const CATEGORY_ICONS = {
    telefonia:   "📱",
    computacion: "💻",
    accesorios:  "🎧",
    importados:  "🌍",
    servicio:    "🔧",
    otros:       "📦",
  };

  const catLines = Object.entries(byCategory)
    .map(([cat, data]) => {
      const icon = CATEGORY_ICONS[cat] || "📦";
      return `${icon} *${cat.charAt(0).toUpperCase() + cat.slice(1)}* — ${data.inStock} disponibles`;
    })
    .join("\n");

  return (
    `🏪 *Catálogo OlaPhone Olavarría*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    catLines + "\n\n" +
    `🌐 Ver todo el catálogo con fotos y precios:\n` +
    `👉 *olaphone.com.ar*\n\n` +
    `💬 O escribime el nombre de lo que buscás y te busco el precio.`
  );
}

module.exports = { buildProductResponse, buildCatalogMenu, searchProducts };
