import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(fileURLToPath(import.meta.url));
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function serve() {
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const filename = path.join(root, pathname === '/' ? 'index.html' : pathname);
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

test('Timestamp formats local time with presets while preserving UTC output', async () => {
  const { server, url } = await serve();
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  try {
    await page.goto(`${url}/timestamp.html`, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('#timestamp-format').inputValue(), 'yyyy-MM-dd hh:mm:ss');
    assert.equal(await page.locator('#timestamp-format option').count(), 4);
    await page.locator('#timestamp-input').fill('0');
    await page.locator('#convert-timestamp').click();
    assert.match(await page.locator('#timestamp-local-result').textContent(), /^1970-01-01 \d{2}:00:00$/);
    assert.equal(await page.locator('#timestamp-utc-result').textContent(), '1970-01-01T00:00:00.000Z');
    await page.locator('#timestamp-format').selectOption('yyyy/MM/dd hh:mm:ss');
    assert.match(await page.locator('#timestamp-local-result').textContent(), /^1970\/01\/01 \d{2}:00:00$/);
    assert.equal(await page.locator('#timestamp-utc-result').textContent(), '1970-01-01T00:00:00.000Z');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Timestamp defaults to milliseconds and copies displayed local and UTC results', async () => {
  const { server, url } = await serve();
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  try {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
    await page.goto(`${url}/timestamp.html`, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('[data-unit="milliseconds"]').evaluate((element) => element.classList.contains('selected')), true);
    await page.locator('#timestamp-input').fill('1785462741010');
    await page.locator('#convert-timestamp').click();
    const local = await page.locator('#timestamp-local-result').textContent();
    const utc = await page.locator('#timestamp-utc-result').textContent();
    assert.match(local, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.equal(utc, '2026-07-31T01:52:21.010Z');

    await page.locator('#copy-timestamp-local').press('Enter');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), local);
    assert.equal(await page.locator('#timestamp-copy-status').textContent(), '本機日期時間已複製');

    await page.locator('#copy-timestamp-utc').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), utc);
    assert.equal(await page.locator('#timestamp-copy-status').textContent(), 'UTC 日期時間已複製');

    await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); });
    await page.locator('#copy-timestamp-local').click();
    assert.match(await page.locator('#timestamp-copy-status').textContent(), /無法使用剪貼簿/);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Timestamp copies seconds and milliseconds with accessible feedback and reports failures', async () => {
  const { server, url } = await serve();
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  try {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
    await page.goto(`${url}/timestamp.html`, { waitUntil: 'networkidle' });
    await page.locator('#datetime-input').fill('2024-01-02T03:04:05.678');
    await page.locator('#convert-datetime').click();
    const seconds = await page.locator('#datetime-seconds').textContent();
    const milliseconds = await page.locator('#datetime-milliseconds').textContent();
    await page.locator('#copy-datetime-seconds').press('Enter');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), seconds);
    assert.equal(await page.locator('#datetime-copy-status').textContent(), '秒已複製');
    await page.locator('#copy-datetime-milliseconds').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), milliseconds);
    assert.equal(await page.locator('#datetime-copy-status').textContent(), '毫秒已複製');
    await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); });
    await page.locator('#copy-datetime-seconds').click();
    assert.match(await page.locator('#datetime-copy-status').textContent(), /無法使用剪貼簿/);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Timestamp retains unit, current-time, validation, and responsive layout behavior', async () => {
  const { server, url } = await serve();
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      await page.goto(`${url}/timestamp.html`, { waitUntil: 'networkidle' });
      await page.locator('#timestamp-input').fill('invalid');
      await page.locator('#convert-timestamp').click();
      assert.match(await page.locator('#timestamp-result').textContent(), /有效的數字時間戳/);
      await page.locator('[data-unit="milliseconds"]').click();
      await page.locator('#timestamp-input').fill('1000');
      await page.locator('#convert-timestamp').click();
      assert.match(await page.locator('#timestamp-result').textContent(), /1970/);
      await page.locator('#use-now').click();
      assert.match(await page.locator('#datetime-input').inputValue(), /^\d{4}-\d{2}-\d{2}T/);
      await page.locator('#datetime-input').fill('');
      await page.locator('#convert-datetime').click();
      assert.match(await page.locator('#datetime-result').textContent(), /請選擇日期與時間/);
      await page.locator('#use-now').click();
      await page.locator('#convert-datetime').click();
      assert.match(await page.locator('#datetime-seconds').textContent(), /^\d+$/);
      assert.match(await page.locator('#datetime-milliseconds').textContent(), /^\d+$/);
      const geometry = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
        return {
          scrollWidth: document.documentElement.scrollWidth,
          format: rect('#timestamp-format'),
          seconds: rect('#datetime-seconds'),
          secondsCopy: rect('#copy-datetime-seconds'),
          milliseconds: rect('#datetime-milliseconds'),
          millisecondsCopy: rect('#copy-datetime-milliseconds')
        };
      });
      assert.equal(geometry.scrollWidth, viewport.width);
      assert.ok(geometry.format.left >= 0 && geometry.format.right <= viewport.width);
      assert.ok(geometry.secondsCopy.left >= geometry.seconds.right);
      assert.ok(geometry.millisecondsCopy.left >= geometry.milliseconds.right);
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
