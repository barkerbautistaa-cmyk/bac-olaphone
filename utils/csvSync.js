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
      trim: true,
      relax_quotes: true,
      relax_column_count: true
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

      // Diccionario de imágenes por defecto
      const fallbackImages = {
        'SAMSUNG-S26-ULTRA': 'https://i.imgur.com/j10j8v4.jpeg',
        'IPHONE-17-PRO-MAX': 'https://i.imgur.com/e2q0b9r.jpeg',
        'REDMI-NOTE-15-PRO': 'https://techtablets.com/wp-content/uploads/2024/01/Redmi-Note-13-Pro-Plus-5G-1.jpg',
        'POCOPHONE-F8-ULTRA': 'https://www.movilzona.es/app/uploads-movilzona.es/2023/05/POCO-F5-Pro.jpg',
        'PS5-SLIM-STD': 'https://i.blogs.es/49b990/ps5-slim-2/1366_2000.jpeg',
        'AIRPODS-PRO-2': 'https://i.imgur.com/z8p2l0q.jpeg, https://i.imgur.com/k9m3n8x.jpeg',
        'SAMSUNG-BUD2-PRO': 'https://images.samsung.com/is/image/samsung/p6pim/ar/sm-r510nzaaaro/gallery/ar-galaxy-buds2-pro-r510-sm-r510nzaaaro-533192275?$650_519_PNG$',
        'SMARTWATCH-APPLE-S9': 'https://store.storeimages.cdn-apple.com/4668/as-images.apple.com/is/watch-s9-alum-midnight-nc-9s_VW_34FR+watch-45-alum-midnight-nc-9s_VW_34FR_WF_CO_GEO_ES?wid=750&hei=712&trim=1%2C0&fmt=p-jpg&qlt=95&.v=1693291585863',
        'ZAPATILLAS-NIKE-AIR1': 'https://static.nike.com/a/images/t_PDP_1280_v1/f_auto,q_auto:eco/b7d9211c-26e7-431a-ac24-b0540fb3c00f/calzado-air-jordan-1-mid-sqH7M6.png'
      };

      // Convertir valores de texto a números donde corresponda
      const productosTransformados = records.map(r => {
        const id = r.id || r.ID || r.Id || '';
        let img = r.imagen || r.Imagen || null;
        if (!img || img.trim() === '') {
          img = fallbackImages[id] || null;
        }

        return {
          id: id,
          nombre: r.nombre || r.Nombre || '',
          stock: parseInt(r.stock || r.Stock || '0', 10),
          precio: parseInt(r.precio || r.Precio || '0', 10),
          imagen: img,
          descripcion: r.descripcion || r.Descripcion || r.Descripción || '',
          categoria: (r.categoria || r.Categoria || r.Categoría || 'general').toLowerCase(),
          updatedAt: new Date().toISOString()
        };
      }).filter(p => p.id && p.nombre); // Filtrar filas inválidas

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
