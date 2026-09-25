const { chromium } = require('playwright');

(async () => {
  console.log("🚀 Iniciando Diagnóstico en GitHub Actions...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ 
    storageState: 'auth.json',
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();

  try {
    console.log("📡 Navegando a Rushbet...");
    await page.goto('https://www.rushbet.co/?page=all-games&game=2440001', { waitUntil: 'networkidle', timeout: 60000 });
    
    // --- DIAGNÓSTICO ---
    const titulo = await page.title();
    const urlActual = page.url();
    console.log(`📄 Título de la página: ${titulo}`);
    console.log(`🔗 URL actual: ${urlActual}`);

    if (urlActual.includes('login') || titulo.includes('Iniciar')) {
      console.log("❌ ERROR: La sesión de auth.json NO funcionó. GitHub está viendo la pantalla de login.");
      await browser.close();
      return;
    }

    console.log("⏳ Esperando 30 segundos para carga total del juego...");
    await page.waitForTimeout(30000);

    const frames = page.frames();
    console.log(`🔎 Se detectaron ${frames.length} cuadros (frames) en la página.`);

    let ultimaCuota = "";
    const startTime = Date.now();
    const duration = 10 * 60 * 1000; // Solo correremos 10 minutos para esta prueba de diagnóstico

    while (Date.now() - startTime < duration) {
      let encontradaEnEstaRonda = false;
      for (const frame of page.frames()) {
        const cuota = await frame.evaluate(() => {
          const el = document.querySelector('.payout');
          return el ? el.innerText.replace('x','').trim() : null;
        });

        if (cuota) {
          encontradaEnEstaRonda = true;
          if (cuota !== ultimaCuota) {
            ultimaCuota = cuota;
            console.log(`📈 ¡CUOTA CAPTURADA!: ${cuota}`);
            
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
      }
      
      if (!encontradaEnEstaRonda) {
        console.log("... buscando número en los frames ...");
      }
      await new Promise(r => setTimeout(r, 5000));
    }
    
    console.log("🏁 Fin de la prueba de diagnóstico.");
    await browser.close();
  } catch (e) {
    console.log("❌ Error crítico:", e.message);
    process.exit(1);
  }
})();
