const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();

chromium.use(stealth);

const USER = process.env.RUSHBET_USER;
const PASS = process.env.RUSHBET_PASSWORD;

(async () => {
  console.log("🚀 Iniciando Extractor Aviator (Modo Precisión)...");
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ 
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'es-CO',
    timezoneId: 'America/Bogota'
  });

  const page = await context.newPage();

  try {
    console.log("📡 Navegando a Rushbet...");
    await page.goto('https://www.rushbet.co/', { waitUntil: 'networkidle', timeout: 60000 });

    // 1. ABRIR EL PANEL DE LOGIN
    console.log("🖱️ Haciendo clic en el botón de Ingresar principal...");
    // Buscamos el botón de la esquina superior derecha
    await page.click('button[data-test="login-button"], .login-button, #login-button', { force: true });
    
    await page.waitForTimeout(3000);

    // 2. ESCRIBIR CREDENCIALES (Usando selectores que NO se confundan con BONUSCODE)
    console.log("✍️ Escribiendo usuario y contraseña...");
    
    // Estos son los selectores más específicos para el formulario de login de Rushbet
    const userField = await page.waitForSelector('form#login-form input[name="username"], #login-form-username', { timeout: 15000 });
    await userField.fill(USER);
    
    const passField = await page.waitForSelector('form#login-form input[name="password"], #login-form-password', { timeout: 15000 });
    await passField.fill(PASS);

    console.log("🚀 Enviando login...");
    await page.click('form#login-form button[type="submit"]', { force: true });

    // 3. ESPERAR Y NAVEGAR AL JUEGO
    console.log("⏳ Esperando inicio de sesión...");
    await page.waitForTimeout(10000);

    console.log("🎰 Yendo a la sala de Aviator...");
    await page.goto('https://www.rushbet.co/?page=all-games&game=2440001', { waitUntil: 'networkidle' });
    
    await page.waitForTimeout(15000);

    // 4. EXTRAER CUOTAS DEL IFRAME
    console.log("🎯 Buscando Iframe del juego...");
    const frameElement = await page.waitForSelector('iframe[src*="spribe"]', { timeout: 30000 });
    const frame = await frameElement.contentFrame();

    if (!frame) throw new Error("Iframe no encontrado");

    console.log("✅ ¡EXTRAYENDO DATOS!");

    let ultimaCuota = "";
    while (true) {
      const cuota = await frame.evaluate(() => {
        const el = document.querySelector('.payouts-block .bubble-multiplier, .payout');
        return el ? el.innerText.replace('x','').trim() : null;
      });

      if (cuota && cuota !== ultimaCuota) {
        ultimaCuota = cuota;
        console.log(`📈 CUOTA: ${cuota}x`);
        
        // Enviar a Supabase
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
      await new Promise(r => setTimeout(r, 3000));
    }

  } catch (e) {
    console.error("❌ ERROR: " + e.message);
    await page.screenshot({ path: 'error.png', fullPage: true });
    process.exit(1);
  }
})();
