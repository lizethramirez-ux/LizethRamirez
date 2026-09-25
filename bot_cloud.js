const { chromium } = require('playwright');
const fs = require('fs');

// ==========================================
// 1. RECONSTRUCCIÓN Y SANITIZACIÓN DE SESIÓN
// ==========================================
try {
  const base64Data = process.env.AUTH_JSON_BASE64;
  
  if (!base64Data) {
    throw new Error("La variable AUTH_JSON_BASE64 no está definida en los Secrets.");
  }

  // Limpia saltos de línea (\n, \r) y espacios introducidos por GitHub Secrets
  const cleanBase64 = base64Data.replace(/\s+/g, '');
  
  // Decodifica a texto UTF-8
  const jsonString = Buffer.from(cleanBase64, 'base64').toString('utf-8');
  
  // Valida que sea un JSON válido antes de guardarlo
  JSON.parse(jsonString);
  
  fs.writeFileSync('auth.json', jsonString);
  console.log("✅ Archivo auth.json reconstruido y validado exitosamente.");
} catch (err) {
  console.error("❌ Error crítico en auth.json:", err.message);
  process.exit(1);
}

// ==========================================
// 2. EJECUCIÓN DEL BOT
// ==========================================
(async () => {
  console.log("🚀 Iniciando Obrero de GitHub Actions...");
  
  const browser = await chromium.launch({ 
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });
  
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
    // 5.5 horas de ejecución
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
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ cuota: parseFloat(cuota) })
          });
        }
      }
      // Espera 3 segundos antes de la siguiente lectura
      await new Promise(r => setTimeout(r, 3000));
    }

    await browser.close();
  } catch (e) {
    console.error("❌ Error en ejecución:", e.message);
    process.exit(1);
  }
})();
