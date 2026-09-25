const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();

chromium.use(stealth);

const USER = process.env.RUSHBET_USER;
const PASS = process.env.RUSHBET_PASSWORD;

(async () => {
  console.log("🚀 Iniciando Extractor Aviator Cloud...");
  
  const browser = await chromium.launch({ 
    headless: true,
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
    console.log("📡 Navegando directamente a la sala de Aviator...");
    // Esta URL fuerza a Rushbet a mostrar el Login si no estás logueado
    await page.goto('https://www.rushbet.co/?page=all-games&game=2440001', { 
      waitUntil: 'networkidle', 
      timeout: 60000 
    });

    await page.waitForTimeout(5000);

    // 🔑 MODO LOGIN AUTOMÁTICO
    console.log("🔍 Verificando si pide inicio de sesión...");
    
    // Buscamos cualquier input de tipo texto o password
    const userField = await page.$('input[name="username"], input[type="text"], #username');
    const passField = await page.$('input[name="password"], input[type="password"], #password');

    if (userField && passField) {
      console.log("✍️ Login detectado. Escribiendo credenciales...");
      await userField.fill(USER);
      await page.waitForTimeout(500);
      await passField.fill(PASS);
      await page.waitForTimeout(500);
      
      console.log("🚀 Pulsando Enter para ingresar...");
      await page.keyboard.press('Enter');
      
      // Esperar a que la página cambie tras el login
      await page.waitForTimeout(15000);
    } else {
      console.log("✅ Parece que ya estamos dentro o no pidió login inmediato.");
    }

    // 🎰 LOCALIZAR EL JUEGO (IFRAME)
    console.log("⏳ Buscando el motor de Aviator (Spribe)...");
    
    // Reintentar encontrar el iframe hasta por 30 segundos
    const frameElement = await page.waitForSelector('iframe[src*="spribe"], iframe[id*="game"]', { timeout: 40000 });
    const frame = await frameElement.contentFrame();

    if (!frame) throw new Error("No se pudo entrar al contenido del frame del juego.");

    console.log("🎯 ¡CONECTADO AL JUEGO! Transmitiendo cuotas a Supabase...");

    let ultimaCuota = "";
    const startTime = Date.now();
    const duration = 5.5 * 60 * 60 * 1000; // 5.5 horas

    while (Date.now() - startTime < duration) {
      try {
        const cuota = await frame.evaluate(() => {
          // Selectores internos de Spribe Aviator
          const el = document.querySelector('.payouts-block .bubble-multiplier, .payout, .payouts .bubble-multiplier');
          return el ? el.innerText.replace('x','').trim() : null;
        });

        if (cuota && cuota !== ultimaCuota && !isNaN(parseFloat(cuota))) {
          ultimaCuota = cuota;
          console.log(`📈 CUOTA EXTRAÍDA: ${cuota}x`);
          
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
            }).catch(e => console.error("Error Supabase:", e.message));
          }
        }
      } catch (err) {
        // Ignorar errores temporales de lectura del frame
      }
      await new Promise(r => setTimeout(r, 3000));
    }

  } catch (e) {
    console.error("❌ ERROR FINAL: " + e.message);
    await page.screenshot({ path: 'error.png', fullPage: true });
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
