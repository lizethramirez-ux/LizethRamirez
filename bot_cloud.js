const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();

// Activar el plugin de sigilo anti-bot
chromium.use(stealth);

const USER = process.env.RUSHBET_USER;
const PASS = process.env.RUSHBET_PASSWORD;

if (!USER || !PASS) {
  console.error("❌ ERROR: Debes configurar RUSHBET_USER y RUSHBET_PASSWORD en Secrets.");
  process.exit(1);
}

(async () => {
  console.log("🚀 Iniciando Obrero Cloud con Anti-Detección Stealth...");
  
  const browser = await chromium.launch({ 
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--lang=es-CO,es'
    ]
  });

  const context = await browser.newContext({ 
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'es-CO',
    timezoneId: 'America/Bogota'
  });

  const page = await context.newPage();

  try {
    console.log("📡 Navegando a la página principal de Rushbet...");
    await page.goto('https://www.rushbet.co/', { waitUntil: 'networkidle', timeout: 60000 });

    console.log("🔑 Buscando botón de inicio de sesión...");
    
    // Esperar y hacer clic en el botón "Ingresar"
    const loginBtn = await page.waitForSelector('button:has-text("Ingresar"), .login-button, [data-test="login-button"]', { timeout: 20000 });
    await loginBtn.click();
    await page.waitForTimeout(2000);

    console.log("✍️ Escribiendo credenciales con ritmo humano...");
    
    // Selector de campos de texto
    const userInput = await page.waitForSelector('input[type="text"], input[name="username"], input[id*="user"]', { timeout: 10000 });
    await userInput.focus();
    await page.keyboard.type(USER, { delay: 100 }); // Escribe simulando tecleo de persona

    const passInput = await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    await passInput.focus();
    await page.keyboard.type(PASS, { delay: 120 });

    console.log("🚀 Enviando formulario de Login...");
    const submitBtn = await page.waitForSelector('button[type="submit"], button:has-text("Iniciar Sesión")', { timeout: 10000 });
    await submitBtn.click();

    console.log("⏳ Esperando autenticación exitosa...");
    await page.waitForTimeout(10000);

    console.log("🎰 Navegando al juego Spribe Aviator...");
    await page.goto('https://www.rushbet.co/?page=all-games&game=2440001', { waitUntil: 'networkidle', timeout: 60000 });

    console.log("⏳ Esperando carga del marco del juego...");
    await page.waitForTimeout(20000);

    const frames = page.frames();
    console.log(`🔍 Total de frames detectados: ${frames.length}`);

    if (frames.length <= 1) {
      console.log("📸 Tomando captura para diagnosticar si el juego abrió...");
      await page.screenshot({ path: 'error.png', fullPage: true });
      throw new Error("El juego no cargó su iframe después del login.");
    }

    console.log("✅ LOGIN EXITOSO Y JUEGO CARGADO. Monitoreando cuotas...");

    let ultimaCuota = "";
    const startTime = Date.now();
    const duration = 5.5 * 60 * 60 * 1000; // 5.5 Horas

    while (Date.now() - startTime < duration) {
      const currentFrames = page.frames();
      
      for (const frame of currentFrames) {
        try {
          const cuota = await frame.evaluate(() => {
            const el = document.querySelector('.payouts-block .bubble-multiplier, .payout, .payouts .bubble-multiplier');
            return el ? el.innerText.replace('x','').trim() : null;
          });

          if (cuota && cuota !== ultimaCuota && !isNaN(parseFloat(cuota))) {
            ultimaCuota = cuota;
            console.log(`📈 NUEVA CUOTA DETECTADA: ${cuota}x`);
            
            if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
              const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/cuotas_rushbet`, {
                method: 'POST',
                headers: {
                  'apikey': process.env.SUPABASE_KEY,
                  'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
                  'Content-Type': 'application/json',
                  'Prefer': 'return=minimal'
                },
                body: JSON.stringify({ cuota: parseFloat(cuota) })
              });

              if (res.ok) {
                console.log(`✅ Registrada en Supabase: ${cuota}x`);
              }
            }
          }
        } catch (err) {
          // Ignorar frames no accesibles
        }
      }
      await new Promise(r => setTimeout(r, 3000));
    }

    await browser.close();
  } catch (e) {
    console.error("❌ Error en ejecución:", e.message);
    await page.screenshot({ path: 'error.png', fullPage: true });
    process.exit(1);
  }
})();
