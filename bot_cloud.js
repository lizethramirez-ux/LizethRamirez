const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const USER = process.env.RUSHBET_USER;
const PASS = process.env.RUSHBET_PASSWORD;

(async () => {
  console.log("🚀 Iniciando Bot (Versión Llave Maestra)...");
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
    await page.goto('https://www.rushbet.co/', { waitUntil: 'networkidle', timeout: 60000 });
    
    // 1. LIMPIEZA TOTAL DE BANNERS (Esto es vital)
    await page.evaluate(() => {
      document.querySelectorAll('[id*="onetrust"], .modal-backdrop, .cookie-banner').forEach(el => el.remove());
    });
    await page.waitForTimeout(3000);

    // 2. FORZAR APERTURA DEL APARTADO DE LOGIN
    console.log("🖱️ Intentando abrir apartado de login...");
    
    // Intentamos por Clic de Playwright
    const loginBtn = page.locator('.sc-ACYlI, [data-test="login-button"], button:has-text("Ingresar")').first();
    await loginBtn.click({ force: true }).catch(() => console.log("⚠️ Clic normal falló, intentando por JS..."));

    // Intentamos por Inyección de JavaScript (Este casi nunca falla)
    await page.evaluate(() => {
      const btn = document.querySelector('.sc-ACYlI') || document.querySelector('[data-test="login-button"]');
      if (btn) btn.click();
    });

    // 3. ESPERAR A QUE APAREZCA EL APARTADO
    console.log("⏳ Esperando a que los cuadros de texto aparezcan...");
    try {
      await page.waitForSelector('#login-form-modal-email', { state: 'visible', timeout: 15000 });
    } catch (e) {
      console.log("⚠️ El apartado no abrió. Intentando forzar URL de login...");
      await page.goto('https://www.rushbet.co/?login=true', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#login-form-modal-email', { state: 'visible', timeout: 15000 });
    }

    // 4. DIGITAR DATOS (Modo Humano)
    console.log("✍️ Escribiendo usuario y clave...");
    await page.fill('#login-form-modal-email', USER, { force: true });
    await page.waitForTimeout(500);
    await page.fill('#login-form-modal-password', PASS, { force: true });
    
    // 5. CLIC EN EL SEGUNDO BOTÓN DE ENTRAR (EL QUE ENVÍA LOS DATOS)
    console.log("🚀 Pulsando el segundo botón: ENTRAR (#login-form-modal-submit)...");
    await page.click('#login-form-modal-submit', { force: true });

    // 6. NAVEGAR AL JUEGO
    console.log("⏳ Procesando entrada al casino...");
    await page.waitForTimeout(15000);
    await page.goto('https://www.rushbet.co/?page=all-games&game=2440001', { waitUntil: 'networkidle' });
    
    // Cierre de anuncio si aparece
    try {
      await page.locator('svg rect').first().click({ timeout: 5000 }).catch(() => {});
    } catch(e) {}

    // 7. DETECCIÓN DEL JUEGO
    await page.waitForTimeout(10000);
    const frames = page.frames();
    const aviatorFrame = frames.find(f => f.url().includes('spribe'));

    if (aviatorFrame) {
        console.log("🎯 ¡BOT CONECTADO AL AVIATOR!");
        let ultimaCuota = "";
        while (true) {
            const cuota = await aviatorFrame.evaluate(() => {
                const el = document.querySelector('.payouts-block .bubble-multiplier, .payout');
                return el ? el.innerText.replace('x','').trim() : null;
            });
            if (cuota && cuota !== ultimaCuota) {
                ultimaCuota = cuota;
                console.log(`📈 CUOTA: ${cuota}x`);
                // Envío a Supabase...
                if (process.env.SUPABASE_URL) {
                  await fetch(`${process.env.SUPABASE_URL}/rest/v1/cuotas_rushbet`, {
                    method: 'POST',
                    headers: { 'apikey': process.env.SUPABASE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cuota: parseFloat(cuota) })
                  }).catch(() => {});
                }
            }
            await page.waitForTimeout(3000);
        }
    } else {
        throw new Error("No se pudo detectar el motor del juego.");
    }

  } catch (e) {
    console.error("❌ ERROR: " + e.message);
    await page.screenshot({ path: 'error.png', fullPage: true });
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
