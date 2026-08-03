import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(fileURLToPath(import.meta.url));
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pages = ['index.html', 'html-preview.html', 'timestamp.html', 'network.html', 'docx-email.html', 'text-encode.html', 'password-generator.html'];

async function serve() {
  const server = http.createServer(async (request, response) => {
    const filename = path.join(root, new URL(request.url, 'http://local').pathname.replace(/^\/$/, '/password-generator.html'));
    try { response.writeHead(200, { 'content-type': filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.svg') ? 'image/svg+xml' : 'text/html' }); response.end(await readFile(filename)); }
    catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function withPage(run) {
  const { server, url } = await serve();
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
  const page = await context.newPage();
  try { await run({ page, url }); } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}

test('password page defaults to a secure four-category 16-character password and provides navigation everywhere', async () => {
  await withPage(async ({ page, url }) => {
    for (const name of pages) {
      await page.goto(`${url}/${name}`);
      assert.equal(await page.locator('nav a[href="password-generator.html"]').count(), 1, `${name} navigation`);
    }
    await page.goto(`${url}/password-generator.html`);
    const password = await page.locator('#password-output').inputValue();
    assert.equal(password.length, 16);
    assert.match(password, /[A-Z]/); assert.match(password, /[a-z]/); assert.match(password, /[0-9]/); assert.match(password, /[^A-Za-z0-9]/);
    assert.match(await page.locator('#password-guidance').textContent(), /組合強度/);
  });
});

test('password settings provide accessible rejection without replacing the last valid password', async () => {
  await withPage(async ({ page, url }) => {
    await page.goto(`${url}/password-generator.html`);
    const original = await page.locator('#password-output').inputValue();
    for (const checkbox of await page.locator('input[name="category"]').all()) await checkbox.uncheck();
    await page.locator('#regenerate-password').press('Enter');
    assert.match(await page.locator('#password-error').textContent(), /至少選擇一種/);
    assert.equal(await page.locator('#password-output').inputValue(), original);
    await page.locator('input[value="uppercase"]').check();
    await page.locator('#password-length').fill('11');
    assert.match(await page.locator('#password-error').textContent(), /12 至 128/);
  });
});

test('copy and regenerate operate by keyboard with exact clipboard parity and feedback', async () => {
  await withPage(async ({ page, url }) => {
    await page.goto(`${url}/password-generator.html`);
    const first = await page.locator('#password-output').inputValue();
    await page.locator('#regenerate-password').press('Space');
    const second = await page.locator('#password-output').inputValue();
    assert.notEqual(second, first);
    await page.locator('#copy-password').press('Enter');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), second);
    assert.match(await page.locator('#password-status').textContent(), /已複製/);
  });
});

test('password generator remains contained at desktop and mobile viewports', async () => {
  await withPage(async ({ page, url }) => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport); await page.goto(`${url}/password-generator.html`);
      const layout = await page.evaluate(() => { const rect = document.querySelector('.password-section').getBoundingClientRect(); return { scrollWidth: document.documentElement.scrollWidth, rect: { left: rect.left, right: rect.right } }; });
      assert.equal(layout.scrollWidth, viewport.width);
      assert.ok(layout.rect.left >= 0 && layout.rect.right <= viewport.width);
    }
  });
});
