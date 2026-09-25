const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();

chromium.use(stealth);

const USER = process.env.RUSHBET_USER;
const PASS = process.env.RUSHBET_PASSWORD;

(async () => {
  console.log("🚀 Iniciando Extractor Aviator Cloud (Versión Pro)...");
  
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
    console.log("📡 Navegando a Rushbet...");
    await page.goto('https://www.rushbet.co/?page=all-games&game=2440001', { 
      waitUntil: 'networkidle', 
      timeout: 60000 
    });

    await page.waitForTimeout(7000);

    // 🧹 LIMPIEZA DE ESTORBOS (Banners de cookies o popups)
    console.log("🧹 Limpiando avisos y banners que estorben...");
    await page.evaluate(() => {
      const selectors = ['#onetrust-consent-sdk', '.modal-backdrop', '.popover', '.cookie-banner'];
      selectors.forEach(s => {
        const el = document.querySelector(s);
        if (el) el.remove();
      });
    });

    // 🔑 PROCESO DE LOGIN REFORZADO
    console.log("🔍 Buscando campos de login...");
    const userSelector = 'input[name="username"], input[type="text"], #username';
    const passSelector = 'input[name="password"], input[type="password"], #password';

    const userField = await page.waitForSelector(userSelector, { timeout: 20000 });
    const passField = await page.waitForSelector(passSelector, { timeout: 20000 });

    if (userField && passField) {
      console.log("✍️ Escribiendo credenciales (Forzado)...");
      
      // Aseguramos el foco haciendo click primero
      await userField.click({ force: true });
      await userField.fill(USER, { force: true });
      
      await page.waitForTimeout(1000);
      
      await passField.click({ force: true });
      await passField.fill(PASS, { force: true });

      console.log("🚀 Enviando formulario...");
      await page.keyboard.press('Enter');
      
      // Espera larga para que cargue el casino tras loguearse
      await page.waitForTimeout(20000);
    }

    // 🎰 LOCALIZAR EL JUEGO (IFRAME)
    console.log("⏳ Buscando el motor de Aviator (Spribe)...");
    
    // Rushbet a veces usa un botón de "JUGAR AHORA" antes de cargar el iframe
    const playBtn = await page.$('button:has-text("Jugar ahora"), .play-button');
    if (playBtn) {
        console.log("🔘 Botón 'Jugar ahora' detectado, haciendo click...");
        await playBtn.click({ force: true });
        await page.waitForTimeout(10000);
    }

    const frameElement = await page.waitForSelector('iframe[src*="spribe"], iframe[id*="game"]', { timeout: 45000 });
    const frame = await frameElement.contentFrame();

    if (!frame) throw new Error("No se pudo acceder al contenido del iframe.");

    console.log("🎯 ¡CONECTADO AL JUEGO! Extrayendo cuotas...");

    let ultimaCuota = "";
    const startTime = Date.now();
    
    // Bucle de 5.5 horas
    while (Date.now() - startTime < 19800000) {
      try {
        const cuota = await frame.evaluate(() => {
          const el = document.querySelector('.payouts-block .bubble-multiplier, .payout, .payouts .bubble-multiplier');
          return el ? el.innerText.replace('x','').trim() : null;
        });

        if (cuota && cuota !== ultimaCuota && !isNaN(parseFloat(cuota))) {
          ultimaCuota = cuota;
          console.log(`📈 NUEVA CUOTA: ${cuota}x`);
          
          // Envío a Supabase
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
        // Ignorar errores de lectura momentáneos
      }
      await new Promise(r => setTimeout(r, 3000));
    }

  } catch (e) {
    console.error("❌ ERROR FINAL: " + e.message);
    // Tomar captura de pantalla del error para ver si el "muro" sigue ahí
    await page.screenshot({ path: 'error.png', fullPage: true });
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
