// Local test harness for DUSTLINE. Serves game/, captures the 4 screenshots from
// shots.json, plays one full bot-vs-bot match (?demo=1), and reports console errors
// and failed requests. Usage: node test-local.mjs
import { chromium } from '/home/hatch/workspace/makefun/token-radar-shot-tools/node_modules/playwright-core/index.mjs';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = new URL('.', import.meta.url).pathname;
const SHOTS = JSON.parse(readFileSync(ROOT + 'shots.json', 'utf8'));
const PORT = 8091;

function startServer() {
  return new Promise((resolve, reject) => {
    const srv = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: ROOT, stdio: 'pipe' });
    let out = '';
    srv.stdout.on('data', (d) => { out += d; if (out.includes('http://localhost')) resolve(srv); });
    srv.stderr.on('data', (d) => { out += d; });
    setTimeout(() => reject(new Error('server did not start: ' + out)), 10000);
  });
}

const errors = [];
function watch(page, label) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${label}] console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`[${label}] requestfailed: ${r.url()}`));
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(`http://localhost:${PORT}`) && !u.startsWith('http://127.0.0.1')) {
      errors.push(`[${label}] EXTERNAL request: ${u}`);
    }
  });
}

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const server = await startServer();
try {
  // 1. Plain load: menu screen, no errors.
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page, 'menu');
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await page.waitForTimeout(3000);
    const webgl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      return !!c.getContext('webgl2');
    });
    console.log('menu load: webgl2 =', webgl);
    await page.close();
  }
  // 2. Screenshots.
  for (const s of SHOTS) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page, s.name);
    await page.goto(`http://localhost:${PORT}/${s.query}`, { waitUntil: 'load' });
    try {
      await page.waitForFunction(() => window.__shotReady, null, { timeout: 30000 });
    } catch {
      errors.push(`[${s.name}] __shotReady never set`);
    }
    await page.screenshot({ path: ROOT + 'screenshots/' + s.name, type: 'jpeg', quality: 80 });
    console.log('shot done:', s.name);
    await page.close();
  }
  // 3. Full bot-vs-bot match.
  {
    const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
    watch(page, 'demo');
    await page.goto(`http://localhost:${PORT}/?demo=1`, { waitUntil: 'load' });
    let state = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 300000) {
      await page.waitForTimeout(2000);
      state = await page.evaluate(() => window.__DUSTLINE__ || null);
      if (state) {
        console.log(`demo t=${Math.round((Date.now() - t0) / 1000)}s phase=${state.phase} round=${state.round} score=${state.scoreCT}-${state.scoreT} ctAlive=${state.ctAlive} tAlive=${state.tAlive} bomb=${state.bombPlanted}`);
        if (state.matchOver) break;
      }
    }
    console.log('demo final:', JSON.stringify(state));
    if (!state || !state.matchOver) errors.push('[demo] match did not finish in 300s');
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
console.log('\n=== ERRORS (' + errors.length + ') ===');
for (const e of errors) console.log(' -', e);
process.exit(errors.length ? 1 : 0);
