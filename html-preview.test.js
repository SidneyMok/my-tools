import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(fileURLToPath(import.meta.url));
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const defaultHeading = '你好，世界！';
const defaultCopy = '從這裡開始測試你的想法。';

async function serve() {
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const filename = path.join(root, pathname === '/' ? 'html-preview.html' : pathname);
    try {
      const content = await readFile(filename);
      response.writeHead(200, { 'content-type': filename.endsWith('.css') ? 'text/css' : filename.endsWith('.js') ? 'text/javascript' : 'text/html' });
      response.end(content);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function withPage(run) {
  const { server, url } = await serve();
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  try {
    await page.goto(`${url}/html-preview.html`, { waitUntil: 'networkidle' });
    return await run(page);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function openPreview(page, html) {
  if (html) await page.locator('#html-input').fill(html);
  const popupPromise = page.waitForEvent('popup');
  await page.locator('#open-preview').click();
  const popup = await popupPromise;
  await popup.waitForLoadState('load');
  return popup;
}

test('HTML Preview opens UTF-8 Blob documents with Traditional Chinese content', async () => {
  assert.match(await readFile(path.join(root, 'app.js'), 'utf8'), /new Blob\(\[htmlInput\.value\], \{ type: 'text\/html;charset=UTF-8' \}\)/);
  await withPage(async (page) => {
    const defaultPopup = await openPreview(page);
    assert.equal(await defaultPopup.evaluate(() => document.characterSet), 'UTF-8');
    assert.equal(await defaultPopup.locator('h1').textContent(), defaultHeading);
    assert.equal(await defaultPopup.locator('p').textContent(), defaultCopy);

    for (const { html, color } of [
      { html: '<!doctype html><title>無宣告</title><style>body { color: rgb(1, 2, 3); }</style><h1>繁體中文沒有 meta</h1><script>document.body.dataset.ran = "yes"</script>', color: 'rgb(1, 2, 3)' },
      { html: '<!doctype html><meta charset="UTF-8"><title>有宣告</title><style>body { color: rgb(4, 5, 6); }</style><h1>繁體中文有 UTF-8 宣告</h1><script>document.body.dataset.ran = "yes"</script>', color: 'rgb(4, 5, 6)' }
    ]) {
      const popup = await openPreview(page, html);
      assert.equal(await popup.evaluate(() => document.characterSet), 'UTF-8');
      assert.match(await popup.locator('h1').textContent(), /繁體中文/);
      assert.equal(await popup.locator('body').evaluate((body) => body.dataset.ran), 'yes');
      assert.equal(await popup.locator('body').evaluate((body) => getComputedStyle(body).color), color);
      await popup.close();
    }
  });
});

test('HTML Preview retains sandboxed srcdoc Run and Reset behavior', async () => {
  await withPage(async (page) => {
    const iframe = page.locator('#html-preview');
    assert.equal(await iframe.getAttribute('sandbox'), 'allow-scripts');
    assert.match(await iframe.getAttribute('srcdoc'), /你好，世界！/);
    assert.match(await iframe.contentFrame().locator('h1').textContent(), /你好，世界！/);

    await page.locator('#html-input').fill('<h1>執行中的預覽</h1><script>document.body.dataset.ran = "yes"</script>');
    await page.locator('#run-html').click();
    assert.equal(await iframe.contentFrame().locator('body').evaluate((body) => body.dataset.ran), 'yes');
    await page.locator('#reset-html').click();
    assert.match(await iframe.contentFrame().locator('p').textContent(), /從這裡開始測試你的想法。/);
  });
});
