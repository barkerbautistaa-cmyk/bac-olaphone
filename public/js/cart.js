/**
 * =============================================================================
 * OLAPHONE — MÓDULO: CARRITO DE COMPRAS
 * =============================================================================
 * Clase Cart con lógica completa: agregar/quitar ítems, persistencia en
 * localStorage, renderizado en el drawer lateral, validación de stock,
 * y emisión de CustomEvents para comunicación entre módulos.
 * =============================================================================
 */

(function () {
  "use strict";

  const STORAGE_KEY = "olaphone_cart_v1";

  class Cart {
    constructor() {
      this._items = this._loadFromStorage();
      this._isDrawerOpen = false;
    }

    // ── Inicialización diferida (espera al DOM) ──────────────────────────
    init() {
      this._bindDrawerControls();
      this._renderCart();
      this._updateBadge();
    }

    // ── GETTERS ─────────────────────────────────────────────────────────
    get items()         { return [...this._items]; }
    get totalUnidades() { return this._items.reduce((a, i) => a + i.cantidad, 0); }
    get total()         { return this._items.reduce((a, i) => a + i.precio * i.cantidad, 0); }
    get isEmpty()       { return this._items.length === 0; }

    // ── OPERACIONES ─────────────────────────────────────────────────────
    addItem(producto) {
      if (producto.stock <= 0) {
        return { success: false, message: `Sin stock disponible para "${producto.nombre}".` };
      }

      const idx = this._items.findIndex((i) => i.id === producto.id);

      if (idx >= 0) {
        const item = this._items[idx];
        if (item.cantidad >= producto.stock) {
          return { success: false, message: `Máximo stock alcanzado (${producto.stock} unid.).` };
        }
        this._items[idx] = { ...item, cantidad: item.cantidad + 1, stockMax: producto.stock };
      } else {
        this._items.push({
          id:       producto.id,
          nombre:   producto.nombre,
          precio:   producto.precio,
          cantidad: 1,
          stockMax: producto.stock,
        });
      }

      this._persist();
      this._renderCart();
      this._updateBadge();
      this._emitChange("add", producto);
      return { success: true };
    }

    removeItem(id) {
      this._items = this._items.filter((i) => i.id !== id);
      this._persist();
      this._renderCart();
      this._updateBadge();
      this._emitChange("remove", { id });
    }

    updateQuantity(id, newQty) {
      if (newQty <= 0) { this.removeItem(id); return { success: true }; }
      const idx = this._items.findIndex((i) => i.id === id);
      if (idx < 0) return { success: false, message: "Producto no encontrado." };
      if (newQty > this._items[idx].stockMax) {
        return { success: false, message: `Stock máximo: ${this._items[idx].stockMax}` };
      }
      this._items[idx] = { ...this._items[idx], cantidad: newQty };
      this._persist();
      this._renderCart();
      this._updateBadge();
      this._emitChange("update", this._items[idx]);
      return { success: true };
    }

    clear() {
      this._items = [];
      this._persist();
      this._renderCart();
      this._updateBadge();
      this._emitChange("clear", null);
    }

    // ── DRAWER ──────────────────────────────────────────────────────────
    openDrawer() {
      const drawer  = document.getElementById("cart-drawer");
      const overlay = document.getElementById("cart-overlay");
      const toggle  = document.getElementById("btn-cart-toggle");
      if (!drawer || !overlay) return;
      drawer.classList.add("open");
      drawer.removeAttribute("aria-hidden");
      overlay.classList.add("active");
      overlay.removeAttribute("aria-hidden");
      this._isDrawerOpen = true;
      document.body.style.overflow = "hidden";
      toggle?.setAttribute("aria-expanded", "true");
      // Focus en el primer input del drawer
      setTimeout(() => drawer.querySelector("input, button")?.focus(), 350);
    }

    closeDrawer() {
      const drawer  = document.getElementById("cart-drawer");
      const overlay = document.getElementById("cart-overlay");
      const toggle  = document.getElementById("btn-cart-toggle");
      if (!drawer || !overlay) return;
      drawer.classList.remove("open");
      drawer.setAttribute("aria-hidden", "true");
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
      this._isDrawerOpen = false;
      document.body.style.overflow = "";
      toggle?.setAttribute("aria-expanded", "false");
    }

    _bindDrawerControls() {
      document.getElementById("btn-cart-toggle")?.addEventListener("click", () => this.openDrawer());
      document.getElementById("btn-cart-close")?.addEventListener("click",  () => this.closeDrawer());
      document.getElementById("cart-overlay")?.addEventListener("click",    () => this.closeDrawer());

      // Cerrar con Escape
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && this._isDrawerOpen) this.closeDrawer();
      });

      // Links del carrito en navbar
      document.getElementById("nav-carrito")?.addEventListener("click", (e) => {
        e.preventDefault(); this.openDrawer();
      });
    }

    // ── RENDERIZADO ─────────────────────────────────────────────────────
    _renderCart() {
      const container = document.getElementById("cart-items");
      const emptyDiv  = document.getElementById("cart-empty");
      const footer    = document.getElementById("cart-footer");
      const totalEl   = document.getElementById("cart-total");
      const subtotalEl = document.getElementById("cart-subtotal");

      if (!container) return;

      // Limpiar filas anteriores (preservar el empty state)
      container.querySelectorAll("[data-cart-row]").forEach((r) => r.remove());

      if (this.isEmpty) {
        if (emptyDiv) emptyDiv.style.display = "";
        if (footer)   footer.hidden = true;
      } else {
        if (emptyDiv) emptyDiv.style.display = "none";
        if (footer)   footer.hidden = false;

        this._items.forEach((item) => {
          const row = this._buildRow(item);
          container.appendChild(row);
        });
      }

      const formatted = this._fmt(this.total);
      if (totalEl)    totalEl.textContent    = formatted;
      if (subtotalEl) subtotalEl.textContent = formatted;
    }

    _buildRow(item) {
      const row = document.createElement("div");
      row.setAttribute("data-cart-row", item.id);
      row.setAttribute("role", "listitem");
      row.className = "cart-row";

      row.innerHTML = `
        <div class="cart-row-info">
          <p class="cart-row-name">${this._esc(item.nombre)}</p>
          <p class="cart-row-price">${this._fmt(item.precio)} c/u</p>
          <div class="cart-row-controls" role="group" aria-label="Cantidad de ${this._esc(item.nombre)}">
            <button
              class="cart-qty-btn"
              data-action="decrease"
              data-id="${item.id}"
              aria-label="Disminuir"
              type="button"
            >−</button>
            <span class="cart-qty-display" aria-label="Cantidad: ${item.cantidad}">${item.cantidad}</span>
            <button
              class="cart-qty-btn"
              data-action="increase"
              data-id="${item.id}"
              aria-label="Aumentar"
              type="button"
              ${item.cantidad >= item.stockMax ? "disabled" : ""}
            >+</button>
          </div>
        </div>
        <div class="cart-row-right">
          <p class="cart-row-subtotal">${this._fmt(item.precio * item.cantidad)}</p>
          <button
            class="cart-row-remove"
            data-action="remove"
            data-id="${item.id}"
            aria-label="Eliminar ${this._esc(item.nombre)}"
            type="button"
          >✕</button>
        </div>
      `;

      row.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-action][data-id]");
        if (!btn) return;
        const { action, id } = btn.dataset;
        const cartItem = this._items.find((i) => i.id === id);
        if (!cartItem) return;

        if (action === "decrease") this.updateQuantity(id, cartItem.cantidad - 1);
        else if (action === "increase") {
          const res = this.updateQuantity(id, cartItem.cantidad + 1);
          if (!res.success) {
            btn.disabled = true;
            setTimeout(() => { btn.disabled = false; }, 1500);
          }
        } else if (action === "remove") this.removeItem(id);
      });

      return row;
    }

    // ── BADGE ───────────────────────────────────────────────────────────
    _updateBadge() {
      const badge = document.getElementById("cart-badge");
      if (!badge) return;
      const n = this.totalUnidades;
      badge.textContent = n;
      badge.setAttribute("aria-label", `${n} ítems en el carrito`);
      badge.classList.toggle("has-items", n > 0);
    }

    // ── EVENTS ──────────────────────────────────────────────────────────
    _emitChange(action, payload) {
      document.dispatchEvent(new CustomEvent("cart:changed", {
        detail: { action, payload, items: this.items, total: this.total },
        bubbles: true,
      }));
    }

    // ── STORAGE ─────────────────────────────────────────────────────────
    _persist() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this._items)); } catch {}
    }

    _loadFromStorage() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch { return []; }
    }

    // ── UTILS ────────────────────────────────────────────────────────────
    _fmt(n) {
      return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);
    }

    _esc(str) {
      const d = document.createElement("div");
      d.appendChild(document.createTextNode(String(str)));
      return d.innerHTML;
    }
  }

  // Singleton global
  window.Cart = new Cart();
  document.addEventListener("DOMContentLoaded", () => window.Cart.init());

})();
