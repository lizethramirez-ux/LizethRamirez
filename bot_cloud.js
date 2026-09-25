const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const USER = process.env.RUSHBET_USER;
const PASS = process.env.RUSHBET_PASSWORD;

(async () => {
  console.log("🚀 Iniciando Bot (Modo Verificación de Login)...");
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

    // 1. ABRIR APARTADO (Usando tu selector sc-ACYlI)
    console.log("🖱️ Abriendo apartado de login...");
    await page.click('.sc-ACYlI.dZjKjM', { force: true });
    await page.waitForTimeout(4000);

    // 2. ESCRIBIR USUARIO
    console.log("✍️ Escribiendo datos letra por letra...");
    await page.click('#login-form-modal-email');
    await page.keyboard.type(USER, { delay: 120 });
    await page.waitForTimeout(500);

    // 3. ESCRIBIR CONTRASEÑA
    await page.click('#login-form-modal-password');
    await page.keyboard.type(PASS, { delay: 120 });
    await page.waitForTimeout(1000);

    // 4. CLIC EN EL BOTÓN "ENTRAR" (ID de tu consola)
    console.log("🚀 Presionando ENTRAR...");
    await page.click('#login-form-modal-submit', { force: true });

    // 5. VERIFICACIÓN: Esperar a que el cuadro de login DESAPAREZCA
    console.log("⏳ Verificando si el login fue exitoso...");
    try {
        // Esperamos que el modal se oculte. Si no se oculta, es que el login falló.
        await page.waitForSelector('#login-form-modal-email', { state: 'hidden', timeout: 15000 });
        console.log("✅ Login completado con éxito.");
    } catch (e) {
        console.log("⚠️ El login parece no haber respondido, intentando un clic extra...");
        await page.keyboard.press('Enter');
        await page.waitForTimeout(10000);
    }

    // 6. IR AL JUEGO
    console.log("🎰 Navegando al juego Aviator...");
    await page.goto('https://www.rushbet.co/?page=all-games&game=2440001', { waitUntil: 'networkidle' });
    await page.waitForTimeout(15000);

    // 7. EXTRACCIÓN (Tu código de frames)
    const frames = page.frames();
    const aviatorFrame = frames.find(f => f.url().includes('spribe'));

    if (aviatorFrame) {
      console.log("🎯 ¡BOT CONECTADO AL JUEGO!");
      let ultimaCuota = "";
      const startTime = Date.now();
      while (Date.now() - startTime < 19800000) {
        const cuota = await aviatorFrame.evaluate(() => {
          const el = document.querySelector('.payouts-block .bubble-multiplier, .payout');
          return el ? el.innerText.replace('x','').trim() : null;
        });
        if (cuota && cuota !== ultimaCuota) {
          ultimaCuota = cuota;
          console.log(`📈 CUOTA: ${cuota}x`);
          // Fetch a Supabase...
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
        // Si llegamos aquí y no hay frame, tomamos otra foto para ver por qué
        await page.screenshot({ path: 'error.png', fullPage: true });
        throw new Error("El juego no cargó. ¿Login rechazado?");
    }

  } catch (e) {
    console.error("❌ ERROR: " + e.message);
    await page.screenshot({ path: 'error.png', fullPage: true });
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
