const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const USER = process.env.RUSHBET_USER;
const PASS = process.env.RUSHBET_PASSWORD;

(async () => {
  console.log("🚀 Iniciando Bot (Modo Escritura React Nativa)...");

  // VALIDACIÓN DE SECRETOS
  if (!USER || !PASS) {
    console.error("❌ ERROR CRÍTICO: Las variables RUSHBET_USER o RUSHBET_PASSWORD están vacías en GitHub Secrets.");
    process.exit(1);
  }
  console.log(`🔑 Credenciales detectadas - Usuario: ${USER.substring(0, 3)}*** (Longitud: ${USER.length} chars)`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ 
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-CO',
    timezoneId: 'America/Bogota'
  });
  const page = await context.newPage();

  try {
    console.log("📡 Navegando a Rushbet...");
    await page.goto('https://www.rushbet.co/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // Limpieza preventiva
    await page.evaluate(() => {
      document.querySelectorAll('[id*="onetrust"], .modal-backdrop, .cookie-banner').forEach(el => el.remove());
    });
    await page.waitForTimeout(2000);

    // 1. ABRIR MODAL DE LOGIN
    console.log("🖱️ Abriendo ventana de ingreso...");
    const btnIngresar = page.locator('.sc-ACYlI, button:has-text("Ingresar"), a:has-text("Ingresar")').first();
    await btnIngresar.click({ force: true });

    // 2. ESCRIBIR USUARIO (Modo Teclado Físico para React)
    console.log("✍️ Escribiendo usuario...");
    const emailSelector = '#login-form-modal-email';
    await page.waitForSelector(emailSelector, { state: 'visible', timeout: 20000 });
    
    await page.click(emailSelector, { force: true });
    await page.focus(emailSelector);
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(USER, { delay: 100 }); 
    console.log("✅ Usuario digitado.");

    // 3. ESCRIBIR CONTRASEÑA
    console.log("✍️ Escribiendo contraseña...");
    const passSelector = '#login-form-modal-password';
    await page.click(passSelector, { force: true });
    await page.focus(passSelector);
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(PASS, { delay: 100 });
    console.log("✅ Contraseña digitada.");

    // Captura intermedia para confirmar que los campos se llenaron
    await page.screenshot({ path: '1_campos_llenos.png' });

    // 4. CLIC EN ENTRAR
    console.log("🚀 Enviando datos de inicio de sesión...");
    await page.click('#login-form-modal-submit', { force: true });

    // 5. CONFIRMAR LOGIN EXITOSO (Esperar a que el modal desaparezca)
    console.log("⏳ Verificando si el modal se cierra...");
    try {
      await page.waitForSelector(emailSelector, { state: 'hidden', timeout: 15000 });
      console.log("🎉 ¡LOGIN EXITOSO! El modal se cerró correctamente.");
    } catch (e) {
      throw new Error("❌ EL LOGIN FALLÓ: Los datos de usuario/clave son incorrectos o el botón 'Entrar' no procesó la solicitud.");
    }

    // 6. IR A AVIATOR
    console.log("🎰 Navegando a Aviator...");
    await page.goto('https://www.rushbet.co/?page=all-games&game=2440001', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(10000);

    // 7. DETECTAR IFRAME
    console.log("⏳ Buscando iframe de Spribe Aviator...");
    let aviatorFrame = null;
    for (let i = 0; i < 20; i++) {
      const frames = page.frames();
      aviatorFrame = frames.find(f => f.url().includes('spribe') || f.url().includes('aviator'));
      if (aviatorFrame) break;
      await page.waitForTimeout(1000);
    }

    if (!aviatorFrame) {
      throw new Error("No se detectó el frame del juego Aviator.");
    }

    console.log("🎯 ¡CONECTADO AL JUEGO! Iniciando lectura de cuotas...");

    // 8. BUCLE DE LECTURA
    let ultimaCuota = "";
    const startTime = Date.now();
    while (Date.now() - startTime < 19800000) { // 5.5 horas
      try {
        const cuota = await aviatorFrame.evaluate(() => {
          const el = document.querySelector('.payouts-block .bubble-multiplier, .payouts-wrapper .bubble, .bubble-multiplier, .payout');
          return el ? el.innerText.replace('x', '').trim() : null;
        });

        if (cuota && cuota !== ultimaCuota && !isNaN(parseFloat(cuota))) {
          ultimaCuota = cuota;
          console.log(`📈 NUEVA CUOTA: ${cuota}x`);

          if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
            fetch(`${process.env.SUPABASE_URL}/rest/v1/cuotas_rushbet`, {
              method: 'POST',
              headers: {
                'apikey': process.env.SUPABASE_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify({ cuota: parseFloat(cuota) })
            }).catch(() => {});
          }
        }
      } catch (err) {}
      await page.waitForTimeout(2500);
    }

  } catch (e) {
    console.error("❌ ERROR: " + e.message);
    await page.screenshot({ path: 'error.png', fullPage: true });
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
