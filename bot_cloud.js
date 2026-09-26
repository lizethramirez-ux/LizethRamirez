const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs');
chromium.use(stealth);

const GAME_URL = process.env.GAME_URL; // URL de Aviator en Codere (secret/env del workflow)
const DURACION_MS = parseInt(process.env.BOT_DURACION_MS || '18000000', 10); // 5h

(async () => {
  console.log("🚀 Bot Codere iniciando en GitHub Actions...");

  if (!process.env.AUTH_JSON_BASE64 || !GAME_URL) {
    console.error("❌ Faltan AUTH_JSON_BASE64 o GAME_URL.");
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
    console.log("📡 Cargando Aviator con sesión restaurada...");
    await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Buscar el iframe de Spribe (máx 30s)
    let frame = null;
    for (let i = 0; i < 30; i++) {
      frame = page.frames().find(f => /spribe|aviator/i.test(f.url()));
      if (frame) break;
      await page.waitForTimeout(1000);
    }

    if (!frame) {
      await page.screenshot({ path: 'error.png', fullPage: true });
      const pideLogin = await page
        .isVisible('button:has-text("Ingresar"), button:has-text("Entrar"), a:has-text("Login"), a:has-text("Ingresar")')
        .catch(() => false);
      throw new Error(pideLogin
        ? "🔴 SESIÓN MUERTA: el sitio pide login → regenera auth.json en tu PC y actualiza el secret AUTH_JSON_BASE64"
        : "🔴 El iframe no cargó y no hay botón de login visible → revisa error.png (posible bloqueo de IP o carga lenta)");
    }

    console.log(`🎯 Sesión VÁLIDA. Conectado a: ${frame.url().slice(0, 80)}`);
    await page.screenshot({ path: 'inicio_ok.png' });

    // Extracción (el frontend es de Spribe → mismos selectores que Rushbet)
    let ultima = "";
    let contador = 0;
    const t0 = Date.now();

    while (Date.now() - t0 < DURACION_MS) {
      try {
        const cuota = await frame.evaluate(() => {
          const el = document.querySelector('.payouts-block .bubble-multiplier, .payouts-wrapper .bubble, .bubble-multiplier, .payout');
          return el ? el.innerText.replace('x', '').trim() : null;
        });

        if (cuota && cuota !== ultima && !isNaN(parseFloat(cuota))) {
          ultima = cuota;
          contador++;
          console.log(`📈 NUEVA CUOTA (${contador}): ${cuota}x`);

          if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
            await fetch(`${process.env.SUPABASE_URL}/rest/v1/cuotas_rushbet`, {
              method: 'POST',
              headers: {
                'apikey': process.env.SUPABASE_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify({ cuota: parseFloat(cuota), created_at: new Date().toISOString() })
            }).catch(e => console.error("Error Supabase:", e.message));
          }
        }
      } catch (e) {
        // El iframe puede recargarse entre rondas; se reintenta en el siguiente ciclo
      }
      await page.waitForTimeout(2500 + Math.random() * 1000);
    }

    console.log(`🏁 Corrida completada: ${contador} cuotas capturadas.`);

  } catch (e) {
    console.error("❌ " + e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
