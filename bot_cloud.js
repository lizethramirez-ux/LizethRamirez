const { chromium } = require('playwright');

(async () => {
  console.log("🚀 Iniciando Obrero de GitHub Actions...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'auth.json' });
  const page = await context.newPage();

  try {
    await page.goto('https://www.rushbet.co/?page=all-games&game=2440001', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(20000); 

    let ultimaCuota = "";
    const startTime = Date.now();
    const duration = 5.5 * 60 * 60 * 1000; // Trabajar por 5 horas y media

    while (Date.now() - startTime < duration) {
      const frames = page.frames();
      for (const frame of frames) {
        const cuota = await frame.evaluate(() => {
          const el = document.querySelector('.payout');
          return el ? el.innerText.replace('x','').trim() : null;
        });

        if (cuota && cuota !== ultimaCuota) {
          ultimaCuota = cuota;
          console.log(`📈 Nueva cuota detectada: ${cuota}`);
          
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
      await new Promise(r => setTimeout(r, 3000));
    }
    await browser.close();
  } catch (e) {
    console.log("❌ Error:", e.message);
    process.exit(1);
  }
})();
