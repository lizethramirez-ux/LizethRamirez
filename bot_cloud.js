const { chromium } = require('playwright');
const fs = require('fs');

// ==========================================
// 1. RECONSTRUCCIÓN AUTOMÁTICA DE SESIÓN
// ==========================================
try {
    const base64Data = process.env.AUTH_JSON_BASE64;
    if (base64Data) {
        // Node.js decodifica Base64 de forma mucho más robusta que la terminal
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync('auth.json', buffer);
        console.log("✅ Archivo auth.json reconstruido exitosamente.");
    } else {
        console.error("❌ No se encontró la sesión en AUTH_JSON_BASE64.");
    }
} catch (err) {
    console.error("❌ Error decodificando la sesión:", err.message);
}

// ==========================================
// 2. EJECUCIÓN DEL BOT
// ==========================================
(async () => {
  console.log("🚀 Iniciando Obrero de GitHub Actions...");
  const browser = await chromium.launch({ headless: true });
  
  // Cargamos el contexto con el archivo que acabamos de crear
  const context = await browser.newContext({ 
    storageState: 'auth.json',
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

    console.log("⏳ Esperando carga total...");
    await page.waitForTimeout(30000);

    let ultimaCuota = "";
    const startTime = Date.now();
    const duration = 5.5 * 60 * 60 * 1000; 

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
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ cuota: parseFloat(cuota) })
          });
        }
      }
      await new Promise(r => setTimeout(r, 5000));
    }
    await browser.close();
  } catch (e) {
    console.log("❌ Error:", e.message);
    process.exit(1);
  }
})();
