/**
 * =============================================================================
 * OLAPHONE — MÓDULO: CHECKOUT
 * =============================================================================
 * Maneja el proceso de finalización de compra desde el drawer lateral:
 *  1. Valida el formulario de datos del cliente
 *  2. Dispara en PARALELO: POST al backend + window.open wa.me (fallback)
 *  3. Maneja respuestas: éxito, stock insuficiente (409), timeout, error de red
 * =============================================================================
 */

(function () {
  "use strict";

  // ── CONFIGURACIÓN ────────────────────────────────────────────────────────
  const CART_WEBHOOK_URL = window.CART_WEBHOOK_URL || "/api/webhook/cart";
  const WEBHOOK_SECRET   = window.WEBHOOK_SECRET   || "";
  const OWNER_PHONE      = window.OWNER_PHONE      || "542284641652";

  // ── UTILIDADES ───────────────────────────────────────────────────────────
  function fmt(n) {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);
  }

  function esc(str) {
    const d = document.createElement("div");
    d.appendChild(document.createTextNode(String(str)));
    return d.innerHTML;
  }

  function generateOrderId() {
    return `OLA-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
  }

  /**
   * Normaliza el teléfono al formato E.164 para Argentina (sin +).
   * Acepta: "1112345678", "01112345678", "2284641652", etc.
   * Devuelve: "549XXXXXXXXXX"
   */
  function normalizeTelefono(raw) {
    const digits = raw.replace(/\D/g, "");
    if (digits.startsWith("549"))  return digits;
    if (digits.startsWith("54"))   return "549" + digits.slice(2);
    if (digits.startsWith("0"))    return "549" + digits.slice(1);
    return "549" + digits;
  }

  // ── ESTADOS DE LA UI ─────────────────────────────────────────────────────
  function setStatus(html, type) {
    const el = document.getElementById("checkout-status");
    if (!el) return;
    el.innerHTML     = html;
    el.dataset.type  = type || "";
    el.style.display = html ? "" : "none";
  }

  function showFormErrors(errors) {
    const el = document.getElementById("form-errors");
    if (!el) return;
    if (!errors || errors.length === 0) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    el.hidden = false;
    el.innerHTML = `<ul style="margin:0;padding-left:1.2rem">
      ${errors.map((e) => `<li>${esc(e)}</li>`).join("")}
    </ul>`;
  }

  function setButtonState(loading) {
    const btn = document.getElementById("btn-checkout");
    if (!btn) return;
    btn.disabled = loading;
    btn.innerHTML = loading
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" aria-hidden="true" style="animation:spin 1s linear infinite">
           <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
         </svg>
         Procesando...`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18" aria-hidden="true">
           <polyline points="20 6 9 17 4 12"/>
         </svg>
         Finalizar Compra`;
  }

  // ── VALIDACIÓN DEL FORMULARIO ────────────────────────────────────────────
  function validateForm() {
    const nombre    = document.getElementById("cliente-nombre")?.value.trim()   || "";
    const telefono  = document.getElementById("cliente-telefono")?.value.trim() || "";
    const notas     = document.getElementById("cliente-notas")?.value.trim()    || "";
    const errors    = [];

    if (!nombre || nombre.length < 2)
      errors.push("El nombre es obligatorio (mínimo 2 caracteres).");

    if (!telefono)
      errors.push("El número de WhatsApp es obligatorio.");
    else if (!/^\d{6,15}$/.test(telefono.replace(/\s/g, "")))
      errors.push("El teléfono debe tener entre 6 y 15 dígitos. Ej: 2284641652");

    if (!window.Cart || window.Cart.isEmpty)
      errors.push("Tu carrito está vacío. Agregá productos antes de finalizar.");

    return { valid: errors.length === 0, errors, data: { nombre, telefono, notas } };
  }

  // ── CONSTRUCCIÓN DEL PAYLOAD ─────────────────────────────────────────────
  function buildPayload(cliente, orderId) {
    return {
      id_pedido: orderId,
      cliente: {
        nombre:   cliente.nombre,
        telefono: normalizeTelefono(cliente.telefono),
      },
      productos: window.Cart.items.map((i) => ({
        id:              i.id,
        nombre:          i.nombre,
        cantidad:        i.cantidad,
        precio_unitario: i.precio,
      })),
      total: window.Cart.total,
      notas: cliente.notas,
    };
  }

  // ── FALLBACK WHATSAPP WEB ────────────────────────────────────────────────
  function buildWhatsAppText(payload) {
    const lineas = payload.productos
      .map((p) => `▸ ${p.nombre} × ${p.cantidad} = ${fmt(p.precio_unitario * p.cantidad)}`)
      .join("\n");

    return encodeURIComponent(
      `🛒 *NUEVO PEDIDO — OlaPhone*\n` +
      `N° *${payload.id_pedido}*\n\n` +
      `👤 *Cliente:* ${payload.cliente.nombre}\n` +
      `📞 *Tel:* +${payload.cliente.telefono}\n\n` +
      `📦 *Detalle:*\n${lineas}\n\n` +
      `💰 *TOTAL: ${fmt(payload.total)}*\n` +
      `${payload.notas ? `📝 Notas: ${payload.notas}\n` : ""}` +
      `\n_Pedido enviado desde olaphone.com.ar_`
    );
  }

  function openWhatsAppFallback(payload) {
    const text = buildWhatsAppText(payload);
    const url  = `https://wa.me/${OWNER_PHONE}?text=${text}`;
    const win  = window.open(url, "_blank", "noopener,noreferrer");

    if (!win) {
      // Popup bloqueado: mostrar link manual
      setStatus(
        `✅ Pedido registrado. <a href="${url}" target="_blank" rel="noopener noreferrer"
          style="color:var(--accent-light);text-decoration:underline">
          Tocá aquí para confirmar por WhatsApp
        </a>`,
        "warn"
      );
    }
  }

  // ── LLAMADA AL BACKEND ───────────────────────────────────────────────────
  async function sendToBackend(payload) {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 9000);

    try {
      const headers = { "Content-Type": "application/json" };
      if (WEBHOOK_SECRET) headers["X-Webhook-Secret"] = WEBHOOK_SECRET;

      const res = await fetch(CART_WEBHOOK_URL, {
        method:  "POST",
        headers,
        body:    JSON.stringify(payload),
        signal:  controller.signal,
      });

      clearTimeout(timeout);
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };

    } catch (err) {
      clearTimeout(timeout);
      return {
        ok:     false,
        status: 0,
        data:   { error: err.name === "AbortError" ? "timeout" : err.message },
      };
    }
  }

  // ── HANDLER DEL SUBMIT ───────────────────────────────────────────────────
  async function handleCheckout(e) {
    e.preventDefault();
    showFormErrors([]);
    setStatus("");

    const { valid, errors, data: cliente } = validateForm();
    if (!valid) {
      showFormErrors(errors);
      document.getElementById("form-errors")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }

    const orderId = generateOrderId();
    const payload = buildPayload(cliente, orderId);

    console.log(`[Checkout] Iniciando pedido ${orderId}`);
    setButtonState(true);
    setStatus("Enviando tu pedido...", "");

    // DISPARO PARALELO: backend API + fallback WhatsApp
    const [backendResult] = await Promise.allSettled([
      sendToBackend(payload),
      Promise.resolve(openWhatsAppFallback(payload)), // síncrono para evitar bloqueo popup
    ]);

    const backend = backendResult.status === "fulfilled"
      ? backendResult.value
      : { ok: false, status: 0, data: {} };

    // Evaluar resultado
    if (backend.ok) {
      // ✅ Éxito completo
      console.log(`[Checkout] ✓ Backend OK — ${orderId}`);
      setStatus(
        `✅ <strong>¡Pedido enviado!</strong><br>
         Ref: <code style="font-size:0.8em">${orderId}</code><br>
         Confirmación y datos de pago por WhatsApp en instantes.`,
        "success"
      );
      window.Cart.clear();
      document.getElementById("checkout-form")?.reset();

    } else if (backend.status === 409) {
      // ⚠️ Stock insuficiente (server-side)
      const stockErrors = backend.data?.stock_errors || ["Stock insuficiente en uno o más productos."];
      showFormErrors(stockErrors);
      setStatus(
        `⚠️ El stock cambió. Ajustá las cantidades y volvé a intentar.`,
        "warn"
      );

    } else {
      // ⚡ Backend no disponible — fallback WhatsApp ya actuó
      console.warn(`[Checkout] Backend no disponible (${backend.status || "timeout"}) — fallback WA activo`);
      setStatus(
        `⚡ <strong>Pedido enviado por WhatsApp</strong> (nuestro sistema está tardando).<br>
         Ref: <code style="font-size:0.8em">${orderId}</code><br>
         Nos comunicamos a la brevedad. ¡Gracias!`,
        "warn"
      );
      window.Cart.clear();
      document.getElementById("checkout-form")?.reset();
    }

    setButtonState(false);
  }

  // ── INICIALIZACIÓN ───────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("checkout-form");
    if (form) {
      form.addEventListener("submit", handleCheckout);
      console.log("[Checkout] Módulo inicializado.");
    }
  });

})();
