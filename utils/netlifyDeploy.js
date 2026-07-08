/**
 * =============================================================================
 * UTILIDAD: NETLIFY DEPLOY TRIGGER
 * =============================================================================
 * Dispara el Deploy Hook de Netlify via HTTP POST para forzar un nuevo
 * build/deploy del frontend estático después de que el stock se actualizó.
 *
 * Configuración:
 *   NETLIFY_DEPLOY_HOOK_URL=https://api.netlify.com/build_hooks/TU_HOOK_ID
 *
 * Cómo obtener la URL del Deploy Hook:
 *   Netlify Dashboard → Tu sitio → Site settings → Build & Deploy
 *   → Build hooks → Add build hook → Copiar URL
 * =============================================================================
 */

const axios = require("axios");

const NETLIFY_DEPLOY_HOOK_URL = process.env.NETLIFY_DEPLOY_HOOK_URL || "";
const MAX_RETRIES             = 2;

/**
 * Dispara el deploy hook de Netlify.
 * Reintenta una vez si falla (error de red o 5xx).
 *
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function triggerNetlifyDeploy() {
  if (!NETLIFY_DEPLOY_HOOK_URL) {
    console.warn("[Netlify] NETLIFY_DEPLOY_HOOK_URL no configurada. Deploy omitido.");
    return { success: false, message: "Deploy Hook URL no configurada" };
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Netlify espera un POST a la URL del hook, el body puede estar vacío
      const response = await axios.post(
        NETLIFY_DEPLOY_HOOK_URL,
        {},
        { timeout: 8000 }
      );

      return {
        success: true,
        message: `Deploy disparado (status ${response.status})`,
      };

    } catch (err) {
      const status = err.response?.status;
      console.error(`[Netlify] Intento ${attempt}/${MAX_RETRIES} fallido: ${err.message} (HTTP ${status || "N/A"})`);

      // No reintentar si es error de cliente (4xx)
      if (status && status >= 400 && status < 500) {
        return { success: false, message: `Error de cliente HTTP ${status}: verificar la URL del hook` };
      }

      // Esperar antes del siguiente intento (backoff simple)
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  return { success: false, message: `Deploy fallido luego de ${MAX_RETRIES} intentos` };
}

module.exports = { triggerNetlifyDeploy };
