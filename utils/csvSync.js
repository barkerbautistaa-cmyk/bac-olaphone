const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
require('dotenv').config();

const PRODUCTS_FILE = path.join(__dirname, '..', 'data', 'products.json');

// Lee el CSV público de Google Sheets, lo parsea y actualiza products.json
async function syncFromGoogleSheets() {
  const csvUrl = process.env.GOOGLE_SHEETS_CSV_URL;
  if (!csvUrl) {
    console.log('[CSV Sync] GOOGLE_SHEETS_CSV_URL no configurado. Sincronización omitida.');
    return;
  }

  try {
    console.log(`[CSV Sync] Descargando CSV desde Google Drive...`);
    const response = await axios.get(csvUrl);
    const csvData = response.data;

    // Parsear el CSV
    parse(csvData, {
      columns: true, // Usa la primera fila como headers
      skip_empty_lines: true,
      trim: true
    }, (err, records) => {
      if (err) {
        console.error('[CSV Sync] Error al parsear el CSV:', err);
        return;
      }

      const count = records.length;
      if (count === 0) {
        console.log('[CSV Sync] El archivo CSV está vacío.');
        return;
      }

      // Convertir valores de texto a números donde corresponda
      const productosTransformados = records.map(r => ({
        id: r.id || r.ID || r.Id || '',
        nombre: r.nombre || r.Nombre || '',
        stock: parseInt(r.stock || r.Stock || '0', 10),
        precio: parseInt(r.precio || r.Precio || '0', 10),
        imagen: r.imagen || r.Imagen || null,
        descripcion: r.descripcion || r.Descripcion || r.Descripción || '',
        categoria: (r.categoria || r.Categoria || r.Categoría || 'general').toLowerCase(),
        updatedAt: new Date().toISOString()
      })).filter(p => p.id && p.nombre); // Filtrar filas inválidas

      // Guardar el JSON
      const jsonOutput = {
        updatedAt: new Date().toISOString(),
        count: productosTransformados.length,
        productos: productosTransformados
      };

      fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(jsonOutput, null, 2), 'utf8');
      console.log(`[CSV Sync] ✅ Catálogo actualizado con ${productosTransformados.length} productos.`);

      // Disparar build de Netlify si está configurado
      triggerNetlifyBuild();
    });

  } catch (error) {
    console.error('[CSV Sync] ❌ Error descargando el CSV:', error.message);
  }
}

async function triggerNetlifyBuild() {
  const hookUrl = process.env.NETLIFY_BUILD_HOOK;
  if (!hookUrl) return;

  try {
    console.log('[CSV Sync] Disparando Netlify Build Hook...');
    await axios.post(hookUrl, {});
    console.log('[CSV Sync] ✅ Build de Netlify disparado con éxito.');
  } catch (err) {
    console.error('[CSV Sync] ❌ Error al disparar Netlify:', err.message);
  }
}

// Inicia el cron job que corre cada N milisegundos (default 5 minutos)
function startCsvSyncCron() {
  // Ejecuta una vez al inicio
  syncFromGoogleSheets();

  // Ejecuta cada 5 minutos (300,000 ms)
  const intervalMs = parseInt(process.env.CSV_SYNC_INTERVAL_MS || '300000', 10);
  setInterval(syncFromGoogleSheets, intervalMs);
  console.log(`[CSV Sync] Cron iniciado (intervalo: ${intervalMs / 1000}s).`);
}

module.exports = { syncFromGoogleSheets, startCsvSyncCron };
