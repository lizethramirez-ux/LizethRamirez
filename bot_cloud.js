// ═══════════════════════════════════════════════════════════════
// bot_cloud.js — Bot Aviator (Codere) — AUTO-LOGIN en Actions
// Flujo: Acceder → usuario/contraseña → Acceder → popup OK → Aviator
// Sitio Ionic/Angular: los botones son <ion-button> (custom),
// NO <button> nativos — excepto el popup OK (.alert-button).
// ═══════════════════════════════════════════════════════════════

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const GAME_URL = process.env.GAME_URL;
const USER = process.env.CODERE_USER;
const PASS = process.env.CODERE_PASSWORD;
const DURACION_MS = parseInt(process.env.BOT_DURACION_MS || '18000000', 10); // 5 horas

const OK_SEL = 'button.alert-button:has-text("OK"), .alert-button:has-text("OK")';

// ── Lectura de multiplicadores (historial Angular de Codere) ──
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

// ── Clic robusto: ion-button → button → a → texto plano (span) ──
async function clicarTexto(page, texto, timeout = 5000) {
  for (const s of [`ion-button:has-text("${texto}")`, `button:has-text("${texto}")`, `a:has-text("${texto}")`]) {
    const loc = page.locator(s).first();
    if (await loc.isVisible().catch(() => false)) {
      await loc.click({ force: true, timeout }).catch(() => {});
      return true;
    }
  }
  const span = page.getByText(texto, { exact: true }).first();
  if (await span.isVisible().catch(() => false)) {
    await span.click({ force: true, timeout }).catch(() => {});
    return true;
  }
  return false;
}

// ¿Hay botón/texto "Acceder" visible? (con soporte ion-button)
async function accederVisible(page) {
  const a = page.locator('ion-button:has-text("Acceder"), button:has-text("Acceder"), a:has-text("Acceder")');
  if (await a.first().isVisible().catch(() => false)) return true;
  const b = page.getByText('Acceder', { exact: true });
  const n = await b.count().catch(() => 0);
  for (let i = 0; i < Math.min(n, 5); i++) {
    if (await b.nth(i).isVisible().catch(() => false)) return true;
  }
  return false;
}

// ═══════════════ LOGIN ═══════════════
async function hacerLogin(page, abrirModal = true) {
  // 1. Abrir modal
  if (abrirModal) {
    console.log("🔐 [1/5] Clic en 'Acceder' (cabecera)...");
    if (!(await clicarTexto(page, 'Acceder'))) {
      await page.screenshot({ path: 'error.png', fullPage: true });
      throw new Error("No encontré el botón 'Acceder'. Mira error.png.");
    }
  } else {
    console.log("🔐 [1/5] El formulario ya estaba abierto.");
  }
  await page.waitForSelector('input[name="username"]', { state: 'visible', timeout: 15000 });
  console.log("   ✅ Modal de login abierto.");

  // 2. Credenciales (inputs nativos de Ionic: name=username / name=password)
  console.log("🔐 [2/5] Escribiendo usuario y contraseña...");
  await page.click('input[name="username"]', { force: true });
  await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace');
  await page.keyboard.type(USER, { delay: 80 });

  await page.click('input[name="password"]', { force: true });
  await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace');
  await page.keyboard.type(PASS, { delay: 80 });
  await page.screenshot({ path: 'login_formulario.png' });

  // 3. Enviar: Enter primero; si no basta, el botón "Acceder" del modal (último del DOM)
  console.log("🔐 [3/5] Enviando...");
  await page.keyboard.press('Enter');
  await page.waitForTimeout(4000);
  let pwVisible = await page.isVisible('input[name="password"]').catch(() => false);
  const okYa = await page.locator(OK_SEL).first().isVisible().catch(() => false);
  if (pwVisible && !okYa) {
    const btns = page.locator('ion-button:has-text("Acceder"), button:has-text("Acceder")');
    const n = await btns.count().catch(() => 0);
    if (n > 0) {
      console.log(`   🖱️ Enter no bastó → clic en 'Acceder' #${n} (el del modal)...`);
      await btns.nth(n - 1).click({ force: true, timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(3000);
    }
  }

  // 4. Popup Ionic con "OK" (aparece tras enviar el login) — hay que cerrarlo
  console.log("🔐 [4/5] Buscando popup de confirmación con 'OK'...");
  const btnOK = page.locator(OK_SEL).first();
  let okCerrado = false;
  for (let i = 0; i < 10 && !okCerrado; i++) {
    if (await btnOK.isVisible().catch(() => false)) {
      await page.waitForTimeout(600);
      await btnOK.click({ force: true }).catch(() => {});
      console.log("   ✅ Popup OK cerrado.");
      okCerrado = true;
    } else {
      await page.waitForTimeout(2000);
    }
  }
  if (!okCerrado) console.log("   ℹ️ No apareció popup con OK.");
  await page.waitForTimeout(2000);

  // 5. Verificación: el campo de contraseña debe haber desaparecido (2 lecturas seguidas)
  console.log("🔐 [5/5] Verificando sesión...");
  let confirmaciones = 0, logueado = false;
  for (let i = 0; i < 15; i++) {
    const pw = await page.isVisible('input[name="password"]').catch(() => false);
    if (!pw) { if (++confirmaciones >= 2) { logueado = true; break; } }
    else confirmaciones = 0;
    await page.waitForTimeout(2000);
  }
  if (!logueado) {
    await page.screenshot({ path: 'error.png', fullPage: true });
    const texto = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 250)).catch(() => '');
    console.log(`🔍 Texto en pantalla: "${texto}"`);
    throw new Error("Login no completó (¿credenciales? ¿popup extra?). Mira error.png y el texto de arriba.");
  }
  console.log("   ✅ ¡LOGIN COMPLETADO!");
  await page.screenshot({ path: 'login_ok.png' });
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

    // ¿Necesitamos login?
    const hayAcceder = await accederVisible(page);
    const formDirecto = await page.isVisible('input[name="username"]').catch(() => false);

    if (hayAcceder || formDirecto) {
      console.log("🔑 Sin sesión → haciendo login...");
      await hacerLogin(page, hayAcceder && !formDirecto);
      console.log("📡 Recargando la página del juego con sesión activa...");
      await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3000);
      await limpiarOverlays(page);
    } else {
      console.log("✅ No hay botón 'Acceder' → sesión ya activa.");
    }

    let pageJuego = page;
    let cuotas = await leerCuotasEn(pageJuego);

    // ── Lanzar AVIATOR si estamos en el lobby ──
    if (!cuotas.length) {
      console.log("🕹️ Buscando el botón AVIATOR...");
      let candidatos = [];
      for (let s = 0; s < 15 && !candidatos.length && !cuotas.length; s++) {
        candidatos = await pageJuego.locator('ion-button:has-text("AVIATOR"), button:has-text("AVIATOR")').all().catch(() => []);
        if (!candidatos.length) {
          candidatos = await pageJuego.getByText('AVIATOR', { exact: true }).all().catch(() => []);
        }
        if (!candidatos.length) await pageJuego.waitForTimeout(1000);
        cuotas = await leerCuotasEn(pageJuego);
      }

      if (!cuotas.length && candidatos.length) {
        console.log(`   🖱️ Encontré ${candidatos.length} elemento(s) AVIATOR. Lanzando el juego...`);
        for (let i = 0; i < Math.min(candidatos.length, 3) && !cuotas.length; i++) {
          try {
            const popupPromise = context.waitForEvent('page', { timeout: 10000 }).catch(() => null);
            await candidatos[i].click({ timeout: 5000 });
            const popup = await popupPromise;
            if (popup) {
              console.log("🪟 El juego se abrió en pestaña NUEVA — siguiéndola...");
              pageJuego = popup;
              await pageJuego.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
            } else {
              console.log("🖥️ El juego se abrió en la misma página.");
            }
          } catch (e) {
            console.log(`   ⚠️ Intento ${i + 1}: ${String(e.message || e).slice(0, 60)}`);
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
      const texto = await pageJuego.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 300)).catch(() => '');
      console.log(`🔍 Texto visible al fallar: "${texto}"`);
      await pageJuego.screenshot({ path: 'error.png', fullPage: true }).catch(() => {});
      throw new Error("El juego no mostró multiplicadores. El texto de arriba y error.png dicen qué pasó.");
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

        if (paraEmitir.length) lastCambio = Date.now();

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
