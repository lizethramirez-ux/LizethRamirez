const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const USER = process.env.RUSHBET_USER;
const PASS = process.env.RUSHBET_PASSWORD;

(async () => {
  console.log("🚀 Iniciando Bot con IDs de Precisión...");
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
    
    // 1. ABRIR EL MODAL DE LOGIN
    console.log("🖱️ Abriendo modal de ingreso...");
    // Intentamos el botón superior derecho
    await page.click('button[data-test="login-button"], .login-button, button:has-text("Ingresar")', { force: true, timeout: 10000 });
    
    // 2. LLENAR FORMULARIO CON TUS IDs DE CONSOLA
    console.log("✍️ Llenando campos de sesión...");
    
    // Selector de Usuario (según tu consola: #login-form-modal-email)
    const emailField = await page.waitForSelector('#login-form-modal-email', { timeout: 15000 });
    await emailField.fill(USER);
    console.log("✅ Usuario ingresado");

    // Selector de Password (según tu consola: #login-form-modal-password)
    const passField = await page.waitForSelector('#login-form-modal-password', { timeout: 15000 });
    await passField.fill(PASS);
    console.log("✅ Contraseña ingresada");

    // 3. CLIC EN EL BOTÓN "ENTRAR" (según tu consola: #login-form-modal-submit)
    console.log("🚀 Haciendo clic en ENTRAR...");
    await page.click('#login-form-modal-submit', { force: true });

    // 4. ESPERAR Y NAVEGAR AL JUEGO
    console.log("⏳ Esperando autenticación...");
    await page.waitForTimeout(12000);

    console.log("🎰 Entrando a Aviator...");
    await page.goto('https://www.rushbet.co/?page=all-games&game=2440001', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(15000);

    // 5. DETECCIÓN Y EXTRACCIÓN
    const frames = page.frames();
    const aviatorFrame = frames.find(f => f.url().includes('spribe'));

    if (aviatorFrame) {
      console.log("🎯 ¡CONECTADO AL JUEGO! Extrayendo cuotas...");
      let ultimaCuota = "";
      const startTime = Date.now();

      while (Date.now() - startTime < 19800000) { // 5.5 horas
        try {
          const cuota = await aviatorFrame.evaluate(() => {
            const el = document.querySelector('.payouts-block .bubble-multiplier, .payout, .payouts .bubble-multiplier');
            return el ? el.innerText.replace('x','').trim() : null;
          });

          if (cuota && cuota !== ultimaCuota && !isNaN(parseFloat(cuota))) {
            ultimaCuota = cuota;
            console.log(`📈 CUOTA: ${cuota}x`);
            
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
        await new Promise(r => setTimeout(r, 3000));
      }
    } else {
      throw new Error("No se detectó el frame del juego Aviator");
    }

  } catch (e) {
    console.error("❌ ERROR FINAL: " + e.message);
    await page.screenshot({ path: 'error.png', fullPage: true });
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
