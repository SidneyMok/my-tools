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
        header: document.querySelector('.site-header').getBoundingClientRect().toJSON(),
        nav: document.querySelector('.site-header nav').getBoundingClientRect().toJSON()
      }));
      assert.equal(geometry.scrollWidth, viewport.width, viewport.width + ': no horizontal overflow');
      assert.ok(geometry.app.left >= 0 && geometry.app.right <= viewport.width, viewport.width + ': app contained');
      assert.ok(geometry.nav.left >= 0 && geometry.nav.right <= viewport.width, viewport.width + ': nav contained');
      assert.ok(geometry.app.top >= geometry.header.bottom, viewport.width + ': app starts below header');
    }
  });
});

test('shared mobile navigation keeps every link inside the header and hit-testable', async () => {
  await withPage(async ({ page, url }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url + '/resource-allocation.html', { waitUntil: 'networkidle' });
    const links = await page.locator('.site-header nav a').evaluateAll((anchors) => anchors.map((anchor) => {
      const rect = anchor.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        label: anchor.textContent.trim(),
        withinHeader: rect.top >= anchor.closest('.site-header').getBoundingClientRect().top &&
          rect.bottom <= anchor.closest('.site-header').getBoundingClientRect().bottom,
        hitAnchor: hit === anchor || anchor.contains(hit)
      };
    }));

    assert.equal(links.length, 8);
    for (const link of links) {
      assert.equal(link.withinHeader, true, link.label + ': link box is inside header');
      assert.equal(link.hitAnchor, true, link.label + ': link center hit-tests its anchor');
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

test('Resource Allocation renders every person and keeps all four sort modes without filter controls', async () => {
  const source = await readFile(path.join(root, 'resource-allocation.html'), 'utf8');
  assert.doesNotMatch(source, /personQuery|personRoleFilter|ui\.personQuery|ui\.personRole\b|el\.personQuery|el\.personRoleFilter|搜索姓名|按姓名筛选|没有符合条件的人员|人员筛选/);
  assert.doesNotMatch(source, /refreshRoleFilter|ui\.personQuery|ui\.personRole|el\.personQuery|el\.personRoleFilter/);
  assert.doesNotMatch(source, /\.region-people \.field-wrap|\.region-people \.field-wrap input/);
  assert.match(source, /id="personSort"/);
  assert.match(source, /load-desc/);
  assert.match(source, /load-asc/);
  assert.match(source, /value="role"/);
  assert.match(source, /value="name"/);

  await withPage(async ({ page, url }) => {
    const state = boardState(['p-alice', 'p-alice', 'p-bob']);
    state.people.push({ id: 'p-delta', name: 'Zed', role: '测试' });
    state.people.push({ id: 'p-echo', name: 'Aaron', role: '设计' });
    await loadBoard(page, state);
    await page.goto(url + '/resource-allocation.html', { waitUntil: 'networkidle' });
    assert.equal(await page.locator('#personQuery').count(), 0);
    assert.equal(await page.locator('#personRoleFilter').count(), 0);
    assert.deepEqual(await page.locator('#personSort option').evaluateAll((options) => options.map((option) => option.value)), ['load-desc', 'load-asc', 'role', 'name']);
    assert.equal(await page.locator('#personSort').inputValue(), 'load-desc');
    assert.equal(await page.locator('#roster .person-card').count(), state.people.length);
    assert.equal(await page.locator('#peopleCount').textContent(), state.people.length + ' 人');
    assert.deepEqual(await rosterOrder(page), ['p-alice', 'p-bob', 'p-echo', 'p-cara', 'p-delta']);

    await page.locator('#personSort').selectOption('load-asc');
    assert.deepEqual(await rosterOrder(page), ['p-echo', 'p-cara', 'p-delta', 'p-bob', 'p-alice']);
    assert.equal(await page.locator('#peopleCount').textContent(), state.people.length + ' 人');
    await page.locator('#personSort').selectOption('role');
    assert.deepEqual(await rosterOrder(page), ['p-bob', 'p-delta', 'p-cara', 'p-alice', 'p-echo']);
    assert.equal(await page.locator('#peopleCount').textContent(), state.people.length + ' 人');
    await page.locator('#personSort').selectOption('name');
    assert.deepEqual(await rosterOrder(page), ['p-echo', 'p-alice', 'p-bob', 'p-cara', 'p-delta']);
    assert.equal(await page.locator('#peopleCount').textContent(), state.people.length + ' 人');

    const beforeCollapse = await page.evaluate(() => ({
      people: [...document.querySelectorAll('#roster .person-card')].map((card) => card.dataset.personId),
      count: document.querySelector('#peopleCount').textContent,
      rail: document.querySelector('.region-people').getBoundingClientRect().toJSON()
    }));
    await page.locator('#btnTogglePeople').click();
    assert.equal(await page.locator('#app').getAttribute('data-people'), 'collapsed');
    assert.equal(await page.locator('#btnTogglePeople').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('#people-body').isHidden(), true);
    assert.equal(await page.locator('#roster').isHidden(), true);
    const collapsedRail = await page.locator('.region-people').evaluate((people) => ({
      visible: getComputedStyle(people).display !== 'none',
      rect: people.getBoundingClientRect().toJSON()
    }));
    assert.equal(collapsedRail.visible, true);
    assert.equal(collapsedRail.rect.width, 56);
    assert.equal(collapsedRail.rect.height, beforeCollapse.rail.height);

    await page.locator('#btnTogglePeople').click();
    assert.equal(await page.locator('#app').getAttribute('data-people'), 'expanded');
    assert.equal(await page.locator('#btnTogglePeople').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#roster').isHidden(), false);
    assert.deepEqual(await rosterOrder(page), beforeCollapse.people);
    assert.equal(await page.locator('#peopleCount').textContent(), beforeCollapse.count);
    assert.equal(await page.locator('#personSort').inputValue(), 'name');
  });
});

test('Resource Allocation gives the roster released header space and preserves the collapsed rail', async () => {
  await withPage(async ({ page, url }) => {
    const baseline = {
      desktop: { peopleTop: 122.890625, rosterTop: 381.0625, rosterHeight: 518.9375 },
      mobile: { peopleTop: 2724.03125, rosterTop: 2872.03125 }
    };
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto(url + '/resource-allocation.html', { waitUntil: 'networkidle' });
      const geometry = await page.evaluate(() => {
        const box = (selector) => document.querySelector(selector).getBoundingClientRect();
        const people = box('.region-people');
        const roster = box('#roster');
        return { peopleTop: people.top, rosterTop: roster.top, rosterHeight: roster.height, scrollWidth: document.documentElement.scrollWidth };
      });
      const expected = viewport.width === 1440 ? baseline.desktop : baseline.mobile;
      assert.ok(geometry.peopleTop <= expected.peopleTop, viewport.width + ': people panel moved up or stayed put');
      assert.ok(geometry.rosterTop < expected.rosterTop, viewport.width + ': roster starts above baseline');
      if (viewport.width === 1440) assert.ok(geometry.rosterHeight > expected.rosterHeight, 'desktop roster is taller than baseline');
      assert.equal(geometry.scrollWidth, viewport.width, viewport.width + ': no horizontal overflow');
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url + '/resource-allocation.html', { waitUntil: 'networkidle' });
    await page.locator('#btnTogglePeople').click();
    const rail = await page.locator('.region-people').evaluate((people) => {
      const region = people.getBoundingClientRect();
      const head = people.querySelector('.region-head').getBoundingClientRect();
      const label = people.querySelector('.people-rail-label').getBoundingClientRect();
      return { width: region.width, height: region.height, headWidth: head.width, headHeight: head.height, label: label.toJSON() };
    });
    assert.equal(rail.width, 56);
    assert.equal(rail.headWidth, 55);
    assert.equal(rail.headHeight, rail.height);
    assert.ok(rail.label.height > 0);
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

test('Resource Allocation isolates app branding and matches the shared header at desktop and mobile', async () => {
  const source = await readFile(path.join(root, 'resource-allocation.html'), 'utf8');
  const inlineStyles = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n');
  assert.match(inlineStyles, /\.site-header\s*>\s*\.brand\s*\{/);
  assert.match(inlineStyles, /\.site-header\s*>\s*\.brand\s*>\s*\.brand-mark\s*\{/);
  assert.doesNotMatch(inlineStyles, /(^|[,}\n])\s*\.brand-mark\s*\{/m, 'inline app CSS cannot use an unscoped brand mark selector');
  assert.doesNotMatch(inlineStyles, /(^|[,{]\s*)(?:nav|nav\s+a|\.brand(?:\b|[.#:[\s]))/m, 'inline app CSS has no global navigation or brand selector');
  assert.doesNotMatch(source, /class="brand-mark"[^>]*>[\s\S]*?<\/span>\s*<span class="od-stack bar-brand-text"/, 'app shell has no internal brand icon');

  await withPage(async ({ page, url }) => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const headers = {};
      for (const filename of ['timestamp.html', 'resource-allocation.html']) {
        await page.goto(url + '/' + filename, { waitUntil: 'networkidle' });
        headers[filename] = await page.evaluate(() => {
          const rect = (selector) => {
            const { x, y, width, height, right, bottom } = document.querySelector(selector).getBoundingClientRect();
            return { x, y, width, height, right, bottom };
          };
          const style = (selector) => {
            const computed = getComputedStyle(document.querySelector(selector));
            return {
              fontFamily: computed.fontFamily,
              font: computed.font,
              fontSize: computed.fontSize,
              fontWeight: computed.fontWeight,
              lineHeight: computed.lineHeight,
              letterSpacing: computed.letterSpacing,
              color: computed.color,
              backgroundColor: computed.backgroundColor,
              gap: computed.gap,
              padding: computed.padding,
              display: computed.display,
              borderBottom: computed.borderBottom
            };
          };
          return {
            viewport: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            header: rect('.site-header'),
            brand: rect('.site-header .brand'),
            mark: rect('.site-header .brand-mark'),
            wordmark: rect('.site-header .brand > span:last-child'),
            nav: rect('.site-header nav'),
            links: [...document.querySelectorAll('.site-header nav a')].map((link) => {
              const { x, y, width, height, right, bottom } = link.getBoundingClientRect();
              const computed = getComputedStyle(link);
              return { href: link.getAttribute('href'), x, y, width, height, right, bottom };
            }),
            headerStyle: style('.site-header'),
            brandStyle: style('.site-header .brand'),
            markStyle: style('.site-header .brand-mark'),
            navStyle: style('.site-header nav'),
            linkStyle: style('.site-header nav a'),
            activeLinkStyle: style('.site-header nav a.active')
          };
        });
      }
      const reference = headers['timestamp.html'];
      const candidate = headers['resource-allocation.html'];
      for (const key of ['header', 'brand', 'mark', 'wordmark', 'nav', 'headerStyle', 'brandStyle', 'markStyle', 'navStyle', 'linkStyle', 'activeLinkStyle']) {
        assert.deepEqual(candidate[key], reference[key], viewport.width + ': shared header ' + key);
      }
      assert.deepEqual(candidate.links.map(({ href }) => href), reference.links.map(({ href }) => href), viewport.width + ': nav order');
      for (const referenceLink of reference.links.filter((link) => !link.active)) {
        const candidateLink = candidate.links.find(({ href }) => href === referenceLink.href);
        assert.deepEqual(candidateLink, referenceLink, viewport.width + ': nav geometry ' + referenceLink.href);
      }
      assert.equal(candidate.links.filter((link) => link.href === 'resource-allocation.html').length, 1, viewport.width + ': Resource Allocation link');
      assert.equal(candidate.activeLinkStyle.borderBottom, reference.activeLinkStyle.borderBottom, viewport.width + ': active underline');
      assert.equal(candidate.scrollWidth, viewport.width, viewport.width + ': no horizontal overflow');
      await page.goto(url + '/resource-allocation.html', { waitUntil: 'networkidle' });
      assert.equal(await page.locator('.app-bar .brand-mark').count(), 0, 'no internal app-shell brand icon');
    }
  });
});
