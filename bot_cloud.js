// ═══════════════════════════════════════════════════════════════
// bot_cloud.js — Bot Aviator (Codere) para GitHub Actions
// Sesión restaurada (AUTH_JSON_BASE64) + lanzamiento automático del juego
// ═══════════════════════════════════════════════════════════════

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs');

chromium.use(stealth);

const GAME_URL = process.env.GAME_URL;
const DURACION_MS = parseInt(process.env.BOT_DURACION_MS || '18000000', 10); // 5 horas

// Se ejecuta DENTRO de la página para leer el historial de multiplicadores
const leerCuotas = () => [...document.querySelectorAll('[appcoloredmultiplier], .payout')]
  .map(el => (el.textContent || '').trim())
  .filter(t => /^\d+(\.\d+)?x$/i.test(t));

// Lee multiplicadores en la página dada; si no hay, mira dentro de sus iframes
async function leerCuotasEn(pageJuego) {
  let cuotas = await pageJuego.evaluate(leerCuotas).catch(() => []);
  if (!cuotas.length) {
    for (const f of pageJuego.frames()) {
      if (f === pageJuego.mainFrame()) continue; // el principal ya se leyó
      const c = await f.evaluate(leerCuotas).catch(() => []);
      if (c.length) { cuotas = c; break; }
    }
  }
  return cuotas;
}

(async () => {
  console.log("🚀 Bot Aviator (Codere) iniciando en GitHub Actions...");
  console.log(`⏱️ Duración programada: ${(DURACION_MS / 3600000).toFixed(1)} horas`);

  if (!process.env.AUTH_JSON_BASE64 || !GAME_URL) {
    console.error("❌ ERROR: Faltan los secrets AUTH_JSON_BASE64 y/o GAME_URL.");
    process.exit(1);
  }

  fs.writeFileSync('auth.json', Buffer.from(process.env.AUTH_JSON_BASE64, 'base64').toString('utf-8'));

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    storageState: 'auth.json',
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-CO',
    timezoneId: 'America/Bogota'
  });

  const page = await context.newPage();

  try {
    // ── 1. Cargar la URL ──
    console.log("📡 Cargando página del juego...");
    await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    let pageJuego = page; // puede cambiar si el juego abre en pestaña nueva
    let cuotas = [];

    // ── 2. Esperar 15s: ¿multiplicadores directos o botón AVIATOR? ──
    let botonesAviator = [];
    for (let s = 0; s < 15 && !cuotas.length && !botonesAviator.length; s++) {
      cuotas = await leerCuotasEn(pageJuego);
      if (!cuotas.length) {
        botonesAviator = await pageJuego.getByText('AVIATOR', { exact: true }).all().catch(() => []);
      }
      if (!cuotas.length && !botonesAviator.length) await pageJuego.waitForTimeout(1000);
    }

    // ¿Sesión muerta?
    const pideLogin = await pageJuego
      .locator('button:has-text("Ingresar"), a:has-text("Ingresar"), button:has-text("Entrar"), button:has-text("Log in"), a:has-text("Login")')
      .first().isVisible().catch(() => false);
    if (pideLogin) {
      await pageJuego.screenshot({ path: 'error.png', fullPage: true }).catch(() => {});
      throw new Error("🔴 SESIÓN MUERTA: la página pide login → regenera auth.json y actualiza el secret AUTH_JSON_BASE64");
    }

    // ── 3. Si estamos en el lobby, clicar AVIATOR para lanzar el juego ──
    if (!cuotas.length && botonesAviator.length) {
      console.log(`🕹️ Lobby detectado con botón AVIATOR (${botonesAviator.length} coincidencias). Lanzando el juego...`);
      for (let i = 0; i < Math.min(botonesAviator.length, 3) && !cuotas.length; i++) {
        try {
          const popupPromise = context.waitForEvent('page', { timeout: 10000 }).catch(() => null);
          await botonesAviator[i].click({ timeout: 5000 });
          const popup = await popupPromise;
          if (popup) {
            console.log("🪟 El juego se abrió en una pestaña NUEVA — siguiéndola...");
            pageJuego = popup;
            await pageJuego.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
          } else {
            console.log("🖥️ El juego se abrió en la misma página.");
          }
        } catch (e) {
          console.log(`   ⚠️ Intento de clic ${i + 1}: ${String(e.message || e).slice(0, 60)}`);
        }
        for (let s = 0; s < 15 && !cuotas.length; s++) {
          cuotas = await leerCuotasEn(pageJuego);
          if (!cuotas.length) await pageJuego.waitForTimeout(1000);
        }
      }
    }

    // ── 4. Espera final: el juego puede tardar en arrancar ──
    for (let s = 0; s < 30 && !cuotas.length; s++) {
      cuotas = await leerCuotasEn(pageJuego);
      if (!cuotas.length) await pageJuego.waitForTimeout(1000);
    }

    if (!cuotas.length) {
      await pageJuego.screenshot({ path: 'error.png', fullPage: true }).catch(() => {});
      throw new Error("🔴 El juego no mostró multiplicadores en ~45s tras el clic. Descarga error.png de los artifacts y me dices qué se ve.");
    }

    console.log(`🎯 ¡JUEGO ACTIVO! ${cuotas.length} multiplicadores en pantalla.\n`);
    await pageJuego.screenshot({ path: 'inicio_ok.png' });

    // ── 5. Envío a Supabase ──
    const enviarSupabase = async (texto) => {
      if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) return;
      try {
        await fetch(`${process.env.SUPABASE_URL}/rest/v1/cuotas_rushbet`, {
          method: 'POST',
          headers: {
            'apikey': process.env.SUPABASE_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ cuota: parseFloat(texto), created_at: new Date().toISOString() })
        });
      } catch (e) {
        console.error("   ⚠️ Error Supabase:", e.message);
      }
    };

    // ── 6. Bucle de captura ──
    let previas = new Set(cuotas);
    let prevHead = cuotas[0];
    let prevTail = cuotas[cuotas.length - 1];
    let prevLen = cuotas.length;
    let ciclos = 0, contador = 0, latidosVacios = 0;
    let lastCambio = Date.now();
    const t0 = Date.now();

    console.log(`🎚️ Calibrado con ${cuotas.length} multiplicadores. Esperando rondas nuevas...\n`);

    while (Date.now() - t0 < DURACION_MS) {
      ciclos++;
      cuotas = await leerCuotasEn(pageJuego);

      if (cuotas.length) {
        const nuevasPorContenido = cuotas.filter(c => !previas.has(c));
        let paraEmitir = [];

        if (nuevasPorContenido.length) {
          paraEmitir = nuevasPorContenido;
        } else {
          const head = cuotas[0];
          const tail = cuotas[cuotas.length - 1];
          if (head !== prevHead) paraEmitir = [head];
          else if (tail !== prevTail) paraEmitir = [tail];
          else if (cuotas.length !== prevLen) paraEmitir = [head];
        }

        for (const c of paraEmitir) {
          contador++;
          console.log(`📈 NUEVA CUOTA (${contador}): ${c}`);
          await enviarSupabase(c);
        }

        if (paraEmitir.length || cuotas[0] !== prevHead || cuotas.length !== prevLen) {
          lastCambio = Date.now();
        }

        previas = new Set(cuotas);
        prevHead = cuotas[0];
        prevTail = cuotas[cuotas.length - 1];
        prevLen = cuotas.length;
        latidosVacios = 0;
      }

      // Latido cada 10 ciclos (~30s)
      if (ciclos % 10 === 0) {
        const secs = Math.round((Date.now() - t0) / 1000);
        console.log(`💚 Latido ${secs}s — capturadas: ${contador} — en pantalla: ${cuotas.slice(0, 5).join(' | ') || '(nada)'}`);

        if (pageJuego.isClosed()) {
          await page.screenshot({ path: 'error.png', fullPage: true }).catch(() => {});
          throw new Error("🔴 La pestaña del juego se cerró (posible sesión muerta). Regenera auth.json.");
        }
        if (!cuotas.length) {
          latidosVacios++;
          if (latidosVacios >= 3) {
            await pageJuego.screenshot({ path: 'error.png', fullPage: true }).catch(() => {});
            throw new Error("🔴 Sin multiplicadores por ~90s. Mira error.png.");
          }
        }
        if (Date.now() - lastCambio > 10 * 60 * 1000) {
          await pageJuego.screenshot({ path: 'error.png', fullPage: true }).catch(() => {});
          throw new Error("🔴 El historial lleva 10 min sin cambiar (juego congelado). Mira error.png.");
        }
      }

      await pageJuego.waitForTimeout(2500 + Math.random() * 1000);
    }

    console.log(`\n🏁 Corrida completada: ${contador} cuotas capturadas y enviadas a Supabase.`);

  } catch (e) {
    console.error("❌ " + e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
