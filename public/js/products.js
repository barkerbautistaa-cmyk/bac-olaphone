/**
 * =============================================================================
 * OLAPHONE — MÓDULO: CARGA Y RENDERIZADO DE PRODUCTOS
 * =============================================================================
 * Fetcha products.json del backend, renderiza las cards de productos,
 * maneja estados de carga (skeletons), error y re-render reactivo
 * cuando el carrito cambia (actualiza botones y cantidades).
 * =============================================================================
 */

(function () {
  "use strict";

  // ── CONFIG ───────────────────────────────────────────────────────────────
  const PRODUCTS_URL = window.PRODUCTS_URL || "./products.json";
  const CACHE_BUST   = `?t=${Math.floor(Date.now() / 60000)}`;

  // ── ESTADO ───────────────────────────────────────────────────────────────
  let catalog = [];

  // ── UTILIDADES ───────────────────────────────────────────────────────────
  function fmt(n) {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);
  }

  function esc(str) {
    if (!str) return "";
    const d = document.createElement("div");
    d.appendChild(document.createTextNode(String(str)));
    return d.innerHTML;
  }

  function getCartQty(id) {
    if (!window.Cart) return 0;
    const item = window.Cart.items.find((i) => i.id === id);
    return item ? item.cantidad : 0;
  }

  function getStockBadge(stock) {
    if (stock <= 0)  return { cls: "badge-outofstock", label: "Sin stock" };
    if (stock <= 3)  return { cls: "badge-lowstock",   label: `¡Últimas ${stock}!` };
    return            { cls: "badge-instock",   label: "En stock" };
  }

  // ── CONSTRUCCIÓN DE CARD ─────────────────────────────────────────────────
  function buildProductCard(p) {
    const { id, nombre, stock, precio, imagen, descripcion } = p;
    const sinStock     = stock <= 0;
    const enCarrito    = getCartQty(id);
    const maxPermitido = sinStock ? 0 : Math.max(0, stock - enCarrito);
    const stockAgotado = maxPermitido === 0 && !sinStock;
    const badge        = getStockBadge(stock);

    // Texto dinámico del botón
    let btnText = "🛒 Agregar al carrito";
    let btnDisabled = false;
    if (sinStock) {
      btnText = "Sin stock";
      btnDisabled = true;
    } else if (stockAgotado) {
      btnText = "Máximo en carrito";
      btnDisabled = true;
    }

    // Procesar imágenes (soporta separadas por coma desde Drive)
    let images = [];
    if (imagen) {
      images = imagen.split(",").map(i => i.trim()).filter(i => i.length > 0);
    }
    
    // Generar HTML de la galería
    let galleryHTML = `<div class="product-no-img" role="img" aria-label="Sin imagen de ${esc(nombre)}">📦</div>`;
    if (images.length === 1) {
      galleryHTML = `<img src="${esc(images[0])}" alt="${esc(nombre)}" class="product-img" loading="lazy" width="400" height="300" />`;
    } else if (images.length > 1) {
      const slides = images.map((src, idx) => 
        `<img src="${esc(src)}" alt="${esc(nombre)} - Foto ${idx+1}" class="product-img gallery-slide ${idx === 0 ? 'active' : ''}" loading="lazy" data-idx="${idx}" width="400" height="300" />`
      ).join("");
      
      galleryHTML = `
        <div class="product-gallery">
          ${slides}
          <button class="gallery-btn prev" type="button" aria-label="Foto anterior">❮</button>
          <button class="gallery-btn next" type="button" aria-label="Siguiente foto">❯</button>
          <div class="gallery-dots">
            ${images.map((_, idx) => `<span class="dot ${idx === 0 ? 'active' : ''}" data-idx="${idx}"></span>`).join("")}
          </div>
        </div>
      `;
    }

    const card = document.createElement("article");
    card.setAttribute("role", "listitem");
    card.setAttribute("data-product-id", id);
    card.className = `product-card animate-in${sinStock ? " out-of-stock" : ""}`;

    card.innerHTML = `
      <div class="product-img-wrap">
        ${galleryHTML}
        <span class="product-stock-badge ${badge.cls}" aria-label="${badge.label}">
          ${badge.label}
        </span>
      </div>

      <div class="product-info">
        <h3 class="product-name" id="pname-${esc(id)}">${esc(nombre)}</h3>

        ${descripcion
          ? `<p class="product-description">${esc(descripcion)}</p>`
          : ""
        }

        <p class="product-price" aria-label="Precio: ${fmt(precio)}">
          ${fmt(precio)}
        </p>

        ${enCarrito > 0
          ? `<p class="product-in-cart" aria-live="polite">
               ✓ ${enCarrito} en tu carrito
             </p>`
          : ""
        }
      </div>

      <div class="product-card-footer">
        ${!sinStock && !stockAgotado ? `
        <div class="card-qty-control">
          <button type="button" class="btn-qty decrease" aria-label="Disminuir cantidad">─</button>
          <input type="number" class="input-qty" value="1" min="1" max="${maxPermitido}" aria-label="Cantidad a agregar" readonly />
          <button type="button" class="btn-qty increase" aria-label="Aumentar cantidad">┼</button>
        </div>
        ` : ''}
        <button
          id="btn-add-${esc(id)}"
          type="button"
          class="btn-add-to-cart"
          data-product-id="${esc(id)}"
          aria-label="${btnDisabled ? btnText : `Agregar ${esc(nombre)} al carrito`}"
          ${btnDisabled ? "disabled" : ""}
        >
          ${btnText}
        </button>
      </div>
    `;

    // Event listeners para Galería (carrusel en tarjeta)
    if (images.length > 1) {
      let currentIdx = 0;
      const gallerySlides = card.querySelectorAll(".gallery-slide");
      const dots = card.querySelectorAll(".dot");
      const btnPrev = card.querySelector(".gallery-btn.prev");
      const btnNext = card.querySelector(".gallery-btn.next");

      const showSlide = (idx) => {
        gallerySlides.forEach(s => s.classList.remove("active"));
        dots.forEach(d => d.classList.remove("active"));
        gallerySlides[idx].classList.add("active");
        dots[idx].classList.add("active");
      };

      btnPrev.addEventListener("click", (e) => {
        e.stopPropagation();
        currentIdx = currentIdx > 0 ? currentIdx - 1 : gallerySlides.length - 1;
        showSlide(currentIdx);
      });
      btnNext.addEventListener("click", (e) => {
        e.stopPropagation();
        currentIdx = currentIdx < gallerySlides.length - 1 ? currentIdx + 1 : 0;
        showSlide(currentIdx);
      });
    }

    // Abrir lightbox al hacer clic en la imagen
    const imgWrap = card.querySelector(".product-img-wrap");
    if (imgWrap && images.length > 0) {
      imgWrap.style.cursor = "zoom-in";
      imgWrap.addEventListener("click", (e) => {
        if (e.target.classList.contains("gallery-btn")) return;
        openLightbox(images, nombre, descripcion);
      });
    }

    // Event listeners para Cantidad
    const qtyInput = card.querySelector(".input-qty");
    const btnDecrease = card.querySelector(".btn-qty.decrease");
    const btnIncrease = card.querySelector(".btn-qty.increase");

    if (qtyInput && btnDecrease && btnIncrease) {
      btnDecrease.addEventListener("click", () => {
        let val = parseInt(qtyInput.value) || 1;
        if (val > 1) qtyInput.value = val - 1;
      });
      btnIncrease.addEventListener("click", () => {
        let val = parseInt(qtyInput.value) || 1;
        if (val < maxPermitido) qtyInput.value = val + 1;
      });
    }

    // Event listener del botón Agregar
    const btn = card.querySelector(".btn-add-to-cart");
    btn.addEventListener("click", () => {
      if (!window.Cart) return;

      const qtyToAdd = qtyInput ? (parseInt(qtyInput.value) || 1) : 1;
      btn.classList.add("adding");
      
      let lastResult;
      // Agregar N veces (la clase Cart solo permite addItem 1 por 1, o podríamos modificar cart.js)
      // Como cart.js solo tiene addItem(producto) que suma 1, lo llamamos qtyToAdd veces.
      for (let i = 0; i < qtyToAdd; i++) {
        lastResult = window.Cart.addItem({ id, nombre, precio, stock });
        if (!lastResult.success) break;
      }

      if (lastResult && lastResult.success) {
        window.Cart.openDrawer();
      } else if (lastResult) {
        const original = btn.textContent;
        btn.textContent = lastResult.message;
        btn.disabled = true;
        setTimeout(() => {
          btn.textContent = "Máximo en carrito";
        }, 2000);
      }

      btn.classList.remove("adding");
      
      // Reset input y deshabilitar si llegó al límite
      const nuevoEnCarrito = getCartQty(id);
      const nuevoMaxPermitido = stock - nuevoEnCarrito;
      if (qtyInput) {
        if (nuevoMaxPermitido <= 0) {
          card.querySelector(".card-qty-control").style.display = "none";
          btn.textContent = "Máximo en carrito";
          btn.disabled = true;
        } else {
          qtyInput.max = nuevoMaxPermitido;
          qtyInput.value = 1;
        }
      }
    });

    return card;
  }

  // ── RENDER GRILLA ────────────────────────────────────────────────────────
  function renderProducts() {
    const grid = document.getElementById("products-grid");
    if (!grid || catalog.length === 0) return;

    // Limpiar skeletons y cards anteriores
    grid.innerHTML = "";

    catalog.forEach((p, i) => {
      const card = buildProductCard(p);
      // Escalonar la animación de entrada
      card.style.animationDelay = `${i * 0.05}s`;
      grid.appendChild(card);
    });
  }

  // ── STATUS ───────────────────────────────────────────────────────────────
  function setStatus(msg, type = "info") {
    const el = document.getElementById("products-status");
    if (!el) return;
    el.textContent  = msg;
    el.dataset.type = type;
  }

  // ── FETCH ────────────────────────────────────────────────────────────────
  async function loadProducts() {
    setStatus("Cargando catálogo...");

    try {
      const res = await fetch(PRODUCTS_URL + CACHE_BUST, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-cache",
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();

      catalog = Array.isArray(data)
        ? data
        : Array.isArray(data.productos)
          ? data.productos
          : [];

      if (catalog.length === 0) {
        setStatus("No hay productos disponibles en este momento.", "warn");
        document.getElementById("products-grid").innerHTML =
          `<p style="color:var(--text-muted);grid-column:1/-1;text-align:center;padding:3rem 0">
             Sin productos disponibles. Volvé pronto. 🔄
           </p>`;
        return;
      }

      // Actualizar indicador de stock en footer
      if (data.updatedAt) {
        const el = document.getElementById("stock-last-update");
        if (el) {
          el.textContent = `Stock actualizado: ${new Date(data.updatedAt).toLocaleString("es-AR", {
            timeZone: "America/Argentina/Buenos_Aires",
          })}`;
        }
      }

      renderProducts();
      setStatus(`${catalog.length} producto${catalog.length !== 1 ? "s" : ""} disponible${catalog.length !== 1 ? "s" : ""}`);

    } catch (err) {
      console.error("[Products] Error al cargar catálogo:", err);

      // Limpiar skeletons y mostrar error
      const grid = document.getElementById("products-grid");
      if (grid) grid.innerHTML = "";

      setStatus("No se pudo cargar el catálogo. Verificá tu conexión.", "error");

      // Retry automático después de 10 segundos
      setTimeout(() => {
        console.log("[Products] Reintentando carga...");
        loadProducts();
      }, 10000);
    }
  }

  // ── FILTRADO POR CATEGORÍA ───────────────────────────────────────────────
  /**
   * Conecta los clicks en las tarjetas de categoría con el filtrado de productos.
   * Usa el atributo data-filter para determinar la categoría.
   */
  function initCategoryFilter() {
    document.querySelectorAll(".category-card[data-filter]").forEach((card) => {
      card.addEventListener("click", () => {
        const filter = card.dataset.filter;

        // Scroll suave al catálogo
        document.getElementById("catalogo")?.scrollIntoView({ behavior: "smooth" });

        if (filter === "todos" || !filter) {
          renderProducts();
          setStatus(`${catalog.length} productos encontrados.`);
          return;
        }

        // Filtrar usando la columna 'categoria' del CSV (coincidencia exacta o parcial)
        // Mapa de filtro -> palabras que acepta en el campo categoria
        const categoryMap = {
          telefonia:   ["telefonia", "telefon", "celular", "smartphone", "iphone", "samsung", "motorola"],
          computacion: ["computacion", "computadora", "laptop", "tablet", "notebook", "macbook", "pc"],
          accesorios:  ["accesorios", "accesorio", "auricular", "cable", "cargador", "smartwatch", "funda"],
          servicio:    ["reparaciones", "servicio", "tecnico", "técnico", "reparacion", "reparación"],
          importados:  ["importados", "importado", "zapatilla", "calzado", "consola", "ps5"],
        };

        const keys = categoryMap[filter] || [filter];
        const filtered = catalog.filter((p) => {
          const cat = (p.categoria || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          return keys.some(k => cat.includes(k.normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
        });

        const grid = document.getElementById("products-grid");
        if (!grid) return;
        grid.innerHTML = "";

        if (filtered.length === 0) {
          grid.innerHTML = `
            <p style="color:var(--text-muted);grid-column:1/-1;text-align:center;padding:3rem 0">
              Sin productos en esta categoría. <button
                onclick="document.querySelector('[data-filter=todos]').click()"
                style="color:var(--accent-light);background:none;border:none;cursor:pointer;font-family:inherit;font-size:inherit"
              >Ver todo</button>
            </p>`;
        } else {
          filtered.forEach((p, i) => {
            const c = buildProductCard(p);
            c.style.animationDelay = `${i * 0.05}s`;
            grid.appendChild(c);
          });
        }

        setStatus(`${filtered.length} producto${filtered.length !== 1 ? "s" : ""} en esta categoría.`);
      });
    });
  }

  // ── LIGHTBOX ─────────────────────────────────────────────────────────────
  function openLightbox(images, nombre, descripcion) {
    // Eliminar lightbox anterior si existe
    const old = document.getElementById("olaphone-lightbox");
    if (old) old.remove();

    let lbIdx = 0;

    const overlay = document.createElement("div");
    overlay.id = "olaphone-lightbox";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", `Galería de ${nombre}`);
    overlay.innerHTML = `
      <div class="lb-backdrop"></div>
      <div class="lb-box">
        <button class="lb-close" aria-label="Cerrar galería">✕</button>
        <div class="lb-img-wrap">
          <img class="lb-img" src="${esc(images[0])}" alt="${esc(nombre)}" />
          ${images.length > 1 ? `
            <button class="lb-nav lb-prev" aria-label="Anterior">❮</button>
            <button class="lb-nav lb-next" aria-label="Siguiente">❯</button>
          ` : ""}
        </div>
        ${images.length > 1 ? `
          <div class="lb-dots">
            ${images.map((_, i) => `<span class="lb-dot ${i === 0 ? "active" : ""}" data-i="${i}"></span>`).join("")}
          </div>` : ""}
        <div class="lb-info">
          <h3 class="lb-title">${esc(nombre)}</h3>
          ${descripcion ? `<p class="lb-desc">${esc(descripcion)}</p>` : ""}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => overlay.classList.add("active"));

    const lbImg = overlay.querySelector(".lb-img");
    const lbDots = overlay.querySelectorAll(".lb-dot");

    function showLbSlide(idx) {
      lbIdx = idx;
      lbImg.style.opacity = "0";
      setTimeout(() => {
        lbImg.src = images[idx];
        lbImg.style.opacity = "1";
      }, 150);
      lbDots.forEach((d, i) => d.classList.toggle("active", i === idx));
    }

    const btnPrev = overlay.querySelector(".lb-prev");
    const btnNext = overlay.querySelector(".lb-next");
    if (btnPrev) btnPrev.addEventListener("click", () => showLbSlide(lbIdx > 0 ? lbIdx - 1 : images.length - 1));
    if (btnNext) btnNext.addEventListener("click", () => showLbSlide(lbIdx < images.length - 1 ? lbIdx + 1 : 0));
    lbDots.forEach(d => d.addEventListener("click", () => showLbSlide(+d.dataset.i)));

    function closeLightbox() {
      overlay.classList.remove("active");
      document.body.style.overflow = "";
      setTimeout(() => overlay.remove(), 300);
    }

    overlay.querySelector(".lb-close").addEventListener("click", closeLightbox);
    overlay.querySelector(".lb-backdrop").addEventListener("click", closeLightbox);
    document.addEventListener("keydown", function onKey(e) {
      if (e.key === "Escape") { closeLightbox(); document.removeEventListener("keydown", onKey); }
      if (e.key === "ArrowLeft" && images.length > 1) showLbSlide(lbIdx > 0 ? lbIdx - 1 : images.length - 1);
      if (e.key === "ArrowRight" && images.length > 1) showLbSlide(lbIdx < images.length - 1 ? lbIdx + 1 : 0);
    });
  }

  // ── EVENT LISTENERS ──────────────────────────────────────────────────────
  // Re-renderizar cuando el carrito cambia (actualiza botones y cantidades)
  document.addEventListener("cart:changed", () => {
    if (catalog.length > 0) renderProducts();
  });

  // ── INICIALIZACIÓN ───────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    initCategoryFilter();
    loadProducts();
  });

})();
