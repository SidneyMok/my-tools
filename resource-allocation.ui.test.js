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

function boardState(assignments) {
  return {
    version: 1,
    people: [
      { id: 'p-alice', name: 'Alice', role: '开发' },
      { id: 'p-bob', name: 'Bob', role: '测试' },
      { id: 'p-cara', name: 'Cara', role: '产品' }
    ],
    projects: [{
      id: 'project-one', name: '项目一', collapsed: false,
      requirements: [
        { id: 'req-one', role: '开发', count: 1 },
        { id: 'req-two', role: '测试', count: 1 },
        { id: 'req-three', role: '产品', count: 1 },
        { id: 'req-four', role: '设计', count: 1 },
        { id: 'req-five', role: '运维', count: 1 }
      ],
      assignments: assignments.map((personId, index) => ({
        id: 'assignment-' + index,
        requirementId: ['req-one', 'req-two', 'req-three', 'req-four', 'req-five'][index],
        personId
      }))
    }]
  };
}

async function loadBoard(page, state) {
  await page.addInitScript((value) => localStorage.setItem('resboard.v1', JSON.stringify(value)), state);
}

async function rosterOrder(page) {
  return page.locator('#roster .person-card').evaluateAll((cards) => cards.map((card) => card.dataset.personId));
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
        nav: document.querySelector('.site-header nav').getBoundingClientRect().toJSON()
      }));
      assert.equal(geometry.scrollWidth, viewport.width, viewport.width + ': no horizontal overflow');
      assert.ok(geometry.app.left >= 0 && geometry.app.right <= viewport.width, viewport.width + ': app contained');
      assert.ok(geometry.nav.left >= 0 && geometry.nav.right <= viewport.width, viewport.width + ': nav contained');
    }
  });
});

test('Resource Allocation counts every assignment record across all load surfaces', async () => {
  await withPage(async ({ page, url }) => {
    await loadBoard(page, boardState(['p-alice', 'p-alice', 'p-bob']));
    await page.goto(url + '/resource-allocation.html', { waitUntil: 'networkidle' });

    const alice = page.locator('.person-card[data-person-id="p-alice"]');
    assert.equal(await alice.getAttribute('data-load'), '2');
    assert.equal(await alice.locator('.pp-load').textContent(), '2 项');
    assert.match(await alice.locator('.pp-select').getAttribute('aria-label'), /正常 2 项/);
    const chips = page.locator('.chip[data-person-id="p-alice"]');
    assert.equal(await chips.count(), 2);
    assert.deepEqual(await chips.evaluateAll((nodes) => nodes.map((node) => ({ load: node.dataset.load, title: node.title }))), [
      { load: '2', title: 'Alice · 开发 · 正常 2 项' },
      { load: '2', title: 'Alice · 开发 · 正常 2 项' }
    ]);

    await alice.locator('[data-action="person-menu"]').click();
    await page.locator('#ppMenu [data-action="detail"]').click();
    const detail = page.locator('.overlay-root.is-open');
    assert.match(await detail.textContent(), /共 2 条分配，负载 2 项/);
    assert.equal(await detail.locator('.badge-tint').textContent(), '正常 2 项');
    await detail.locator('[data-dlg="close"]').click();
    await alice.locator('[data-action="select"]').click();
    assert.equal(await page.locator('#selectHint .badge-tint').textContent(), '正常 2 项');
  });
});

test('Resource Allocation updates load on add and remove, including saved state', async () => {
  await withPage(async ({ page, url }) => {
    await loadBoard(page, boardState(['p-alice']));
    await page.goto(url + '/resource-allocation.html', { waitUntil: 'networkidle' });
    const secondRole = page.locator('.rolerow[data-req-id="req-two"]');
    await secondRole.locator('[data-action="pick"]').click();
    await page.locator('.overlay-root.is-open [data-dlg-act="pick-person"][data-person-id="p-alice"]').click();
    assert.equal(await page.locator('.person-card[data-person-id="p-alice"] .pp-load').textContent(), '2 项');
    assert.equal(await page.locator('.chip[data-person-id="p-alice"]').count(), 2);
    let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('resboard.v1')));
    assert.equal(stored.projects[0].assignments.length, 2);

    await page.locator('.chip[data-person-id="p-alice"]').last().locator('[data-action="unassign"]').click();
    assert.equal(await page.locator('.person-card[data-person-id="p-alice"] .pp-load').textContent(), '1 项');
    assert.equal(await page.locator('.chip[data-person-id="p-alice"]').count(), 1);
    stored = await page.evaluate(() => JSON.parse(localStorage.getItem('resboard.v1')));
    assert.equal(stored.projects[0].assignments.length, 1);
  });
});

test('Resource Allocation sorts by assignment load and applies threshold labels and colors', async () => {
  await withPage(async ({ page, url }) => {
    await loadBoard(page, boardState(['p-alice', 'p-alice', 'p-alice', 'p-alice', 'p-bob']));
    await page.goto(url + '/resource-allocation.html', { waitUntil: 'networkidle' });
    assert.deepEqual(await rosterOrder(page), ['p-alice', 'p-bob', 'p-cara']);
    assert.equal(await page.locator('.person-card[data-person-id="p-alice"]').getAttribute('data-load'), '4');
    assert.equal(await page.locator('.person-card[data-person-id="p-alice"] .pp-load').textContent(), '4 项');
    assert.match(await page.locator('.person-card[data-person-id="p-alice"] .pp-select').getAttribute('aria-label'), /超载 4 项/);
    assert.equal(await page.locator('.person-card[data-person-id="p-alice"]').evaluate((card) => getComputedStyle(card).backgroundColor), 'rgb(253, 236, 236)');
    assert.equal(await page.locator('.chip[data-person-id="p-alice"]').first().evaluate((chip) => getComputedStyle(chip).backgroundColor), 'rgb(253, 236, 236)');
    assert.equal(await page.locator('#barStats .stat[data-tone="load"] .stat-num').textContent(), '1');
    assert.equal(await page.locator('#barStats .stat[data-tone="load"] .stat-cap').textContent(), '超载人数');

    await page.locator('#personSort').selectOption('load-asc');
    assert.deepEqual(await rosterOrder(page), ['p-cara', 'p-bob', 'p-alice']);
    await page.locator('#btnLegend').click();
    assert.match(await page.locator('.overlay-root.is-open').textContent(), /按分配记录数/);
    assert.match(await page.locator('.overlay-root.is-open').textContent(), /同一项目里占多个岗位会分别计数/);
  });
});

test('Resource Allocation persists and imports assignment-record load', async () => {
  await withPage(async ({ page, url }) => {
    await loadBoard(page, boardState([]));
    await page.goto(url + '/resource-allocation.html', { waitUntil: 'networkidle' });
    const imported = boardState(['p-alice', 'p-alice']);
    await page.locator('#btnData').click();
    await page.locator('.overlay-root.is-open [data-dlg-act="import"]').click();
    await page.locator('#importFile').setInputFiles({
      name: 'resource-board.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(imported))
    });
    const confirm = page.locator('.overlay-root.is-open');
    await confirm.locator('[data-dlg-act="ok"]').click();
    assert.equal(await page.locator('.person-card[data-person-id="p-alice"] .pp-load').textContent(), '2 项');
    assert.equal(await page.locator('.chip[data-person-id="p-alice"]').count(), 2);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('resboard.v1')));
    assert.equal(stored.projects[0].assignments.length, 2);
  });
});

test('Resource Allocation uses the shared navigation contract without toolbox-nav CSS', async () => {
  const source = await readFile(path.join(root, 'resource-allocation.html'), 'utf8');
  const sharedStyles = await readFile(path.join(root, 'styles.css'), 'utf8');
  assert.match(source, /<link rel="stylesheet" href="styles\.css">/);
  assert.doesNotMatch(source, /toolbox-nav/);
  assert.doesNotMatch(sharedStyles, /toolbox-nav/);
  await withPage(async ({ page, url }) => {
    await page.goto(url + '/resource-allocation.html', { waitUntil: 'networkidle' });
    const navigation = await page.locator('.site-header nav').evaluate((nav) => Array.from(nav.querySelectorAll('a'), (link) => ({
      href: link.getAttribute('href'), active: link.classList.contains('active'), current: link.getAttribute('aria-current')
    })));
    assert.deepEqual(navigation.map(({ href }) => href), expectedNav.map(({ href }) => href));
    assert.deepEqual(navigation.filter((link) => link.active || link.current === 'page'), [{ href: 'resource-allocation.html', active: true, current: 'page' }]);
  });
});
