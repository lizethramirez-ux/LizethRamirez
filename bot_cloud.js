const { chromium } = require('playwright');

// ==========================================
// 1. CARGA DE SESIÓN
// ==========================================
const rawSecret = process.env.AUTH_JSON_BASE64;
if (!rawSecret) {
  console.error("❌ ERROR: AUTH_JSON_BASE64 no configurado.");
  process.exit(1);
}

let sessionState;
try {
  let cleanData = rawSecret.trim().replace(/^"|"$/g, '');
  if (cleanData.startsWith('{')) {
    sessionState = JSON.parse(cleanData);
  } else {
    cleanData = cleanData.replace(/\s+/g, '');
    sessionState = JSON.parse(Buffer.from(cleanData, 'base64').toString('utf-8'));
  }
  console.log(`✅ Sesión cargada exitosamente. Total cookies: ${sessionState.cookies ? sessionState.cookies.length : 0}`);
} catch (err) {
  console.error("❌ ERROR procesando sesión:", err.message);
  process.exit(1);
}

// ==========================================
// 2. EJECUCIÓN DE PLAYWRIGHT Y BÚSQUEDA DE IFRAME
// ==========================================
(async () => {
  console.log("🚀 Iniciando Navegador en GitHub Actions...");
  
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
    storageState: sessionState,
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'es-CO',
    timezoneId: 'America/Bogota'
  });

  const page = await context.newPage();

  try {
    console.log("📡 Navegando a Rushbet Aviator...");
    await page.goto('https://www.rushbet.co/?page=all-games&game=2440001', { 
      waitUntil: 'networkidle', 
      timeout: 60000 
    });

    console.log(`📍 URL Actual cargada: ${page.url()}`);

    // Esperar explícitamente a que aparezca al menos un iframe en el DOM
    console.log("⏳ Esperando a que el iframe del juego aparezca...");
    
    let iframeElement = null;
    try {
      iframeElement = await page.waitForSelector('iframe', { timeout: 30000 });
    } catch (e) {
      console.warn("⚠️ No se encontró selector 'iframe' en los primeros 30s. Intentando recargar...");
    }

    // Re-escaneo de frames
    await page.waitForTimeout(10000);
    const frames = page.frames();
    console.log(`🔍 Total de frames (iframes) detectados: ${frames.length}`);

    if (frames.length <= 1) {
      console.error("❌ EL JUEGO NO CARGÓ: Rushbet no abrió la ventana del juego Aviator.");
      console.error("💡 Causa probable: Las cookies expiraron o Rushbet requiere inicio de sesión fresco.");
      
      // Tomar captura del estado actual para ver qué pantalla cargó Rushbet
      const pageTitle = await page.title();
      console.log(`ℹ️ Título de la página final: "${pageTitle}"`);
      process.exit(1);
    }

    console.log("✅ Frame del juego detectado. Iniciando escaneo de cuotas...");

    let ultimaCuota = "";
    const startTime = Date.now();
    const duration = 5.5 * 60 * 60 * 1000; // 5.5 Horas

    while (Date.now() - startTime < duration) {
      const currentFrames = page.frames();
      
      for (const frame of currentFrames) {
        try {
          const cuota = await frame.evaluate(() => {
            // Selectores oficiales de Spribe Aviator
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
              } else {
                console.error(`❌ Error Supabase (${res.status}):`, await res.text());
              }
            }
          }
        } catch (err) {
          // Frame en transición
        }
      }
      await new Promise(r => setTimeout(r, 3000));
    }

    await browser.close();
  } catch (e) {
    console.error("❌ Error en ejecución:", e.message);
    process.exit(1);
  }
})();
