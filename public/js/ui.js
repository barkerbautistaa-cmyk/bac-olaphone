/**
 * =============================================================================
 * OLAPHONE — MÓDULO: UI / INTERACCIONES GENERALES
 * =============================================================================
 * Agrupa todos los comportamientos de UI que no son carrito ni productos:
 *  · Navbar con efecto scroll
 *  · Menú mobile hamburger
 *  · Animaciones de entrada via IntersectionObserver
 *  · Smooth scroll para links ancla internos
 *  · Botón flotante de WhatsApp (ocultar al hacer scroll hacia arriba)
 *  · Keyframe de spin para el botón de checkout cargando
 *  · Cierre del menú mobile al hacer click en un link
 * =============================================================================
 */

(function () {
  "use strict";

  // ── NAVBAR: efecto glassmorphism al hacer scroll ──────────────────────────
  (function initNavbarScroll() {
    const navbar = document.querySelector(".navbar");
    if (!navbar) return;

    const onScroll = () => {
      navbar.classList.toggle("scrolled", window.scrollY > 20);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll(); // Estado inicial
  })();

  // ── MENÚ MOBILE: hamburger toggle ────────────────────────────────────────
  (function initMobileMenu() {
    const btn    = document.getElementById("btn-menu-mobile");
    const menu   = document.getElementById("mobile-menu");
    if (!btn || !menu) return;

    // Asegurar que empiece cerrado sin importar el atributo HTML
    menu.classList.remove("is-open");
    menu.removeAttribute("hidden");

    let isOpen = false;

    function toggleMenu(open) {
      isOpen = open;
      btn.setAttribute("aria-expanded", String(open));
      menu.classList.toggle("is-open", open);

      // Animar líneas del hamburger
      const lines = btn.querySelectorAll(".hamburger-line");
      if (open) {
        lines[0].style.transform = "translateY(7px) rotate(45deg)";
        lines[1].style.opacity   = "0";
        lines[2].style.transform = "translateY(-7px) rotate(-45deg)";
      } else {
        lines[0].style.transform = "";
        lines[1].style.opacity   = "";
        lines[2].style.transform = "";
      }
    }

    btn.addEventListener("click", () => toggleMenu(!isOpen));

    // Cerrar al hacer click en un link del menú mobile
    menu.querySelectorAll(".mobile-nav-link").forEach((link) => {
      link.addEventListener("click", () => toggleMenu(false));
    });

    // Cerrar al presionar Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen) toggleMenu(false);
    });
  })();

  // ── ANIMACIONES DE ENTRADA: IntersectionObserver ─────────────────────────
  (function initScrollAnimations() {
    if (!window.IntersectionObserver) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("animate-in");
            observer.unobserve(entry.target); // Una sola vez
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -60px 0px" }
    );

    // Observar elementos que deben animarse al entrar en el viewport
    const selectors = [
      ".category-card",
      ".contact-card",
      ".gallery-item",
      ".hero-stat",
      ".section-header",
    ];

    selectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        el.style.opacity  = "0";
        el.style.transform = "translateY(20px)";
        el.style.transition = "opacity 0.5s ease, transform 0.5s ease";
        observer.observe(el);
      });
    });

    // Override de .animate-in para los elementos observados
    // (la clase animate-in del CSS aplica la animación keyframe a las cards de productos)
    document.addEventListener("animateIn", (e) => {
      if (e.target) {
        e.target.style.opacity   = "1";
        e.target.style.transform = "translateY(0)";
      }
    });

    // Handler para cuando el observer dispara
    observer.takeRecords = function () {};
    const originalCallback = observer._callback;
    // Re-usar el observer con el override correcto
    document.querySelectorAll(selectors.join(",")).forEach((el) => {
      const obs2 = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.style.opacity   = "1";
              entry.target.style.transform = "translateY(0)";
              obs2.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.1, rootMargin: "0px 0px -60px 0px" }
      );
      obs2.observe(el);
    });
  })();

  // ── SMOOTH SCROLL para links internos ────────────────────────────────────
  (function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
      link.addEventListener("click", (e) => {
        const target = document.querySelector(link.getAttribute("href"));
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth" });
        // Cerrar menú mobile si estaba abierto
        const menu = document.getElementById("mobile-menu");
        if (menu && !menu.hidden) {
          document.getElementById("btn-menu-mobile")?.click();
        }
      });
    });
  })();

  // ── WHATSAPP FLOAT: ocultar en scroll hacia arriba, mostrar hacia abajo ──
  (function initWaFloat() {
    const waBtn = document.getElementById("btn-wa-float");
    if (!waBtn) return;

    let lastScroll = 0;
    let visible    = true;

    window.addEventListener("scroll", () => {
      const current = window.scrollY;

      // Solo actuar si scrolló más de 200px desde el top
      if (current < 200) {
        if (!visible) { waBtn.style.transform = ""; visible = true; }
        lastScroll = current;
        return;
      }

      if (current < lastScroll && !visible) {
        // Subiendo → mostrar
        waBtn.style.transform = "";
        visible = true;
      } else if (current > lastScroll && visible) {
        // Bajando → mantener visible (siempre accesible)
        // Ocultar solo si se abre el drawer del carrito (controlado por cart.js)
      }

      lastScroll = current;
    }, { passive: true });
  })();

  // ── SPIN KEYFRAME para el botón de checkout ──────────────────────────────
  (function injectSpinKeyframe() {
    const style = document.createElement("style");
    style.textContent = `
      @keyframes spin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  })();

  // ── CATEGORÍAS: highlight de la activa ───────────────────────────────────
  (function initCategoryHighlight() {
    document.querySelectorAll(".category-card[data-filter]").forEach((card) => {
      card.addEventListener("click", () => {
        // Quitar active de todas
        document.querySelectorAll(".category-card").forEach((c) => {
          c.style.borderColor = "";
          c.style.background  = "";
        });
        // Marcar la clickeada
        card.style.borderColor = "var(--accent)";
        card.style.background  = "var(--accent-glow-sm)";
      });
    });
  })();

  console.log("[UI] Módulo de interfaz OlaPhone inicializado ✓");

})();
