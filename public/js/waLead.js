/**
 * =============================================================================
 * OLAPHONE — POPUP DE CAPTURA DE LEAD (WhatsApp)
 * =============================================================================
 * Lógica del popup que aparece al hacer click en el botón flotante de WhatsApp.
 * - Muestra el formulario de nombre + teléfono
 * - Envía el lead al backend (silenciosamente, sin bloquear al usuario)
 * - Redirige a WhatsApp con el nombre pre-cargado en el mensaje
 * =============================================================================
 */

(function initWaLeadPopup() {
  "use strict";

  // ── ELEMENTOS ───────────────────────────────────────────────────────────────
  const floatBtn   = document.getElementById("btn-wa-float");
  const overlay    = document.getElementById("wa-lead-overlay");
  const closeBtn   = document.getElementById("btn-wa-lead-close");
  const form       = document.getElementById("wa-lead-form");
  const nameInput  = document.getElementById("lead-name");
  const phoneInput = document.getElementById("lead-phone");
  const submitBtn  = document.getElementById("btn-wa-lead-submit");

  if (!floatBtn || !overlay || !form) return;

  const OWNER_PHONE       = window.OWNER_PHONE      || "542284641652";
  const LEAD_CAPTURE_URL  = window.LEAD_CAPTURE_URL || "/api/lead/capture";

  // ── ABRIR / CERRAR POPUP ────────────────────────────────────────────────────
  function openPopup() {
    overlay.hidden = false;
    // Pequeño delay para que la transición CSS funcione
    requestAnimationFrame(() => {
      overlay.classList.add("is-visible");
      nameInput && nameInput.focus();
    });
    document.body.style.overflow = "hidden";
  }

  function closePopup() {
    overlay.classList.remove("is-visible");
    // Esperar a que termine la animación antes de ocultar
    overlay.addEventListener("transitionend", function handler() {
      overlay.hidden = true;
      overlay.removeEventListener("transitionend", handler);
    }, { once: true });
    document.body.style.overflow = "";
  }

  floatBtn.addEventListener("click", openPopup);
  closeBtn.addEventListener("click", closePopup);

  // Cerrar al hacer click fuera del popup
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePopup();
  });

  // Cerrar con Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) closePopup();
  });

  // ── ENVÍO DEL FORMULARIO ────────────────────────────────────────────────────
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name  = (nameInput.value  || "").trim();
    const phone = (phoneInput.value || "").trim().replace(/\D/g, "");

    // Validación mínima
    if (!name) {
      nameInput.focus();
      nameInput.classList.add("wa-lead-input--error");
      return;
    }
    if (!phone || phone.length < 6) {
      phoneInput.focus();
      phoneInput.classList.add("wa-lead-input--error");
      return;
    }

    nameInput.classList.remove("wa-lead-input--error");
    phoneInput.classList.remove("wa-lead-input--error");

    // Estado de carga
    submitBtn.disabled = true;
    submitBtn.textContent = "Abriendo WhatsApp…";

    // Formatear número argentino → E.164
    // Si empieza con 0 → quitar el 0. Siempre agregar prefijo 54.
    const cleanPhone = phone.replace(/^0+/, "");
    const e164Phone  = "54" + cleanPhone;

    // Guardar el lead en el backend (silencioso, sin bloquear)
    _captureLead(name, e164Phone).catch(() => {/* silencioso */});

    // Armar el mensaje de WhatsApp pre-cargado con el nombre
    const waText = encodeURIComponent(
      `¡Hola OlaPhone! Soy ${name} y quisiera hacer una consulta. 😊`
    );
    const waUrl = `https://wa.me/${OWNER_PHONE}?text=${waText}`;

    // Pequeño delay visual antes de abrir WhatsApp (da tiempo al fetch)
    await new Promise((r) => setTimeout(r, 500));

    window.open(waUrl, "_blank", "noopener,noreferrer");
    closePopup();

    // Resetear el formulario
    setTimeout(() => {
      form.reset();
      submitBtn.disabled = false;
      submitBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
        </svg>
        Ir a WhatsApp
      `;
    }, 2000);
  });

  // Quitar clase error al escribir
  [nameInput, phoneInput].forEach((el) => {
    if (el) el.addEventListener("input", () => el.classList.remove("wa-lead-input--error"));
  });

  // ── ENVÍO AL BACKEND ─────────────────────────────────────────────────────────
  async function _captureLead(nombre, telefono) {
    const payload = {
      nombre,
      telefono,
      origen:    "wa_float_button",
      timestamp: new Date().toISOString(),
      pagina:    window.location.href,
    };

    const res = await fetch(LEAD_CAPTURE_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

})();
