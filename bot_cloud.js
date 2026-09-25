const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const USER = process.env.RUSHBET_USER;
const PASS = process.env.RUSHBET_PASSWORD;

(async () => {
  console.log("🚀 Iniciando Bot con Selector sc-ACYlI...");
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

    // 1. INTENTAR ABRIR EL MODAL DE LOGIN USANDO TU NUEVO SELECTOR
    console.log("🖱️ Intentando abrir el modal con el botón ENTRAR (.sc-ACYlI)...");
    
    // Intentamos primero con la clase que encontraste, luego con el texto
    const selectors = ['.sc-ACYlI.dZjKjM', 'button:has-text("ENTRAR")', 'button:has-text("Ingresar")', '.login-button'];
    
    let modalAbierto = false;
    for (const s of selectors) {
      try {
        console.log(`🔍 Probando selector: ${s}`);
        const btn = await page.waitForSelector(s, { timeout: 5000 });
        if (btn) {
          await btn.click({ force: true });
          console.log(`✅ Clic exitoso en selector: ${s}`);
          modalAbierto = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    await page.waitForTimeout(5000);

    // 2. LLENAR EL FORMULARIO (Usando los IDs de tu consola)
    console.log("✍️ Llenando campos de sesión...");
    
    // Si el modal no se abrió por clic, a veces Rushbet lo tiene en el DOM oculto
    // Intentamos rellenar los IDs directamente con 'force: true'
    await page.fill('#login-form-modal-email', USER, { timeout: 15000, force: true });
    await page.fill('#login-form-modal-password', PASS, { force: true });
    console.log("✅ Datos escritos en los IDs de consola.");

    // 3. CLIC EN EL BOTÓN FINAL DE ENTRAR
    console.log("🚀 Enviando formulario...");
    await page.click('#login-form-modal-submit', { force: true });

    // 4. ESPERAR Y NAVEGAR AL JUEGO
    await page.waitForTimeout(12000);
    console.log("🎰 Yendo a Aviator...");
    await page.goto('https://www.rushbet.co/?page=all-games&game=2440001', { waitUntil: 'networkidle' });
    await page.waitForTimeout(15000);

    // 5. EXTRACCIÓN
    const frames = page.frames();
    const aviatorFrame = frames.find(f => f.url().includes('spribe'));

    if (aviatorFrame) {
      console.log("🎯 ¡DENTRO DEL JUEGO! Extrayendo...");
      let ultimaCuota = "";
      while (true) {
        const cuota = await aviatorFrame.evaluate(() => {
          const el = document.querySelector('.payouts-block .bubble-multiplier, .payout');
          return el ? el.innerText.replace('x','').trim() : null;
        });
        if (cuota && cuota !== ultimaCuota) {
          ultimaCuota = cuota;
          console.log(`📈 CUOTA: ${cuota}x`);
          // Envío a Supabase
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
        await page.waitForTimeout(3000);
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
