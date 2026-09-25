const { chromium } = require('playwright');

// ==========================================
// 1. CARGA INTELIGENTE DE SESIÓN (BASE64 O JSON)
// ==========================================
const rawSecret = process.env.AUTH_JSON_BASE64;

if (!rawSecret || rawSecret.trim() === '') {
  console.error("❌ ERROR: La variable AUTH_JSON_BASE64 está vacía o no existe en GitHub Secrets.");
  process.exit(1);
}

let sessionState;

try {
  // Limpiamos espacios, saltos de línea y comillas dobles envolventes si las hay
  let cleanData = rawSecret.trim().replace(/^"|"$/g, '');

  if (cleanData.startsWith('{')) {
    // Si ya empieza por '{', es un JSON plano
    console.log("ℹ️ Detectado formato JSON directo...");
    sessionState = JSON.parse(cleanData);
  } else {
    // Si no, es una cadena Base64
    console.log("ℹ️ Detectado formato Base64, decodificando...");
    cleanData = cleanData.replace(/\s+/g, '');
    const jsonString = Buffer.from(cleanData, 'base64').toString('utf-8');
    sessionState = JSON.parse(jsonString);
  }

  console.log(`✅ Sesión cargada exitosamente. Total cookies: ${sessionState.cookies ? sessionState.cookies.length : 0}`);
} catch (err) {
  console.error("❌ ERROR Crítico al procesar la sesión:");
  console.error("Detalle:", err.message);
  console.error("Muestra recibida (primeros 30 chars):", rawSecret.substring(0, 30));
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
          
          if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
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
          } else {
            console.warn("⚠️ Advertencia: SUPABASE_URL o SUPABASE_KEY no están configurados.");
          }
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
