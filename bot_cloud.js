const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const USER = process.env.RUSHBET_USER;
const PASS = process.env.RUSHBET_PASSWORD;

(async () => {
  console.log("🚀 Iniciando Bot (Rastreo Activo de Cloudflare)...");

  if (!USER || !PASS) {
    console.error("❌ ERROR: Faltan credenciales RUSHBET_USER o RUSHBET_PASSWORD.");
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

  try {
    console.log("📡 Navegando a Rushbet...");
    await page.goto('https://www.rushbet.co/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // Limpieza de overlays
    await page.evaluate(() => {
      document.querySelectorAll('[id*="onetrust"], .modal-backdrop, .cookie-banner').forEach(el => el.remove());
    });
    await page.waitForTimeout(2000);

    // 1. ABRIR MODAL
    console.log("🖱️ Abriendo modal de ingreso...");
    const btnIngresar = page.locator('.sc-ACYlI, button:has-text("Ingresar"), a:has-text("Ingresar")').first();
    await btnIngresar.click({ force: true });

    // 2. ESCRIBIR CREDENCIALES
    console.log("✍️ Escribiendo credenciales...");
    const emailSelector = '#login-form-modal-email';
    const passSelector = '#login-form-modal-password';
    
    await page.waitForSelector(emailSelector, { state: 'visible', timeout: 20000 });
    await page.click(emailSelector, { force: true });
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(USER, { delay: 100 });

    await page.click(passSelector, { force: true });
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(PASS, { delay: 100 });

    await page.screenshot({ path: '1_campos_llenos.png' });

    // 3. ENVIAR LOGIN
    console.log("🚀 Pulsando ENTRAR...");
    await page.click('#login-form-modal-submit', { force: true });

    // 4. 🛡️ RASTREO ACTIVO DE CLOUDFLARE (Revisamos segundo a segundo por 12 segundos)
    console.log("⏳ Rastreando si Cloudflare Turnstile aparece en pantalla...");
    let cfEncontrado = false;

    for (let i = 1; i <= 12; i++) {
      // Método A: Buscar elemento iframe en el DOM
      const iframeElement = await page.$('iframe[src*="cloudflare"], iframe[src*="turnstile"], iframe[src*="challenges"]');
      // Método B: Buscar url en la lista de frames del navegador
      const cfFrame = page.frames().find(f => f.url().includes('cloudflare') || f.url().includes('turnstile'));

      if (iframeElement || cfFrame) {
        console.log(`🧩 ¡CLOUDFLARE DETECTADO en el segundo ${i}! Resolviendo captcha...`);
        cfEncontrado = true;

        // Esperamos 1 segundo extra a que el widget pinte la casilla
        await page.waitForTimeout(1000);

        // Obtenemos el contenedor visual
        const targetElement = iframeElement || await page.$('iframe');
        if (targetElement) {
          const box = await targetElement.boundingBox();
          if (box) {
            // Coordenadas: 35px desde el borde izquierdo del iframe
            const clickX = box.x + 35;
            const clickY = box.y + (box.height / 2);

            console.log(`🖱️ Haciendo clic humano en X: ${Math.round(clickX)}, Y: ${Math.round(clickY)}`);
            await page.mouse.move(clickX, clickY, { steps: 10 });
            await page.mouse.click(clickX, clickY);

            console.log("⏳ Esperando 8 segundos a que Cloudflare apruebe el acceso...");
            await page.waitForTimeout(8000);
          }
        }
        break; // Salimos del bucle
      }
      await page.waitForTimeout(1000); // Esperar 1 segundo y reintentar
    }

    if (!cfEncontrado) {
      console.log("ℹ️ No se detectó la ventana de Cloudflare en los 12 segundos de espera.");
    }

    await page.screenshot({ path: '2_post_cloudflare.png' });

    // 5. NAVEGAR AL JUEGO
    console.log("🎰 Navegando a Aviator...");
    await page.goto('https://www.rushbet.co/?page=all-games&game=2440001', { 
      waitUntil: 'domcontentloaded', 
      timeout: 60000 
    });

    // 6. BUSCAR FRAME DE SPRIBE
    console.log("⏳ Conectando con el motor de Spribe Aviator...");
    let aviatorFrame = null;
    for (let i = 0; i < 25; i++) {
      const frames = page.frames();
      aviatorFrame = frames.find(f => f.url().includes('spribe') || f.url().includes('aviator'));
      if (aviatorFrame) break;
      await page.waitForTimeout(1000);
    }

    if (!aviatorFrame) {
      throw new Error("No se detectó el iframe de Spribe Aviator.");
    }

    console.log("🎯 ¡CONECTADO CON ÉXITO A AVIATOR! Iniciando extracción...");
    await page.screenshot({ path: '3_aviator_listo.png' });

    // 7. EXTRACCIÓN Y ENVÍO A SUPABASE
    let ultimaCuota = "";
    const startTime = Date.now();
    
    while (Date.now() - startTime < 19800000) { // 5.5 horas
      try {
        const cuota = await aviatorFrame.evaluate(() => {
          const el = document.querySelector('.payouts-block .bubble-multiplier, .payouts-wrapper .bubble, .bubble-multiplier, .payout');
          return el ? el.innerText.replace('x', '').trim() : null;
        });

        if (cuota && cuota !== ultimaCuota && !isNaN(parseFloat(cuota))) {
          ultimaCuota = cuota;
          console.log(`📈 NUEVA CUOTA: ${cuota}x`);

          if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
            fetch(`${process.env.SUPABASE_URL}/rest/v1/cuotas_rushbet`, {
              method: 'POST',
              headers: {
                'apikey': process.env.SUPABASE_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify({ 
                cuota: parseFloat(cuota),
                created_at: new Date().toISOString()
              })
            }).catch(err => console.error("Error Supabase:", err.message));
          }
        }
      } catch (err) {}
      await page.waitForTimeout(2500);
    }

  } catch (e) {
    console.error("❌ ERROR: " + e.message);
    await page.screenshot({ path: 'error.png', fullPage: true });
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
