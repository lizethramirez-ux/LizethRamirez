const { chromium } = require('playwright');

// ==========================================
// 1. CARGAR SESIÓN DESDE MEMORIA (SIN ARCHIVOS)
// ==========================================
const base64Data = process.env.AUTH_JSON_BASE64;

if (!base64Data) {
  console.error("❌ ERROR: La variable AUTH_JSON_BASE64 no existe en GitHub Secrets.");
  process.exit(1);
}

let sessionState;
try {
  // Limpiar saltos de línea y espacios invisibles
  const cleanB64 = base64Data.replace(/\s+/g, '');
  // Decodificar Base64 a JSON
  const jsonString = Buffer.from(cleanB64, 'base64').toString('utf-8');
  sessionState = JSON.parse(jsonString);
  console.log(`✅ Sesión cargada con éxito. Cookies detectadas: ${sessionState.cookies ? sessionState.cookies.length : 0}`);
} catch (err) {
  console.error("❌ ERROR al procesar el Base64 de la sesión:", err.message);
  process.exit(1);
}

// ==========================================
// 2. EJECUCIÓN DE PLAYWRIGHT
// ==========================================
(async () => {
  console.log("🚀 Iniciando Navegador en GitHub Actions...");
  
  const browser = await chromium.launch({ 
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });
  
  // Inyección directa de la sesión
  const context = await browser.newContext({ 
    storageState: sessionState,
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    console.log("📡 Navegando a Rushbet Aviator...");
    await page.goto('https://www.rushbet.co/?page=all-games&game=2440001', { 
      waitUntil: 'networkidle', 
      timeout: 60000 
    });

    console.log("⏳ Esperando carga total del juego...");
    await page.waitForTimeout(30000);

    let ultimaCuota = "";
    const startTime = Date.now();
    const duration = 5.5 * 60 * 60 * 1000; // 5.5 Horas

    while (Date.now() - startTime < duration) {
      const frames = page.frames();
      
      for (const frame of frames) {
        const cuota = await frame.evaluate(() => {
          const el = document.querySelector('.payout');
          return el ? el.innerText.replace('x','').trim() : null;
        });

        if (cuota && cuota !== ultimaCuota) {
          ultimaCuota = cuota;
          console.log(`📈 NUEVA CUOTA DETECTADA: ${cuota}x`);
          
          await fetch(`${process.env.SUPABASE_URL}/rest/v1/cuotas_rushbet`, {
            method: 'POST',
            headers: {
              'apikey': process.env.SUPABASE_KEY,
              'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ cuota: parseFloat(cuota) })
          });
        }
      }
      await new Promise(r => setTimeout(r, 3000));
    }

    await browser.close();
  } catch (e) {
    console.error("❌ Error durante la ejecución:", e.message);
    process.exit(1);
  }
})();
