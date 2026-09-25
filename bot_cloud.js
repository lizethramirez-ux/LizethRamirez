const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();

chromium.use(stealth);

const USER = process.env.RUSHBET_USER;
const PASS = process.env.RUSHBET_PASSWORD;

(async () => {
  console.log("🚀 Iniciando Bot con modo Super-Stealth...");
  
  const browser = await chromium.launch({ 
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--use-fake-ui-for-media-stream',
      '--window-size=1920,1080'
    ]
  });

  const context = await browser.newContext({ 
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'es-CO',
    timezoneId: 'America/Bogota'
  });

  const page = await context.newPage();

  try {
    // Vamos directamente al juego, esto debería disparar el modal de login
    console.log("📡 Navegando directamente al enlace del juego Aviator...");
    await page.goto('https://www.rushbet.co/?page=all-games&game=2440001', { 
      waitUntil: 'networkidle', 
      timeout: 90000 
    });

    console.log("📍 URL actual: " + page.url());

    // Si la URL no contiene "game", es que nos redirigió al login o nos bloqueó
    if (page.url().includes('login') || !page.url().includes('game')) {
        console.log("🔑 Detectada necesidad de Login...");
        
        // Intentar encontrar los campos de texto directamente
        const userInput = await page.waitForSelector('input[name="username"], input[id*="user"], .login-input', { timeout: 15000 });
        await userInput.fill(USER);
        
        const passInput = await page.waitForSelector('input[name="password"], input[type="password"]', { timeout: 15000 });
        await passInput.fill(PASS);
        
        console.log("🚀 Enviando credenciales...");
        await page.keyboard.press('Enter');
        
        await page.waitForTimeout(10000); // Esperar a que procese
    }

    // Intentar buscar el juego
    console.log("⏳ Buscando el marco del juego Aviator...");
    const frameElement = await page.waitForSelector('iframe[src*="spribe"]', { timeout: 30000 });
    const frame = await frameElement.contentFrame();

    if (frame) {
        console.log("✅ ¡JUEGO CARGADO! Iniciando extracción...");
        // ... (resto del código de extracción de cuotas)
    } else {
        throw new Error("No se pudo acceder al contenido del iframe.");
    }

  } catch (e) {
    console.error("❌ Error detectado: " + e.message);
    await page.screenshot({ path: 'error.png', fullPage: true });
    process.exit(1);
  }
})();
