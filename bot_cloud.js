const { chromium } = require('playwright');
const fs = require('fs');

const rawSecret = process.env.AUTH_JSON_BASE64;

let sessionState;
try {
  let cleanData = rawSecret.trim().replace(/^"|"$/g, '');
  const jsonString = cleanData.startsWith('{') ? cleanData : Buffer.from(cleanData.replace(/\s+/g, ''), 'base64').toString('utf-8');
  sessionState = JSON.parse(jsonString);
} catch (err) {
  process.exit(1);
}

(async () => {
  console.log("🚀 Iniciando Navegador...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ 
    storageState: sessionState,
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    console.log("📡 Navegando a Rushbet Aviator...");
    await page.goto('https://www.rushbet.co/?page=all-games&game=2440001', { waitUntil: 'networkidle', timeout: 60000 });

    await page.waitForTimeout(15000); // Esperar a que carguen los scripts internos

    // 🔍 PRUEBA DE FUEGO: ¿Estamos logueados?
    const loginButton = await page.isVisible('button:has-text("Ingresar"), .login-button');
    if (loginButton) {
      console.error("❌ LA SESIÓN FALLÓ: Rushbet muestra el botón de 'Ingresar'. La IP de GitHub fue rechazada o las cookies expiraron.");
    }

    const frames = page.frames();
    console.log(`🔍 Frames detectados: ${frames.length}`);

    if (frames.length <= 1) {
      console.log("📸 Tomando captura de pantalla para diagnóstico...");
      await page.screenshot({ path: 'error.png', fullPage: true });
      console.error("❌ El juego no cargó. Revisa la pestaña 'Artifacts' en GitHub Actions para ver la foto.");
      process.exit(1);
    }

    console.log("✅ JUEGO DETECTADO. Monitoreando...");

    let ultimaCuota = "";
    while (true) {
      for (const frame of page.frames()) {
        const cuota = await frame.evaluate(() => {
          const el = document.querySelector('.payouts-block .bubble-multiplier, .payout, .payouts .bubble-multiplier');
          return el ? el.innerText.replace('x','').trim() : null;
        });

        if (cuota && cuota !== ultimaCuota && !isNaN(parseFloat(cuota))) {
          ultimaCuota = cuota;
          console.log(`📈 NUEVA CUOTA: ${cuota}x`);
          await fetch(`${process.env.SUPABASE_URL}/rest/v1/cuotas_rushbet`, {
            method: 'POST',
            headers: { 'apikey': process.env.SUPABASE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ cuota: parseFloat(cuota) })
          });
        }
      }
      await new Promise(r => setTimeout(r, 3000));
    }
  } catch (e) {
    await page.screenshot({ path: 'error.png' });
    process.exit(1);
  }
})();
