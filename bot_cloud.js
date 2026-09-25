const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const USER = process.env.RUSHBET_USER;
const PASS = process.env.RUSHBET_PASSWORD;

(async () => {
  console.log("🚀 Iniciando Bot (Anti-Cloudflare Turnstile Corrección)...");

  if (!USER || !PASS) {
    console.error("❌ ERROR: Faltan credenciales en variables de entorno.");
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
    
    // Limpieza de overlays/banners
    await page.evaluate(() => {
      document.querySelectorAll('[id*="onetrust"], .modal-backdrop, .cookie-banner').forEach(el => el.remove());
    });
    await page.waitForTimeout(2000);

    // 1. ABRIR MODAL DE LOGIN
    console.log("🖱️ Abriendo ventana de ingreso...");
    const btnIngresar = page.locator('.sc-ACYlI, button:has-text("Ingresar")').first();
    await btnIngresar.click({ force: true });
    await page.waitForTimeout(2000);

    // 2. ESCRIBIR USUARIO
    console.log("✍️ Escribiendo usuario...");
    const emailSelector = '#login-form-modal-email';
    await page.waitForSelector(emailSelector, { state: 'visible', timeout: 20000 });
    await page.click(emailSelector, { force: true });
    await page.keyboard.type(USER, { delay: 100 }); 

    // 3. ESCRIBIR CONTRASEÑA
    console.log("✍️ Escribiendo contraseña...");
    const passSelector = '#login-form-modal-password';
    await page.click(passSelector, { force: true });
    await page.keyboard.type(PASS, { delay: 100 });

    await page.screenshot({ path: '1_campos_llenos.png' });

    // 4. CLIC EN ENTRAR
    console.log("🚀 Enviando datos de inicio de sesión...");
    await page.click('#login-form-modal-submit', { force: true });

    // 🛡️ 5. SUPERAR CLOUDFLARE TURNSTILE (AQUÍ ES DONDE APARECE)
    console.log("⏳ Evaluando si Cloudflare se activó...");
    await page.waitForTimeout(3000); // Esperar a que el modal de Cloudflare renderice

    const cfIframe = page.locator('iframe[src*="cloudflare"], iframe[src*="turnstile"]').first();
    if (await cfIframe.count() > 0 && await cfIframe.isVisible()) {
      console.log("🧩 Cloudflare detectado en el Login. Calculando posición de la casilla...");
      const box = await cfIframe.boundingBox();
      
      if (box) {
        // La casilla (checkbox) está en el extremo izquierdo del iframe, NO en el centro
        const clickX = box.x + 35; 
        const clickY = box.y + (box.height / 2);

        console.log(`🖱️ Clic humano en la casilla de verificación (X: ${clickX}, Y: ${clickY})...`);
        await page.mouse.move(clickX, clickY, { steps: 10 });
        await page.mouse.click(clickX, clickY);
        
        console.log("⏳ Esperando validación de Cloudflare...");
        await page.waitForTimeout(7000); // Tiempo para que apruebe la validación
      }
    } else {
      console.log("✅ No se requirió verificación de Cloudflare.");
    }

    // 6. CONFIRMAR QUE EL MODAL SE CERRÓ
    console.log("⏳ Verificando autenticación exitosa...");
    await page.waitForSelector(emailSelector, { state: 'hidden', timeout: 20000 });
    console.log("🎉 ¡LOGIN CORRECTO! Modal cerrado.");

    // 7. IR A AVIATOR
    console.log("🎰 Navegando a Aviator...");
    await page.goto('https://www.rushbet.co/?page=all-games&game=2440001', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(10000);

    // 8. DETECTAR JUEGO Y EMPEZAR EXTRACCIÓN
    console.log("⏳ Buscando iframe del juego Spribe...");
    let aviatorFrame = null;
    for (let i = 0; i < 20; i++) {
      const frames = page.frames();
      aviatorFrame = frames.find(f => f.url().includes('spribe') || f.url().includes('aviator'));
      if (aviatorFrame) break;
      await page.waitForTimeout(1000);
    }

    if (!aviatorFrame) {
      throw new Error("No se detectó el frame del juego Aviator.");
    }

    console.log("🎯 ¡CONECTADO AL JUEGO! Extrayendo cuotas...");

    let ultimaCuota = "";
    const startTime = Date.now();
    // Límite de 5.5 horas para evitar cuelgues de GitHub Actions
    while (Date.now() - startTime < 19800000) { 
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
              body: JSON.stringify({ cuota: parseFloat(cuota) })
            }).catch(() => {});
          }
        }
      } catch (err) {}
      await page.waitForTimeout(2500);
    }

  } catch (e) {
    console.error("❌ ERROR FINAL: " + e.message);
    await page.screenshot({ path: 'error.png', fullPage: true });
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
