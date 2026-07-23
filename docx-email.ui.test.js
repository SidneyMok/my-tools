import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { chromium } from 'playwright';

const root = path.dirname(fileURLToPath(import.meta.url));
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pages = ['index.html', 'html-preview.html', 'timestamp.html', 'network.html', 'docx-email.html'];
const navTargets = ['index.html', 'html-preview.html', 'timestamp.html', 'network.html', 'docx-email.html'];

async function serve() {
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://x').pathname;
    const file = path.join(root, pathname === '/' ? 'docx-email.html' : pathname);
    try {
      response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
      response.end(await readFile(file));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function withPage(run) {
  const { server, url } = await serve();
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
  const page = await context.newPage();
  try { await run({ page, url }); } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}

async function uploadFixture(page) {
  await page.locator('#docx-input').setInputFiles(path.join(root, 'fixtures/email-fidelity.docx'));
  await page.locator('#docx-status').filter({ hasText: '已轉換' }).waitFor();
}

test('docx email loads pinned tracked parser bundles locally, never from node_modules or an external origin', async () => {
  await withPage(async ({ page, url }) => {
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.goto(url);
    assert.deepEqual(requests.filter((requestUrl) => /(?:jszip|mammoth)/i.test(requestUrl)).map((requestUrl) => new URL(requestUrl).pathname).sort(), [
      '/vendor/jszip-3.10.1.min.js',
      '/vendor/mammoth-1.11.0.browser.js'
    ]);
    assert.ok(requests.every((requestUrl) => new URL(requestUrl).origin === url));
    assert.ok(requests.every((requestUrl) => !new URL(requestUrl).pathname.startsWith('/node_modules/')));
  });
});

test('Docx Email browser DOMParser sanitizer strips target styles and is byte-idempotent for default, table, and cell styles', async () => {
  await withPage(async ({ page, url }) => {
    await page.goto(url);
    const results = await page.evaluate(async () => {
      const { sanitizeEmailHtml } = await import('./docx-email.js');
      return ['<p>test</p>', '<table><tbody><tr><td>test</td></tr></tbody></table>', '<p style="font-family:Arial;line-height:1.6;font-size:14px;color:#17211f">test</p>'].map((input) => {
        const first = sanitizeEmailHtml(input);
        return { first, second: sanitizeEmailHtml(first) };
      });
    });
    for (const { first, second } of results) {
      assert.equal(second, first);
      assert.doesNotMatch(first, /(?:font-family|line-height):|font-size:14px|color:(?:#17211f|#000(?:000)?|black)/i);
    }
  });
});

test('Docx Email emits one final sanitized, readable artifact to preview, clipboard, and UTF-8 download without iframe scripts', async () => {
  await withPage(async ({ page, url }) => {
    await page.goto(url);
    assert.equal(await page.locator('#docx-preview').getAttribute('sandbox'), '');
    await uploadFixture(page);
    const source = await page.locator('#docx-source').inputValue();
    assert.match(source, /color:#FF0000/i);
    assert.match(source, /font-size:16pt/i);
    assert.doesNotMatch(source, /(?:font-family|line-height):|font-size:14px|color:(?:#17211f|#000(?:000)?|black)/i);
    assert.match(source, /<u>/i);
    assert.match(source, /<ul>\n  <li[^>]*>項目符號清單一<\/li>\n  <li[^>]*>項目符號清單二<\/li>\n<\/ul>/);
    assert.match(source, /<ol>\n  <li[^>]*>編號清單一<\/li>\n  <li[^>]*>編號清單二<\/li>\n<\/ol>/);
    assert.match(source, /\n<table/);
    assert.equal(await page.locator('#docx-preview').evaluate((iframe) => iframe.srcdoc), source);
    assert.equal(await page.locator('#docx-preview').contentFrame().locator('ul > li').count(), 2);
    assert.equal(await page.locator('#docx-preview').contentFrame().locator('ol > li').count(), 2);
    await page.locator('#copy-docx-html').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), source);
    const download = page.waitForEvent('download');
    await page.locator('#download-docx-html').click();
    const downloadBytes = await (await download).createReadStream().then(async (stream) => Buffer.concat(await (async () => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks; })()));
    assert.equal(downloadBytes.toString('utf8'), source);
  });
});

test('docx email gives explicit invalid-extension, corrupt/missing-XML, and over-limit feedback', async () => {
  await withPage(async ({ page, url }) => {
    await page.goto(url);
    await page.locator('#docx-input').setInputFiles({ name: 'legacy.doc', mimeType: 'application/msword', buffer: Buffer.from('old') });
    await page.locator('#docx-status').filter({ hasText: '無法轉換' }).waitFor();
    assert.match(await page.locator('#docx-error').textContent(), /只支援 .docx/);
    await page.locator('#docx-input').setInputFiles({ name: 'corrupt.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('PK\x03\x04not-a-zip') });
    await page.locator('#docx-status').filter({ hasText: '無法轉換' }).waitFor();
    assert.match(await page.locator('#docx-error').textContent(), /無法轉換 DOCX/);
    const missingXml = await new JSZip().file('note.txt', 'missing document XML').generateAsync({ type: 'nodebuffer' });
    await page.locator('#docx-input').setInputFiles({ name: 'missing.xml.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: missingXml });
    await page.locator('#docx-status').filter({ hasText: '無法轉換' }).waitFor();
    assert.match(await page.locator('#docx-error').textContent(), /找不到 DOCX 文件內容|Could not find main document part/);
    await page.locator('#docx-input').setInputFiles({ name: 'large.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
    assert.match(await page.locator('#docx-error').textContent(), /超過 10 MB/);
  });
});

test('all user-visible Docx Email labels use the exact product name and the page omits nonessential instructions', async () => {
  for (const filename of pages) {
    const html = await readFile(path.join(root, filename), 'utf8');
    for (const target of navTargets) assert.match(html, new RegExp(`href="${target}"`));
    assert.match(html, /href="docx-email\.html"[^>]*>Docx Email<\/a>/);
  }
  const docxPage = await readFile(path.join(root, 'docx-email.html'), 'utf8');
  assert.match(docxPage, /<title>Docx Email<\/title>/);
  assert.match(docxPage, /<h1 id="docx-title">Docx Email<\/h1>/);
  assert.match(docxPage, /title="Docx Email"/);
  assert.doesNotMatch(docxPage, /完全在此裝置轉換|僅限 \.docx|Mammoth 僅協助|圖片可在本機預覽|唯一輸出|隔離 iframe/);
  assert.match(docxPage, /src="vendor\/jszip-3\.10\.1\.min\.js"/);
  assert.match(docxPage, /src="vendor\/mammoth-1\.11\.0\.browser\.js"/);
  assert.doesNotMatch(docxPage, /node_modules|https?:\/\//);
});
