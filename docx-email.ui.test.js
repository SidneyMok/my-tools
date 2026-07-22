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
    const pathname = new URL(request.url, 'http://x').pathname;
    const file = path.join(root, pathname === '/' ? 'docx-email.html' : pathname);
    try {
      response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/html');
      response.end(await readFile(file));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
async function withPage(run) {
  const { server, url } = await serve(); const browser = await chromium.launch({ executablePath: chrome, headless: true }); const page = await browser.newPage();
  try { await page.goto(`${url}/docx-email.html`); return await run(page, url); } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}
test('DOCX email page shares one sanitized artifact across iframe, clipboard and UTF-8 download', async () => {
  await withPage(async (page) => {
    assert.equal(await page.locator('#docx-preview').getAttribute('sandbox'), '');
    assert.equal(await page.locator('#copy-docx-html').isDisabled(), true);
    await page.locator('#docx-input').setInputFiles(path.join(root, 'fixtures/email-fidelity.docx'));
    await page.locator('#docx-status').filter({ hasText: '已轉換' }).waitFor();
    const source = await page.locator('#docx-source').inputValue();
    assert.match(source, /color:#FF0000/i);
    assert.equal(await page.locator('#docx-preview').evaluate((frame) => frame.srcdoc), source);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.locator('#copy-docx-html').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), source);
    const download = page.waitForEvent('download'); await page.locator('#download-docx-html').click();
    assert.equal((await download).suggestedFilename(), 'email-template.html');
    assert.equal((await (await download).createReadStream()).readable, true);
    const bytes = await (await download).createReadStream(); let text = ''; for await (const part of bytes) text += part; assert.equal(text, source);
  });
});

test('DOCX page gives explicit invalid extension, corrupt, and over-limit feedback', async () => {
  await withPage(async (page) => {
    for (const [file, expectation] of [
      [{ name: 'legacy.doc', mimeType: 'application/msword', buffer: Buffer.from('x') }, /只支援 .docx/],
      [{ name: 'broken.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('not zip') }, /不是有效的 DOCX/],
      [{ name: 'large.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) }, /超過 10 MB/]
    ]) { await page.locator('#docx-input').setInputFiles(file); await assert.rejects(async () => page.locator('#docx-status').filter({ hasText: '已轉換' }).waitFor({ timeout: 100 })); assert.match(await page.locator('#docx-error').textContent(), expectation); }
  });
});

test('all existing tool pages navigate to the DOCX email tool and local parser assets load', async () => {
  await withPage(async (page, url) => {
    for (const tool of ['index.html', 'html-preview.html', 'timestamp.html', 'network.html']) { await page.goto(`${url}/${tool}`); assert.equal(await page.locator('a[href="docx-email.html"]').count(), 1); }
    await page.goto(`${url}/docx-email.html`);
    for (const asset of ['node_modules/jszip/dist/jszip.min.js', 'node_modules/mammoth/mammoth.browser.js']) assert.equal(await page.evaluate(async (file) => (await fetch(file)).ok, asset), true);
  });
});
