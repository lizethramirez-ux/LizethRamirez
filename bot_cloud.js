const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const USER = process.env.RUSHBET_USER;
const PASS = process.env.RUSHBET_PASSWORD;

(async () => {
  console.log("🚀 Iniciando Bot Versión 4.0 (Anti-Anuncios)...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ 
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'es-CO',
    timezoneId: 'America/Bogota'
  });
  const page = await context.newPage();

  try {
    console.log("📡 Navegando a Rushbet...");
    await page.goto('https://www.rushbet.co/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    // 1. ABRIR LOGIN (Tu selector exitoso)
    console.log("🖱️ Abriendo modal de ingreso...");
    await page.click('.sc-ACYlI.dZjKjM', { force: true });
    await page.waitForTimeout(3000);

    // 2. LLENAR FORMULARIO (Tus IDs de consola)
    console.log("✍️ Escribiendo credenciales...");
    await page.fill('#login-form-modal-email', USER, { force: true });
    await page.fill('#login-form-modal-password', PASS, { force: true });
    await page.click('#login-form-modal-submit', { force: true });

    console.log("⏳ Esperando a que cargue el casino...");
    await page.waitForTimeout(10000);

    // 3. CERRAR ANUNCIO (El "X" que me pasaste)
    console.log("🧹 Buscando anuncio para cerrar...");
    try {
        // Buscamos el elemento rect o el botón que contiene el SVG de cierre
        const closeBtn = await page.locator('svg rect, .sc-close-button, [aria-label="Close"]').first();
        if (await closeBtn.isVisible()) {
            await closeBtn.click({ force: true });
            console.log("✅ Anuncio cerrado exitosamente.");
        }
    } catch (e) {
        console.log("ℹ️ No se detectó anuncio visualmente, procediendo...");
    }

    // 4. IR AL JUEGO AVIATOR
    console.log("🎰 Yendo al juego Aviator...");
    // Intentamos clic en el elemento que me pasaste
    try {
        const aviatorLink = page.locator('[data-testid="game-info-2440001"]').first();
        await aviatorLink.click({ force: true, timeout: 10000 });
    } catch (e) {
        console.log("⚠️ Clic fallido, navegando por URL directa...");
        await page.goto('https://www.rushbet.co/?page=all-games&game=2440001', { waitUntil: 'networkidle' });
    }

    await page.waitForTimeout(15000);

    // 5. EXTRACCIÓN DEL IFRAME (El corazón del bot)
    console.log("🎯 Buscando frame de Spribe...");
    const frames = page.frames();
    const aviatorFrame = frames.find(f => f.url().includes('spribe'));

    if (aviatorFrame) {
      console.log("✅ ¡DENTRO DEL JUEGO! Iniciando transmisión...");
      let ultimaCuota = "";
      const startTime = Date.now();

      while (Date.now() - startTime < 19800000) { // 5.5 horas
        try {
          const cuota = await aviatorFrame.evaluate(() => {
            const el = document.querySelector('.payouts-block .bubble-multiplier, .payout');
            return el ? el.innerText.replace('x','').trim() : null;
          });

          if (cuota && cuota !== ultimaCuota && !isNaN(parseFloat(cuota))) {
            ultimaCuota = cuota;
            console.log(`📈 NUEVA CUOTA: ${cuota}x`);
            
            // Envío a Supabase
            if (process.env.SUPABASE_URL) {
                await fetch(`${process.env.SUPABASE_URL}/rest/v1/cuotas_rushbet`, {
                  method: 'POST',
                  headers: {
                    'apikey': process.env.SUPABASE_KEY,
                    'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                  },
                  body: JSON.stringify({ cuota: parseFloat(cuota) })
                }).catch(() => {});
            }
          }
        } catch (e) {}
        await page.waitForTimeout(3000);
      }
    } else {
      console.log("❌ No se detectó el frame. Tomando captura...");
      await page.screenshot({ path: 'error.png', fullPage: true });
      throw new Error("El juego Aviator no cargó su motor Spribe.");
    }

  } catch (e) {
    console.error("❌ ERROR FINAL: " + e.message);
    await page.screenshot({ path: 'error.png', fullPage: true });
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
