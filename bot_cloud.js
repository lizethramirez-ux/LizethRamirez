// ═══════════════════════════════════════════════════════════════
// bot_cloud.js — Bot Aviator (Codere) con AUTO-LOGIN en Actions
// Login directo (sin Cloudflare) → lanzar Aviator → capturar → Supabase
// ═══════════════════════════════════════════════════════════════

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const GAME_URL = process.env.GAME_URL;
const USER = process.env.CODERE_USER;
const PASS = process.env.CODERE_PASSWORD;
const DURACION_MS = parseInt(process.env.BOT_DURACION_MS || '18000000', 10); // 5 horas

// ── Lectura de multiplicadores (Angular: viven en la PÁGINA) ──
const leerCuotas = () => [...document.querySelectorAll('[appcoloredmultiplier], .payout')]
  .map(el => (el.textContent || '').trim())
  .filter(t => /^\d+(\.\d+)?x$/i.test(t));

async function leerCuotasEn(p) {
  let cuotas = await p.evaluate(leerCuotas).catch(() => []);
  if (!cuotas.length) {
    for (const f of p.frames()) {
      if (f === p.mainFrame()) continue;
      const c = await f.evaluate(leerCuotas).catch(() => []);
      if (c.length) { cuotas = c; break; }
    }
  }
  return cuotas;
}

// ── LOGIN ──
async function hacerLogin(page) {
  console.log("🔐 Abriendo modal de acceso...");

  const btnAcceder = page.locator(
    'button:has-text("Acceder"), a:has-text("Acceder"), ' +
    'button:has-text("Iniciar sesión"), a:has-text("Iniciar sesión"), ' +
    'a[href*="login"], button:has-text("Log in")'
  ).first();
  await btnAcceder.click({ timeout: 15000, force: true });

  await page.waitForSelector('input[type="password"]', { state: 'visible', timeout: 15000 });
  console.log("   ✅ Modal abierto.");

  // Dump de inputs visibles: si algún selector no coincide, esto nos lo revela
  const dump = await page.evaluate(() => {
    const vis = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    return [...document.querySelectorAll('input')].filter(vis)
      .map(i => `${i.type || 'text'}|name=${i.name || '-'}|id=${i.id || '-'}|ph=${i.placeholder || '-'}`);
  });
  console.log("   🔍 Inputs visibles:", JSON.stringify(dump));

  // Campo de usuario: cascada de selectores comunes
  const userSels = [
    'input[name="username"]', '#username',
    'input[name="email"]', '#email', 'input[type="email"]',
    'input[formcontrolname="username"]', 'input[formcontrolname="email"]',
    'input[name="user"]', 'input[name="documento"]',
    'form input:visible:not([type="password"]):not([type="checkbox"])'
  ];
  let campoUser = null, selUsado = '';
  for (const s of userSels) {
    const loc = page.locator(s).first();
    if (await loc.isVisible().catch(() => false)) { campoUser = loc; selUsado = s; break; }
  }
  if (!campoUser) {
    await page.screenshot({ path: 'error.png', fullPage: true });
    throw new Error("No encontré el campo de usuario — pásame la línea 🔍 Inputs visibles del log.");
  }

  console.log(`   ✍️ Escribiendo usuario (${selUsado})...`);
  await campoUser.click({ force: true });
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(USER, { delay: 80 });

  const campoPass = page.locator('input[type="password"]').first();
  await campoPass.click({ force: true });
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(PASS, { delay: 80 });
  console.log("   ✍️ Credenciales escritas. Enviando...");
  await page.screenshot({ path: 'login_formulario.png' });

  // Enviar: Enter primero
  await campoPass.press('Enter');

  // Verificar: login completado cuando el campo de contraseña desaparece (2 lecturas seguidas)
  const estaLogueado = async () => {
    const pw = await page.isVisible('input[type="password"]').catch(() => false);
    return !pw;
  };

  let logueado = false, confirmaciones = 0;
  for (let i = 0; i < 15; i++) {
    if (await estaLogueado()) { confirmaciones++; if (confirmaciones >= 2) { logueado = true; break; } }
    else confirmaciones = 0;
    await page.waitForTimeout(2000);
  }

  // Si el Enter no bastó, intentar botón de submit explícito
  if (!logueado) {
    console.log("   🖱️ Enter no bastó, probando botón de submit...");
    const btnSubmit = page.locator(
      'button[type="submit"], button:has-text("Acceder"), button:has-text("Entrar"), button:has-text("Iniciar")'
    ).last();
    if (await btnSubmit.isVisible().catch(() => false)) {
      await btnSubmit.click({ force: true }).catch(() => {});
    }
    confirmaciones = 0;
    for (let i = 0; i < 15; i++) {
      if (await estaLogueado()) { confirmaciones++; if (confirmaciones >= 2) { logueado = true; break; } }
      else confirmaciones = 0;
      await page.waitForTimeout(2000);
    }
  }

  if (!logueado) {
    await page.screenshot({ path: 'error.png', fullPage: true });
    const btns = await page.evaluate(() => {
      const vis = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      return [...document.querySelectorAll('button')].filter(vis)
        .map(b => b.textContent.trim()).filter(Boolean).slice(0, 15);
    });
    console.log("   🔍 Botones visibles:", JSON.stringify(btns));
    throw new Error("Login no completó (¿credenciales? ¿verificación extra?). Mira error.png y los dumps del log.");
  }

  console.log("   ✅ ¡LOGIN COMPLETADO!");
}

(async () => {
  console.log("🚀 Bot Aviator (Codere) — auto-login en GitHub Actions");
  console.log(`⏱️ Duración: ${(DURACION_MS / 3600000).toFixed(1)} horas`);

  if (!GAME_URL || !USER || !PASS) {
    console.error("❌ Faltan secrets: GAME_URL, CODERE_USER y/o CODERE_PASSWORD.");
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-CO',
    timezoneId: 'America/Bogota'
  });

  const page = await context.newPage();

  const limpiarOverlays = async (p) => {
    await p.evaluate(() => {
      document.querySelectorAll('[id*="onetrust"], .modal-backdrop, .cookie-banner').forEach(el => el.remove());
    }).catch(() => {});
    await p.keyboard.press('Escape').catch(() => {});
  };

  try {
    console.log("📡 Cargando página...");
    await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    await limpiarOverlays(page);

    // ¿Necesita login? (botón de Acceder visible)
    const necesitaLogin = await page
      .locator('button:has-text("Acceder"), a:has-text("Acceder"), a:has-text("Iniciar sesión")')
      .first().isVisible().catch(() => false);

    if (necesitaLogin) {
      await hacerLogin(page);
      console.log("📡 Recargando la página del juego con sesión activa...");
      await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3000);
      await limpiarOverlays(page);
    } else {
      console.log("✅ Sesión ya activa (no hay botón de Acceder).");
    }

    let pageJuego = page;
    let cuotas = await leerCuotasEn(pageJuego);

    // ── Lanzar Aviator si estamos en el lobby ──
    if (!cuotas.length) {
      console.log("🕹️ Buscando botón AVIATOR...");
      let botones = [];
      for (let s = 0; s < 15 && !botones.length && !cuotas.length; s++) {
        botones = await pageJuego.getByText('AVIATOR', { exact: true }).all().catch(() => []);
        if (!botones.length) await pageJuego.waitForTimeout(1000);
        cuotas = await leerCuotasEn(pageJuego);
      }

      if (!cuotas.length && botones.length) {
        for (let i = 0; i < Math.min(botones.length, 3) && !cuotas.length; i++) {
          try {
            const popupPromise = context.waitForEvent('page', { timeout: 10000 }).catch(() => null);
            await botones[i].click({ timeout: 5000 });
            const popup = await popupPromise;
            if (popup) {
              console.log("🪟 Juego en pestaña nueva — siguiéndola...");
              pageJuego = popup;
              await pageJuego.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
            } else {
              console.log("🖥️ Juego en la misma página.");
            }
          } catch (e) {
            console.log(`   ⚠️ Intento de clic ${i + 1}: ${String(e.message || e).slice(0, 60)}`);
          }
          for (let s = 0; s < 20 && !cuotas.length; s++) {
            cuotas = await leerCuotasEn(pageJuego);
            if (!cuotas.length) await pageJuego.waitForTimeout(1000);
          }
        }
      }
    }

    // ── Espera final a que el juego muestre multiplicadores ──
    for (let s = 0; s < 30 && !cuotas.length; s++) {
      cuotas = await leerCuotasEn(pageJuego);
      if (!cuotas.length) await pageJuego.waitForTimeout(1000);
    }

    if (!cuotas.length) {
      await pageJuego.screenshot({ path: 'error.png', fullPage: true }).catch(() => {});
      throw new Error("El juego no mostró multiplicadores. Descarga error.png de los artifacts.");
    }

    console.log(`🎯 ¡JUEGO ACTIVO! ${cuotas.length} multiplicadores en pantalla.\n`);
    await pageJuego.screenshot({ path: 'inicio_ok.png' });

    // ── Supabase ──
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

    // ── Bucle de captura ──
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

      if (ciclos % 10 === 0) {
        const secs = Math.round((Date.now() - t0) / 1000);
        console.log(`💚 Latido ${secs}s — capturadas: ${contador} — en pantalla: ${cuotas.slice(0, 5).join(' | ') || '(nada)'}`);

        if (pageJuego.isClosed()) {
          await page.screenshot({ path: 'error.png', fullPage: true }).catch(() => {});
          throw new Error("La pestaña del juego se cerró (posible expulsión de sesión).");
        }
        if (!cuotas.length) {
          latidosVacios++;
          if (latidosVacios >= 3) {
            await pageJuego.screenshot({ path: 'error.png', fullPage: true }).catch(() => {});
            throw new Error("Sin multiplicadores por ~90s. Mira error.png.");
          }
        }
        if (Date.now() - lastCambio > 10 * 60 * 1000) {
          await pageJuego.screenshot({ path: 'error.png', fullPage: true }).catch(() => {});
          throw new Error("El historial lleva 10 min sin cambiar (juego congelado). Mira error.png.");
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
