import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(fileURLToPath(import.meta.url));
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pages = ['index.html', 'html-preview.html', 'timestamp.html', 'network.html', 'docx-email.html', 'text-encode.html', 'password-generator.html', 'resource-allocation.html'];
const expectedNav = [
  { href: 'index.html', label: 'JSON' }, { href: 'html-preview.html', label: 'HTML' },
  { href: 'timestamp.html', label: 'Timestamp' }, { href: 'network.html', label: 'Network' },
  { href: 'docx-email.html', label: 'Docx Email' }, { href: 'text-encode.html', label: 'Text & Encode' },
  { href: 'password-generator.html', label: 'Password' }, { href: 'resource-allocation.html', label: 'Resource Allocation' }
];

async function serve() {
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const filename = path.join(root, pathname === '/' ? 'index.html' : pathname);
    try {
      const content = await readFile(filename);
      const type = filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
      response.writeHead(200, { 'content-type': type }); response.end(content);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: 'http://127.0.0.1:' + server.address().port };
}

async function withPage(run) {
  const { server, url } = await serve();
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try { await run({ page, url }); } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}

test('all published pages expose the complete navigation with one active current item', async () => {
  await withPage(async ({ page, url }) => {
    for (const filename of pages) {
      await page.goto(url + '/' + filename, { waitUntil: 'networkidle' });
      const navigation = await page.locator('nav').evaluate((nav) => Array.from(nav.querySelectorAll('a'), (link) => ({
        href: link.getAttribute('href'), label: link.textContent.trim(), active: link.classList.contains('active'), current: link.getAttribute('aria-current')
      })));
      assert.deepEqual(navigation.map(({ href, label }) => ({ href, label })), expectedNav, filename);
      assert.equal(navigation.filter((link) => link.active).length, 1, filename + ': one active link');
      assert.equal(navigation.filter((link) => link.current === 'page').length, 1, filename + ': one current link');
      const current = navigation.find((link) => link.current === 'page');
      assert.equal(current.href, filename, filename + ': current href');
    }
  });
});

test('Resource Allocation is reachable without external runtime requests and seeds local data', async () => {
  await withPage(async ({ page, url }) => {
    const externalRequests = [];
    page.on('request', (request) => { if (!request.url().startsWith(url)) externalRequests.push(request.url()); });
    await page.goto(url + '/resource-allocation.html', { waitUntil: 'networkidle' });
    assert.equal(await page.title(), '资源编排台 · 团队项目与人员编排');
    assert.equal(await page.locator('#projectGrid .pcard').count(), 5);
    assert.equal(await page.locator('#roster .person-card').count(), 14);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('resboard.v1')));
    assert.equal(stored.version, 1);
    assert.equal(stored.projects.length, 5);
    assert.equal(stored.people.length, 14);
    assert.deepEqual(externalRequests, []);
  });
});

test('Resource Allocation keeps local data flow for project creation and edit', async () => {
  await withPage(async ({ page, url }) => {
    await page.goto(url + '/resource-allocation.html', { waitUntil: 'networkidle' });
    await page.locator('#btnNewProject').click();
    const dialog = page.locator('.overlay-root.is-open');
    await dialog.locator('[data-field="name"]').fill('本地测试项目');
    await dialog.locator('[data-dlg-act="save"]').click();
    await page.locator('#projectGrid .pcard').nth(5).waitFor();
    assert.equal(await page.locator('#projectGrid .pcard').count(), 6);
    assert.equal(await page.locator('#projectGrid .pname').nth(5).inputValue(), '本地测试项目');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('resboard.v1')));
    assert.ok(stored.projects.some((project) => project.name === '本地测试项目'));
    assert.equal(await page.locator('.toast').count() > 0, true);
  });
});

test('Resource Allocation stays contained at desktop and mobile viewports', async () => {
  await withPage(async ({ page, url }) => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto(url + '/resource-allocation.html', { waitUntil: 'networkidle' });
      const geometry = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth, width: innerWidth,
        app: document.querySelector('#app').getBoundingClientRect().toJSON(),
        nav: document.querySelector('.toolbox-nav').getBoundingClientRect().toJSON()
      }));
      assert.equal(geometry.scrollWidth, viewport.width, viewport.width + ': no horizontal overflow');
      assert.ok(geometry.app.left >= 0 && geometry.app.right <= viewport.width, viewport.width + ': app contained');
      assert.ok(geometry.nav.left >= 0 && geometry.nav.right <= viewport.width, viewport.width + ': nav contained');
      assert.equal(Math.round(geometry.app.top), Math.round(geometry.nav.bottom), viewport.width + ': app starts below navigation');
      if (viewport.width >= 768) {
        assert.equal(Math.round(geometry.app.height), viewport.height - Math.round(geometry.nav.height), viewport.width + ': app fits below navigation');
      }
    }
  });
});
