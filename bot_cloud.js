const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const USER = process.env.RUSHBET_USER;
const PASS = process.env.RUSHBET_PASSWORD;

(async () => {
  console.log("🚀 Iniciando Bot (Modo Escritura Humana)...");
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
    
    // 1. ABRIR MODAL
    console.log("🖱️ Abriendo modal de ingreso...");
    await page.click('.sc-ACYlI.dZjKjM', { force: true, timeout: 20000 });
    
    // Espera obligatoria para que el modal termine su animación
    await page.waitForTimeout(5000);

    // 2. ESCRIBIR USUARIO (Letra por letra)
    console.log("✍️ Escribiendo usuario...");
    const emailSelector = '#login-form-modal-email';
    await page.waitForSelector(emailSelector, { state: 'visible', timeout: 20000 });
    
    // Hacemos clic primero para asegurar el foco
    await page.click(emailSelector);
    // Borramos lo que haya y escribimos lento
    await page.fill(emailSelector, ''); 
    await page.type(emailSelector, USER, { delay: 150 }); 
    console.log("✅ Usuario escrito.");

    // 3. ESCRIBIR CONTRASEÑA
    console.log("✍️ Escribiendo contraseña...");
    const passSelector = '#login-form-modal-password';
    await page.click(passSelector);
    await page.fill(passSelector, '');
    await page.type(passSelector, PASS, { delay: 150 });
    console.log("✅ Contraseña escrita.");

    // 4. CLIC EN ENTRAR
    console.log("🚀 Pulsando botón ENTRAR...");
    await page.click('#login-form-modal-submit', { force: true });

    // 5. ESPERAR INICIO DE SESIÓN
    console.log("⏳ Procesando login...");
    await page.waitForTimeout(15000);

    // 6. IR AL JUEGO
    console.log("🎰 Navegando a Aviator...");
    await page.goto('https://www.rushbet.co/?page=all-games&game=2440001', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(15000);

    // 7. EXTRAER DATOS
    const frames = page.frames();
    const aviatorFrame = frames.find(f => f.url().includes('spribe'));

    if (aviatorFrame) {
        console.log("🎯 ¡CONECTADO! Extrayendo cuotas...");
        let ultimaCuota = "";
        const startTime = Date.now();
        while (Date.now() - startTime < 19800000) {
            try {
                const cuota = await aviatorFrame.evaluate(() => {
                    const el = document.querySelector('.payouts-block .bubble-multiplier, .payout');
                    return el ? el.innerText.replace('x','').trim() : null;
                });
                if (cuota && cuota !== ultimaCuota && !isNaN(parseFloat(cuota))) {
                    ultimaCuota = cuota;
                    console.log(`📈 CUOTA: ${cuota}x`);
                    
                    // Supabase...
                    if (process.env.SUPABASE_URL) {
                      await fetch(`${process.env.SUPABASE_URL}/rest/v1/cuotas_rushbet`, {
                        method: 'POST',
                        headers: {
                          'apikey': process.env.SUPABASE_KEY,
                          'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
                          'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ cuota: parseFloat(cuota) })
                      }).catch(() => {});
                    }
                }
            } catch (e) {}
            await page.waitForTimeout(3000);
        }
    } else {
        throw new Error("No se detectó el frame del juego Aviator. ¿El login falló?");
    }

  } catch (e) {
    console.error("❌ ERROR FINAL: " + e.message);
    await page.screenshot({ path: 'error.png', fullPage: true });
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
