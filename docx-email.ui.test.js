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

test('Docx Email catalog is compact by default, expands accessibly, and search reveals later groups', async () => {
  await withPage(async ({ page, url }) => {
    await page.goto(url);
    const catalog = page.locator('#variable-list'); const toggle = page.locator('#toggle-variable-catalog');
    assert.equal(await catalog.getAttribute('data-expanded'), 'false');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await toggle.getAttribute('aria-controls'), 'variable-list');
    assert.deepEqual(await page.locator('.variable-group h3').allTextContents(), ['保單與繳費']);
    assert.equal(await page.locator('[data-variable-kind="builtin"]').count(), 23);
    assert.equal(await catalog.evaluate((element) => getComputedStyle(element).overflowY), 'visible');
    await toggle.click();
    assert.equal(await catalog.getAttribute('data-expanded'), 'true');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('[data-variable-kind="builtin"]').count(), 105);
    assert.deepEqual(await page.locator('.variable-group h3').allTextContents(), ['保單與繳費', '投保人與受保人', '保險公司與產品', '銷售與行政', '簽單員與通知', '日期與狀態']);
    await page.getByRole('button', { name: '收合變數' }).click();
    assert.equal(await page.locator('[data-variable-kind="builtin"]').count(), 23);
    await page.locator('#variable-search').fill('機器人是否更新');
    assert.equal(await catalog.getAttribute('data-expanded'), 'false');
    assert.deepEqual(await page.locator('.variable-group h3').allTextContents(), ['日期與狀態']);
    assert.equal(await page.locator('[data-variable-kind="builtin"]').count(), 1);
    assert.match(await page.getByRole('button', { name: /機器人是否更新.*robotUpdate/ }).textContent(), /唯讀/);
  });
});

test('Docx Email expanded catalog does not stretch the preview panel or displace it on mobile', async () => {
  await withPage(async ({ page, url }) => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport); await page.goto(url); await uploadFixture(page);
      await page.locator('#toggle-variable-catalog').click();
      const geometry = await page.evaluate(() => {
        const workspace = document.querySelector('.docx-workspace').getBoundingClientRect();
        const code = document.querySelector('.code-side').getBoundingClientRect();
        const preview = document.querySelector('.preview-side').getBoundingClientRect();
        const iframe = document.querySelector('#docx-preview').getBoundingClientRect();
        return { workspaceHeight: workspace.height, codeHeight: code.height, previewHeight: preview.height, previewTop: preview.top, workspaceTop: workspace.top, iframeHeight: iframe.height };
      });
      assert.ok(geometry.previewHeight < 500, `${viewport.width}px preview should retain its intrinsic height, got ${geometry.previewHeight}`);
      assert.ok(geometry.iframeHeight < 450, `${viewport.width}px iframe should not stretch with catalog, got ${geometry.iframeHeight}`);
      if (viewport.width > 720) assert.ok(Math.abs(geometry.previewTop - geometry.workspaceTop) < 2, 'desktop preview should remain alongside the editor');
      else assert.ok(geometry.previewTop < geometry.workspaceTop + 900, 'mobile preview should follow the editor before the expanded catalog grows excessively');
    }
  });
});

test('Docx Email inserts literal variables over selection and keeps edited artifact parity', async () => {
  await withPage(async ({ page, url }) => {
    await page.goto(url);
    await uploadFixture(page);
    await page.locator('#docx-source').evaluate((textarea) => { textarea.value = 'before REMOVE after'; textarea.selectionStart = 7; textarea.selectionEnd = 13; textarea.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.getByRole('button', { name: /保單編號.*policyId/ }).click();
    const source = await page.locator('#docx-source').inputValue();
    assert.equal(source, 'before ${policyId} after');
    assert.deepEqual(await page.locator('#docx-source').evaluate((textarea) => ({ focused: document.activeElement === textarea, start: textarea.selectionStart, end: textarea.selectionEnd })), { focused: true, start: 18, end: 18 });
    assert.equal(await page.locator('#docx-preview').evaluate((iframe) => iframe.srcdoc), source);
    await page.locator('#copy-docx-html').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), source);
    const download = page.waitForEvent('download'); await page.locator('#download-docx-html').click();
    const bytes = await (await download).createReadStream().then(async (stream) => Buffer.concat(await (async () => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks; })()));
    assert.equal(bytes.toString('utf8'), source);
  });
});

test('Docx Email persists valid custom variables and protects built-ins', async () => {
  await withPage(async ({ page, url }) => {
    await page.goto(url);
    await page.locator('.custom-variable-manager').evaluate((details) => { details.open = true; });
    await page.locator('#custom-variable-label').fill('我的欄位'); await page.locator('#custom-variable-field').fill('myField'); await page.locator('#custom-variable-form').evaluate((form) => form.requestSubmit());
    assert.equal(await page.locator('[data-variable-kind="custom"]').count(), 1);
    assert.match(await page.locator('#custom-variable-list').textContent(), /我的欄位/);
    await page.reload();
    assert.equal(await page.locator('[data-variable-kind="custom"]').count(), 1);
    await page.locator('.custom-variable-manager').evaluate((details) => { details.open = true; });
    await page.getByRole('button', { name: '編輯 我的欄位' }).click(); await page.locator('#custom-variable-label').fill('更新欄位'); await page.locator('#custom-variable-field').fill('myFieldRenamed'); await page.locator('#custom-variable-form').evaluate((form) => form.requestSubmit());
    assert.equal(await page.locator('[data-variable-field="myFieldRenamed"]').count(), 1);
    assert.match(await page.locator('#custom-variable-list').textContent(), /更新欄位/);
    await page.locator('#custom-variable-label').fill('重複欄位'); await page.locator('#custom-variable-field').fill('MYFIELDRENAMED'); await page.locator('#custom-variable-form').evaluate((form) => { form.noValidate = true; form.requestSubmit(); });
    assert.match(await page.locator('#custom-variable-error').textContent(), /未重複/);
    await page.locator('#custom-variable-label').fill('壞欄位'); await page.locator('#custom-variable-field').fill('not valid'); await page.locator('#custom-variable-form').evaluate((form) => { form.noValidate = true; form.requestSubmit(); });
    assert.match(await page.locator('#custom-variable-error').textContent(), /未重複/);
    await page.locator('#custom-variable-field').fill('policyId'); await page.locator('#custom-variable-form').evaluate((form) => { form.noValidate = true; form.requestSubmit(); });
    assert.match(await page.locator('#custom-variable-error').textContent(), /未重複/);
    assert.equal(await page.locator('[data-variable-kind="builtin"][data-variable-field="policyId"]').count(), 1);
    assert.equal(await page.locator('[aria-label="刪除 保單編號"]').count(), 0);
    await page.getByRole('button', { name: '刪除 更新欄位' }).click();
    assert.equal(await page.locator('[data-variable-kind="custom"]').count(), 0);
    await page.reload(); assert.equal(await page.locator('[data-variable-kind="custom"]').count(), 0);
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
