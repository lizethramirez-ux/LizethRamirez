// ═══════════════════════════════════════════════════════════════
// bot_cloud.js — Bot Aviator (Codere) para GitHub Actions
// Estrategia: sesión restaurada desde AUTH_JSON_BASE64
// → nunca hace login → nunca enfrenta a Cloudflare Turnstile.
// ═══════════════════════════════════════════════════════════════

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs');

chromium.use(stealth);

const GAME_URL = process.env.GAME_URL;
const DURACION_MS = parseInt(process.env.BOT_DURACION_MS || '18000000', 10); // 5 horas

// Se ejecuta DENTRO de la página para leer el historial de multiplicadores.
// Codere monta el historial con Angular (en la PÁGINA, no dentro del iframe):
// <div appcoloredmultiplier="" class="payout ..."> 2.28x </div>
const leerCuotas = () => [...document.querySelectorAll('[appcoloredmultiplier], .payout')]
  .map(el => (el.textContent || '').trim())
  .filter(t => /^\d+(\.\d+)?x$/i.test(t));

(async () => {
  console.log("🚀 Bot Aviator (Codere) iniciando en GitHub Actions...");
  console.log(`⏱️ Duración programada: ${(DURACION_MS / 3600000).toFixed(1)} horas`);

  if (!process.env.AUTH_JSON_BASE64 || !GAME_URL) {
    console.error("❌ ERROR: Faltan los secrets AUTH_JSON_BASE64 y/o GAME_URL.");
    process.exit(1);
  }

  // ── 1. Reconstruir la sesión desde el secret ──
  fs.writeFileSync('auth.json', Buffer.from(process.env.AUTH_JSON_BASE64, 'base64').toString('utf-8'));

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    storageState: 'auth.json',
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-CO',
    timezoneId: 'America/Bogota'
  });

  const page = await context.newPage();

  try {
    // ── 2. Cargar el juego con la sesión restaurada ──
    console.log("📡 Cargando Aviator con sesión restaurada...");
    await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // ── 3. Verificar que el juego cargó (iframe de Spribe = sesión viva) ──
    let frame = null;
    for (let i = 0; i < 30; i++) {
      frame = page.frames().find(f => /spribe|aviator/i.test(f.url()));
      if (frame) break;
      await page.waitForTimeout(1000);
    }

    if (!frame) {
      await page.screenshot({ path: 'error.png', fullPage: true });
      const pideLogin = await page
        .isVisible('button:has-text("Ingresar"), button:has-text("Entrar"), a:has-text("Ingresar"), a:has-text("Login")')
        .catch(() => false);
      throw new Error(pideLogin
        ? "🔴 SESIÓN MUERTA: el sitio pide login → regenera auth.json en tu PC y actualiza el secret AUTH_JSON_BASE64"
        : "🔴 El iframe del juego no apareció y no hay botón de login → revisa error.png");
    }

    console.log(`🎯 Sesión VÁLIDA. Conectado a: ${frame.url().slice(0, 90)}`);
    await page.screenshot({ path: 'inicio_ok.png' });
    console.log("👂 Iniciando escucha de multiplicadores...\n");

    // ── 4. Envío a Supabase ──
    const enviarSupabase = async (texto) => {
      if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) return;
      try {
        await fetch(`${process.env.SUPABASE_URL}/rest/v1/cuotas_rushbet`, {
          method: 'POST',
          headers: {
            'apikey': process.env.SUPABASE_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ cuota: parseFloat(texto), created_at: new Date().toISOString() })
        });
      } catch (e) {
        console.error("   ⚠️ Error Supabase:", e.message);
      }
    };

    // ── 5. Bucle de extracción ──
    let previas = new Set();   // valores vistos en la lectura anterior
    let prevHead = "";         // primer valor de la lista anterior
    let prevTail = "";         // último valor de la lista anterior
    let prevLen = 0;           // largo de la lista anterior
    let calibrando = true;     // primera lectura válida: memorizar SIN registrar
    let ciclos = 0, contador = 0, fallosVida = 0;
    const t0 = Date.now();

    while (Date.now() - t0 < DURACION_MS) {
      ciclos++;

      // 5a. Leer: primero la PÁGINA (donde Codere monta el historial Angular),
      //     y si no hay nada ahí, barrer todos los iframes por si acaso.
      let cuotas = await page.evaluate(leerCuotas).catch(() => []);
      if (!cuotas.length) {
        for (const f of page.frames()) {
          const c = await f.evaluate(leerCuotas).catch(() => []);
          if (c.length) { cuotas = c; break; }
        }
      }

      // 5b. Calibración: memorizar el historial inicial sin insertarlo
      //     (evita volcar 30 multiplicadores viejos con timestamps falsos)
      if (calibrando && cuotas.length) {
        calibrando = false;
        previas = new Set(cuotas);
        prevHead = cuotas[0];
        prevTail = cuotas[cuotas.length - 1];
        prevLen = cuotas.length;
        console.log(`🎚️ Calibrado con ${cuotas.length} multiplicadores en pantalla. Esperando rondas nuevas...`);
      }

      // 5c. Detección de rondas nuevas
      if (!calibrando) {
        const nuevasPorContenido = cuotas.filter(c => !previas.has(c));
        let paraEmitir = [];

        if (nuevasPorContenido.length) {
          paraEmitir = nuevasPorContenido;
        } else if (cuotas.length) {
          const head = cuotas[0];
          const tail = cuotas[cuotas.length - 1];
          if (head !== prevHead) paraEmitir = [head];              // entró al frente
          else if (tail !== prevTail) paraEmitir = [tail];         // entró al final
          else if (cuotas.length !== prevLen) paraEmitir = [head]; // creció con duplicado
        }

        for (const c of paraEmitir) {
          contador++;
          console.log(`📈 NUEVA CUOTA (${contador}): ${c}`);
          await enviarSupabase(c);
        }

        if (cuotas.length) {
          previas = new Set(cuotas);
          prevHead = cuotas[0];
          prevTail = cuotas[cuotas.length - 1];
          prevLen = cuotas.length;
        }
      }

      // 5d. Latido cada 10 ciclos (~30s): prueba de vida del bot
      if (ciclos % 10 === 0) {
        const secs = Math.round((Date.now() - t0) / 1000);
        console.log(`💚 Latido ${secs}s — capturadas: ${contador} — en pantalla: ${cuotas.slice(0, 5).join(' | ') || '(nada)'}`);

        // Diagnóstico único a los ~60s si nunca se leyó nada
        if (!cuotas.length && ciclos === 20) {
          try {
            const diag = await page.evaluate(() => ({
              attr: document.querySelectorAll('[appcoloredmultiplier]').length,
              payout: document.querySelectorAll('.payout').length,
              texto: document.body.innerText.replace(/\s+/g, ' ').slice(0, 200)
            }));
            console.log(`🔍 DIAG página → [appcoloredmultiplier]=${diag.attr}, .payout=${diag.payout}`);
            console.log(`🔍 Texto visible: ${diag.texto || '(vacío)'}`);
          } catch (e) {}
        }

        // Vigilancia de sesión: sin datos Y sin frame de juego = posible expiración
        if (!cuotas.length) {
          const frameVivo = page.frames().some(f => /spribe|aviator/i.test(f.url()));
          if (!frameVivo) {
            fallosVida++;
            console.log(`⚠️ Sin datos y sin frame de juego (${fallosVida}/3)...`);
            if (fallosVida >= 3) {
              await page.screenshot({ path: 'error.png', fullPage: true }).catch(() => {});
              throw new Error("🔴 El juego dejó de responder (sesión muerta o redirección). Regenera auth.json y actualiza el secret.");
            }
          }
        } else {
          fallosVida = 0;
        }
      }

      await page.waitForTimeout(2500 + Math.random() * 1000);
    }

    console.log(`\n🏁 Corrida completada: ${contador} cuotas capturadas y enviadas a Supabase.`);

  } catch (e) {
    console.error("❌ " + e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
