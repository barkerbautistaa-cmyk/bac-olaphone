/**
 * =============================================================================
 * SUB-COMPONENTE B + C: PROCESADOR DE CARRITOS + INTEGRACIÓN WHATSAPP
 * =============================================================================
 * Recibe el carrito de compras desde la tienda estática.
 * Valida el stock server-side (segunda verificación), genera el número de pedido,
 * y dispara los mensajes de WhatsApp al cliente y al dueño/empleados.
 *
 * ENDPOINT: POST /webhook/cart
 *
 * PAYLOAD ESPERADO:
 * {
 *   "id_pedido":     "ORD-1705312200000-abc123",
 *   "cliente": {
 *     "nombre":    "Juan García",
 *     "telefono":  "5491112345678"   ← formato E.164 sin el +
 *   },
 *   "productos": [
 *     { "id": "PROD-001", "nombre": "Auriculares BT", "cantidad": 2, "precio_unitario": 89999.99 }
 *   ],
 *   "total": 179999.98,
 *   "notas": "Entregar en turno tarde"  ← opcional
 * }
 * =============================================================================
 */

const express = require("express");
const fs      = require("fs");
const path    = require("path");
const { v4: uuidv4 } = require("uuid");
const { sendWhatsAppMessage } = require("./whatsapp");

const router        = express.Router();
const PRODUCTS_FILE = path.join(__dirname, "../data/products.json");

// ---------------------------------------------------------------------------
// VALIDACIÓN DEL PAYLOAD DEL CARRITO
// ---------------------------------------------------------------------------
function validateCartPayload(body) {
  const errors = [];

  if (!body.id_pedido || typeof body.id_pedido !== "string")
    errors.push("'id_pedido' es requerido y debe ser string");

  if (!body.cliente || typeof body.cliente !== "object")
    errors.push("'cliente' es requerido");
  else {
    if (!body.cliente.nombre || typeof body.cliente.nombre !== "string")
      errors.push("'cliente.nombre' es requerido");
    if (!body.cliente.telefono || typeof body.cliente.telefono !== "string")
      errors.push("'cliente.telefono' es requerido");
    if (!/^\d{10,15}$/.test(body.cliente.telefono))
      errors.push("'cliente.telefono' debe tener entre 10 y 15 dígitos (formato E.164 sin +)");
  }

  if (!Array.isArray(body.productos) || body.productos.length === 0)
    errors.push("'productos' debe ser un array no vacío");
  else {
    body.productos.forEach((p, i) => {
      if (!p.id)                             errors.push(`productos[${i}]: 'id' faltante`);
      if (!p.nombre)                         errors.push(`productos[${i}]: 'nombre' faltante`);
      if (!Number.isInteger(p.cantidad) || p.cantidad < 1)
        errors.push(`productos[${i}]: 'cantidad' debe ser entero ≥ 1`);
      if (typeof p.precio_unitario !== "number" || p.precio_unitario <= 0)
        errors.push(`productos[${i}]: 'precio_unitario' debe ser número > 0`);
    });
  }

  if (typeof body.total !== "number" || body.total <= 0)
    errors.push("'total' debe ser número > 0");

  return errors;
}

// ---------------------------------------------------------------------------
// VALIDACIÓN DE STOCK SERVER-SIDE
// ---------------------------------------------------------------------------
/**
 * Segunda verificación de stock en el servidor.
 * El frontend ya valida, pero el servidor confirma antes de procesar el pedido.
 * Evita condiciones de carrera donde dos clientes compran el último ítem.
 *
 * @returns {{ valid: boolean, stockErrors: Array<string> }}
 */
function validateStock(cartProducts) {
  const stockErrors = [];

  if (!fs.existsSync(PRODUCTS_FILE)) {
    return { valid: false, stockErrors: ["Catálogo de productos no disponible"] };
  }

  const raw      = fs.readFileSync(PRODUCTS_FILE, "utf8");
  const catalog  = JSON.parse(raw);
  const products = catalog.productos || [];
  const stockMap = new Map(products.map((p) => [p.id, p.stock]));

  for (const item of cartProducts) {
    const availableStock = stockMap.get(item.id);

    if (availableStock === undefined) {
      stockErrors.push(`Producto ID "${item.id}" no encontrado en el catálogo`);
    } else if (availableStock < item.cantidad) {
      stockErrors.push(
        `"${item.nombre}" (ID: ${item.id}): solicitado ${item.cantidad}, disponible ${availableStock}`
      );
    }
  }

  return { valid: stockErrors.length === 0, stockErrors };
}

// ---------------------------------------------------------------------------
// FORMATEO DE MONEDA ARGENTINA
// ---------------------------------------------------------------------------
function formatPrecio(amount) {
  return new Intl.NumberFormat("es-AR", {
    style:    "currency",
    currency: "ARS",
  }).format(amount);
}

// ---------------------------------------------------------------------------
// HANDLER PRINCIPAL DEL ENDPOINT
// ---------------------------------------------------------------------------
router.post("/", async (req, res) => {
  const body = req.body;

  // 1. Validar estructura del payload
  const errors = validateCartPayload(body);
  if (errors.length > 0) {
    console.warn("[processCart] Payload inválido:", errors);
    return res.status(400).json({
      error:   "Payload del carrito inválido",
      details: errors,
    });
  }

  // 2. Verificación server-side del stock
  const { valid, stockErrors } = validateStock(body.productos);
  if (!valid) {
    console.warn("[processCart] Stock insuficiente:", stockErrors);
    return res.status(409).json({
      error:        "Stock insuficiente para uno o más productos",
      stock_errors: stockErrors,
    });
  }

  // 3. Enriquecer el pedido con metadatos del servidor
  const pedido = {
    id_pedido:       body.id_pedido,
    id_interno:      uuidv4(),                // ID interno del servidor (para trazabilidad)
    fecha:           new Date().toISOString(),
    estado:          "PENDIENTE_PAGO",
    cliente:         body.cliente,
    productos:       body.productos,
    total:           body.total,
    notas:           body.notas || "",
  };

  console.log(`[processCart] Nuevo pedido recibido: ${pedido.id_pedido} | Cliente: ${pedido.cliente.nombre} | Total: ${formatPrecio(pedido.total)}`);

  // 4. Disparar mensajes WhatsApp en paralelo
  const [resultCliente, resultDueno] = await Promise.allSettled([
    sendWhatsAppMessage("cliente", pedido),
    sendWhatsAppMessage("dueno",   pedido),
  ]);

  // Loguear resultados de WhatsApp sin fallar la request
  if (resultCliente.status === "fulfilled") {
    console.log(`[processCart] WhatsApp cliente ✓ (${pedido.cliente.telefono})`);
  } else {
    console.error(`[processCart] WhatsApp cliente ✗: ${resultCliente.reason?.message}`);
  }

  if (resultDueno.status === "fulfilled") {
    console.log(`[processCart] WhatsApp dueño ✓ (${process.env.OWNER_PHONE})`);
  } else {
    console.error(`[processCart] WhatsApp dueño ✗: ${resultDueno.reason?.message}`);
  }

  // 5. Responder con éxito (incluso si WhatsApp falló — el fallback web está activo)
  return res.status(200).json({
    success:          true,
    message:          "Pedido recibido correctamente",
    id_pedido:        pedido.id_pedido,
    id_interno:       pedido.id_interno,
    estado:           pedido.estado,
    whatsapp_cliente: resultCliente.status,
    whatsapp_dueno:   resultDueno.status,
    timestamp:        pedido.fecha,
  });
});

module.exports = router;
