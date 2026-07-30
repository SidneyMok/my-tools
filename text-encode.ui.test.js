import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(fileURLToPath(import.meta.url));
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const toolPages = ['index.html', 'html-preview.html', 'timestamp.html', 'network.html', 'docx-email.html', 'text-encode.html'];

async function serve() {
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const filename = path.join(root, pathname === '/' ? 'index.html' : pathname);
    try {
      const content = await readFile(filename);
      response.writeHead(200, { 'content-type': filename.endsWith('.css') ? 'text/css' : filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.svg') ? 'image/svg+xml' : 'text/html' });
      response.end(content);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

test('all tool pages navigate to Text & Encode', async () => {
  for (const page of toolPages) {
    const html = await readFile(path.join(root, page), 'utf8');
    assert.match(html, /href="text-encode\.html"[^>]*>Text &amp; Encode<\/a>/, page);
  }
});

test('Network discloses that queried IP addresses are sent to its third-party lookup service', async () => {
  const html = await readFile(path.join(root, 'network.html'), 'utf8');
  assert.match(html, /IP 位址會傳送至第三方 IP 查詢服務/);
});

test('Text & Encode works without horizontal overflow at target widths', async () => {
  const { server, url } = await serve();
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      await page.goto(`${url}/text-encode.html`, { waitUntil: 'networkidle' });
      const geometry = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        width: innerWidth,
        section: document.querySelector('.text-encode-section').getBoundingClientRect().toJSON()
      }));
      assert.equal(geometry.scrollWidth, viewport.width);
      assert.ok(geometry.section.left >= 0 && geometry.section.right <= viewport.width);
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Text & Encode exposes Base64, URL errors, hashing, and UUID generation in the browser', async () => {
  const { server, url } = await serve();
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  try {
    await page.goto(`${url}/text-encode.html`, { waitUntil: 'networkidle' });
    await page.locator('#text-encode-input').fill('你好 😀');
    await page.locator('#base64-encode').click();
    const encoded = await page.locator('#text-encode-output').inputValue();
    await page.locator('#text-encode-input').fill(encoded);
    await page.locator('#base64-decode').click();
    assert.equal(await page.locator('#text-encode-output').inputValue(), '你好 😀');
    await page.locator('#text-encode-input').fill('%E0%A4%A');
    await page.locator('#url-decode').click();
    assert.match(await page.locator('#text-encode-error').textContent(), /無法解碼/);
    await page.locator('#text-encode-input').fill('abc');
    await page.locator('[data-hash="SHA-256"]').click();
    await page.locator('#text-encode-output').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#text-encode-output').inputValue(), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    await page.locator('#generate-uuid').click();
    assert.match(await page.locator('#uuid-output').textContent(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
