const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const USER = process.env.RUSHBET_USER;
const PASS = process.env.RUSHBET_PASSWORD;

(async () => {
  console.log("🚀 Iniciando Bot (Modo Anti-Cloudflare Turnstile)...");

  if (!USER || !PASS) {
    console.error("❌ ERROR: Faltan credenciales.");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ 
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-CO',
    timezoneId: 'America/Bogota'
  });
  const page = await context.newPage();

  try {
    console.log("📡 Navegando a Rushbet...");
    await page.goto('https://www.rushbet.co/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    // 🛡️ BLOQUE: SUPERAR CLOUDFLARE
    console.log("🛡️ Buscando retos de seguridad...");
    const cfFrame = page.frames().find(f => f.url().includes('cloudflare') || f.url().includes('turnstile'));
    
    if (cfFrame || await page.isVisible('iframe[src*="cloudflare"]')) {
      console.log("🧩 Cloudflare detectado. Intentando clic humano en el reto...");
      const box = await page.locator('iframe[src*="cloudflare"]').boundingBox();
      if (box) {
        // Movimiento de mouse simulado al centro del cuadro
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
        await page.mouse.down();
        await page.waitForTimeout(100);
        await page.mouse.up();
        console.log("✅ Clic enviado a Cloudflare.");
        await page.waitForTimeout(10000); // Esperar validación
      }
    }

    // 1. ABRIR MODAL DE LOGIN
    console.log("🖱️ Abriendo ventana de ingreso...");
    const btnIngresar = page.locator('.sc-ACYlI, button:has-text("Ingresar")').first();
    await btnIngresar.click({ force: true });
    await page.waitForTimeout(3000);

    // 2. ESCRIBIR USUARIO
    const emailSelector = '#login-form-modal-email';
    await page.waitForSelector(emailSelector, { state: 'visible', timeout: 20000 });
    await page.click(emailSelector, { force: true });
    await page.keyboard.type(USER, { delay: 120 }); 

    // 3. ESCRIBIR CONTRASEÑA
    const passSelector = '#login-form-modal-password';
    await page.click(passSelector, { force: true });
    await page.keyboard.type(PASS, { delay: 120 });

    await page.screenshot({ path: '1_campos_llenos.png' });

    // 4. CLIC EN ENTRAR
    console.log("🚀 Enviando datos de inicio de sesión...");
    await page.click('#login-form-modal-submit', { force: true });

    // 5. CONFIRMAR LOGIN EXITOSO
    await page.waitForTimeout(10000);
    console.log("⏳ Verificando si entramos...");

    // 6. IR A AVIATOR
    await page.goto('https://www.rushbet.co/?page=all-games&game=2440001', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(15000);

    // 7. DETECTAR JUEGO Y EMPEZAR EXTRACCIÓN
    const aviatorFrame = page.frames().find(f => f.url().includes('spribe') || f.url().includes('aviator'));

    if (!aviatorFrame) {
      throw new Error("No se detectó el frame del juego Aviator.");
    }

    console.log("🎯 ¡CONECTADO AL JUEGO!");

    let ultimaCuota = "";
    while (true) {
      try {
        const cuota = await aviatorFrame.evaluate(() => {
          const el = document.querySelector('.payouts-block .bubble-multiplier, .payout');
          return el ? el.innerText.replace('x', '').trim() : null;
        });

        if (cuota && cuota !== ultimaCuota) {
          ultimaCuota = cuota;
          console.log(`📈 CUOTA: ${cuota}x`);
          // Supabase call...
          if (process.env.SUPABASE_URL) {
            fetch(`${process.env.SUPABASE_URL}/rest/v1/cuotas_rushbet`, {
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
      } catch (err) {}
      await page.waitForTimeout(3000);
    }

  } catch (e) {
    console.error("❌ ERROR: " + e.message);
    await page.screenshot({ path: 'error.png', fullPage: true });
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
