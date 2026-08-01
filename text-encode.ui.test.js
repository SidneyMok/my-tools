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

test('all tool navigation links are simultaneously visible at 390px', async () => {
  const { server, url } = await serve();
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    for (const filename of toolPages) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      await page.goto(`${url}/${filename}`, { waitUntil: 'networkidle' });
      const navigation = await page.locator('nav').evaluate((nav) => ({
        clientWidth: nav.clientWidth,
        scrollWidth: nav.scrollWidth,
        links: Array.from(nav.querySelectorAll('a'), (link) => {
          const rect = link.getBoundingClientRect();
          return { text: link.textContent.trim(), left: rect.left, right: rect.right };
        })
      }));
      assert.equal(navigation.scrollWidth, navigation.clientWidth, filename);
      for (const link of navigation.links) {
        assert.ok(link.left >= 0 && link.right <= 390, `${filename}: ${link.text}`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
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

test('SQL IN formatter is the first primary Text & Encode feature before Base64', async () => {
  const html = await readFile(path.join(root, 'text-encode.html'), 'utf8');
  const sqlPanel = html.indexOf('<section class="sql-in-panel"');
  const encoderModule = html.indexOf('<section class="text-encode-module"');

  assert.ok(sqlPanel >= 0, 'SQL IN formatter panel is present');
  assert.ok(encoderModule >= 0, 'encoder/decoder module is present');
  assert.ok(sqlPanel < encoderModule, 'SQL IN formatter precedes the encoder/decoder module in DOM order');
  assert.match(html, /<h2 id="text-encode-module-title">文字編碼與解碼<\/h2>/);
  assert.match(html, /class="action-row sql-in-copy-row"[^>]*>[\s\S]*id="copy-sql-in"/);
  assert.match(html, /<button[^>]*id="clear-sql-in"[^>]*>清空<\/button>/);
});

test('SQL IN format and clear actions form a bounded adjacent group at desktop and mobile widths', async () => {
  const { server, url } = await serve();
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      await page.goto(`${url}/text-encode.html`, { waitUntil: 'networkidle' });
      const geometry = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
        const group = rect('.sql-in-actions');
        const format = rect('#format-sql-in');
        const clear = rect('#clear-sql-in');
        const options = rect('.sql-in-options');
        return {
          documentWidth: document.documentElement.scrollWidth,
          group,
          format,
          clear,
          options,
          sameRow: Math.abs(format.top - clear.top) <= 1,
          horizontalGap: clear.left - format.right
        };
      });

      assert.equal(geometry.documentWidth, viewport.width);
      assert.ok(geometry.group.left >= geometry.options.left && geometry.group.right <= geometry.options.right, 'action group stays within the options row');
      assert.ok(geometry.format.left < geometry.clear.left, 'format action precedes clear action');
      assert.ok(geometry.sameRow, 'desktop and mobile actions share a vertical baseline');
      assert.ok(geometry.horizontalGap >= 6 && geometry.horizontalGap <= 16, 'actions use a deliberate bounded gap');
      if (viewport.width > 720) {
        assert.ok(geometry.group.width < geometry.options.width / 2, 'desktop actions occupy a compact group instead of opposite ends of the row');
      } else {
        assert.ok(geometry.group.width <= geometry.options.width, 'mobile action group remains horizontally contained');
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Text & Encode keeps UUID controls aligned and modules separated at desktop and mobile widths', async () => {
  const { server, url } = await serve();
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      await page.goto(`${url}/text-encode.html`, { waitUntil: 'networkidle' });
      const initial = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
        return {
          documentWidth: document.documentElement.scrollWidth,
          uuidOutput: rect('#uuid-output'),
          generate: rect('#generate-uuid'),
          copy: rect('#copy-uuid'),
          sqlCopy: rect('#copy-sql-in'),
          sqlPanel: rect('.sql-in-panel'),
          encoderModule: rect('.text-encode-module')
        };
      });
      assert.equal(initial.documentWidth, viewport.width);
      assert.equal(initial.uuidOutput.height, initial.generate.height);
      assert.equal(initial.uuidOutput.height, initial.copy.height);
      assert.ok(initial.sqlCopy.bottom <= initial.sqlPanel.bottom, 'SQL copy stays inside the SQL formatter');
      assert.ok(initial.sqlPanel.bottom <= initial.encoderModule.top, 'SQL formatter does not overlap encoder module');
      await page.locator('#generate-uuid').click();
      const generated = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
        return { output: rect('#uuid-output'), generate: rect('#generate-uuid'), copy: rect('#copy-uuid') };
      });
      assert.equal(generated.output.height, generated.generate.height);
      assert.equal(generated.output.height, generated.copy.height);
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('SQL IN formatter formats, counts, rejects invalid numeric input, and copies output', async () => {
  const { server, url } = await serve();
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  try {
    await page.goto(`${url}/text-encode.html`, { waitUntil: 'networkidle' });
    await page.locator('#sql-in-input').fill(" apple \n\nO'Reilly\n banana ");
    await page.locator('#format-sql-in').click();
    assert.equal(await page.locator('#sql-in-output').inputValue(), "IN ('apple','O''Reilly','banana')");
    assert.equal(await page.locator('#sql-in-count').textContent(), '已包含 3 個值');
    await page.locator('#sql-in-values-only').check();
    await page.locator('#format-sql-in').click();
    assert.equal(await page.locator('#sql-in-output').inputValue(), "'apple','O''Reilly','banana'");
    await page.locator('#sql-in-numeric').check();
    await page.locator('#sql-in-input').fill('1\n2.5\n-3e2');
    await page.locator('#format-sql-in').click();
    assert.equal(await page.locator('#sql-in-output').inputValue(), '1,2.5,-3e2');
    await page.locator('#sql-in-input').fill('1\nDROP TABLE');
    await page.locator('#format-sql-in').click();
    assert.equal(await page.locator('#sql-in-output').inputValue(), '');
    assert.match(await page.locator('#sql-in-error').textContent(), /第 2 行不是有效數字/);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
    await page.locator('#sql-in-numeric').uncheck();
    await page.locator('#sql-in-values-only').uncheck();
    await page.locator('#sql-in-input').fill('apple\nbanana');
    await page.locator('#format-sql-in').click();
    await page.locator('#copy-sql-in').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "IN ('apple','banana')");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('SQL IN clear resets only its workspace while preserving selected options and keyboard activation', async () => {
  const { server, url } = await serve();
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  try {
    await page.goto(`${url}/text-encode.html`, { waitUntil: 'networkidle' });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
    await page.locator('#sql-in-values-only').check();
    await page.locator('#sql-in-numeric').check();
    await page.locator('#sql-in-input').fill('1\n2.5');
    await page.locator('#format-sql-in').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#sql-in-output').inputValue(), '1,2.5');
    await page.locator('#copy-sql-in').click();
    await page.waitForFunction(() => document.querySelector('#text-encode-status').textContent === '已複製');

    await page.locator('#clear-sql-in').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#sql-in-input').inputValue(), '');
    assert.equal(await page.locator('#sql-in-output').inputValue(), '');
    assert.equal(await page.locator('#sql-in-count').textContent(), '已包含 0 個值');
    assert.equal(await page.locator('#text-encode-status').textContent(), '等待輸入');
    assert.equal(await page.locator('#sql-in-values-only').isChecked(), true);
    assert.equal(await page.locator('#sql-in-numeric').isChecked(), true);
    assert.equal(await page.locator('#sql-in-input').evaluate((element) => document.activeElement === element), true);

    await page.locator('#sql-in-input').fill('not a number');
    await page.locator('#format-sql-in').click();
    assert.match(await page.locator('#sql-in-error').textContent(), /第 1 行不是有效數字/);
    await page.locator('#clear-sql-in').focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#sql-in-error').textContent(), '');
    assert.equal(await page.locator('#text-encode-status').textContent(), '等待輸入');

    await page.locator('#sql-in-input').fill('3\n4');
    await page.locator('#format-sql-in').click();
    assert.equal(await page.locator('#sql-in-output').inputValue(), '3,4');
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
