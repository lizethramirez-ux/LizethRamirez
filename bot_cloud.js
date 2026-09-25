const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const USER = process.env.RUSHBET_USER;
const PASS = process.env.RUSHBET_PASSWORD;

(async () => {
  console.log("🚀 Iniciando Bot Versión 5.0 (Bypass Cloudflare)...");
  const browser = await chromium.launch({ 
    headless: true, // Puedes probar 'false' si tuvieras interfaz, pero en GH es 'true'
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });
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
    
    // --- 🛡️ SECCIÓN ANTI-CLOUDFLARE ---
    console.log("🛡️ Verificando si aparece reto de Cloudflare...");
    await page.waitForTimeout(5000);

    // Buscamos el iframe de Cloudflare Turnstile
    const cfFrame = page.frames().find(f => f.url().includes('cloudflare') || f.name().includes('turnstile'));
    
    if (cfFrame || await page.isVisible('iframe[src*="cloudflare"]')) {
        console.log("🧩 Reto detectado. Intentando hacer clic en el checkbox...");
        
        // Tomamos las coordenadas del iframe para hacer un clic real
        const box = await page.locator('iframe[src*="cloudflare"]').boundingBox();
        if (box) {
            // Hacemos clic en el centro del widget de Cloudflare
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            console.log("✅ Clic enviado al widget de seguridad.");
            await page.waitForTimeout(10000); // Esperar a que pase el reto
        }
    }

    // --- 🔑 PROCESO DE LOGIN ---
    console.log("🖱️ Abriendo modal de ingreso...");
    await page.click('.sc-ACYlI.dZjKjM', { force: true, timeout: 15000 });
    await page.waitForTimeout(3000);

    console.log("✍️ Llenando credenciales...");
    await page.fill('#login-form-modal-email', USER, { force: true });
    await page.fill('#login-form-modal-password', PASS, { force: true });
    await page.click('#login-form-modal-submit', { force: true });

    console.log("🎰 Entrando a Aviator...");
    await page.goto('https://www.rushbet.co/?page=all-games&game=2440001', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(15000);

    // --- 🎯 EXTRACCIÓN ---
    const frames = page.frames();
    const aviatorFrame = frames.find(f => f.url().includes('spribe'));

    if (aviatorFrame) {
      console.log("🎯 ¡CONECTADO AL JUEGO!");
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
      throw new Error("El motor Spribe no cargó. Posible bloqueo persistente.");
    }

  } catch (e) {
    console.error("❌ ERROR: " + e.message);
    await page.screenshot({ path: 'error.png', fullPage: true });
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
