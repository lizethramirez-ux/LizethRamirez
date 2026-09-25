const { chromium } = require('playwright');

// ==========================================
// 1. CARGA INTELIGENTE DE SESIÓN
// ==========================================
const rawSecret = process.env.AUTH_JSON_BASE64;
if (!rawSecret) {
  console.error("❌ ERROR: La variable AUTH_JSON_BASE64 no existe en Secrets.");
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
  console.error("❌ ERROR crítico procesando sesión:", err.message);
  process.exit(1);
}

// ==========================================
// 2. EJECUCIÓN DEL BOT CON ANTI-BLOQUEO
// ==========================================
(async () => {
  console.log("🚀 Iniciando Navegador en GitHub Actions...");
  
  const browser = await chromium.launch({ 
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--lang=es-CO,es'
    ]
  });
  
  const context = await browser.newContext({ 
    storageState: sessionState,
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'es-CO',
    timezoneId: 'America/Bogota'
  });

  // Ocultar que es un navegador automatizado
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  try {
    console.log("📡 Navegando a Rushbet Aviator...");
    const response = await page.goto('https://www.rushbet.co/?page=all-games&game=2440001', { 
      waitUntil: 'domcontentloaded', 
      timeout: 60000 
    });

    console.log(`ℹ️ Estado HTTP de respuesta: ${response ? response.status() : 'Sin respuesta'}`);
    const pageTitle = await page.title();
    console.log(`ℹ️ Título de la página: "${pageTitle}"`);

    const content = await page.content();

    // Verificación de bloqueos comunes
    if (content.includes("Cloudflare") || content.includes("Attention Required") || content.includes("Access Denied")) {
      console.error("❌ BLOQUEO DETECTADO: Rushbet / Cloudflare bloqueó la IP de GitHub Actions.");
      process.exit(1);
    }

    console.log("⏳ Esperando 25 segundos a que cargue el juego Spribe...");
    await page.waitForTimeout(25000);

    const initialFrames = page.frames();
    console.log(`🔍 Total de frames (iframes) detectados: ${initialFrames.length}`);

    let ultimaCuota = "";
    const startTime = Date.now();
    const duration = 5.5 * 60 * 60 * 1000; // 5.5 Horas

    console.log("🔄 Iniciando ciclo de escaneo de cuotas...");

    while (Date.now() - startTime < duration) {
      const currentFrames = page.frames();
      
      for (const frame of currentFrames) {
        try {
          // Evaluar múltiples selectores posibles dentro del iframe de Spribe Aviator
          const cuota = await frame.evaluate(() => {
            // Selector 1: .payout
            let el = document.querySelector('.payout');
            if (el && el.innerText) return el.innerText.replace('x','').trim();

            // Selector 2: Elemento de historial superior de Spribe (.bubble-multiplier)
            el = document.querySelector('.payouts-block .bubble-multiplier, .payouts .bubble-multiplier');
            if (el && el.innerText) return el.innerText.replace('x','').trim();

            return null;
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
          // Frame no accesible en este ciclo
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
