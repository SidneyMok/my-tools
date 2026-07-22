import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(fileURLToPath(import.meta.url));

async function serve() {
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const filename = path.join(root, pathname === '/' ? 'network.html' : pathname);

    try {
      const content = await readFile(filename);
      response.writeHead(200, {
        'content-type': filename.endsWith('.css') ? 'text/css' : filename.endsWith('.js') ? 'text/javascript' : 'text/html'
      });
      response.end(content);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}/network.html` };
}

async function inspectLayout(viewport) {
  const { server, url } = await serve();
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true
  });
  const page = await browser.newPage({ viewport });

  try {
    await page.route('https://ipwho.is/**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        ip: '203.0.113.7',
        type: 'IPv4',
        country: 'Test Country',
        city: 'Test City',
        connection: { asn: 64500, isp: 'Test ISP', org: 'Test Org' },
        timezone: { id: 'Etc/UTC' }
      })
    }));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.locator('#ip-lookup-input').fill('8.8.8.8');
    await page.locator('#ip-lookup-form').evaluate((form) => form.requestSubmit());
    await page.locator('#lookup-result').waitFor({ state: 'visible' });
    return await page.evaluate(() => {
      const rect = (selector) => {
        const { left, right, width } = document.querySelector(selector).getBoundingClientRect();
        return { left, right, width };
      };
      return {
        viewportWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        main: rect('.network-main'),
        intro: rect('.network-main .intro'),
        current: rect('#current-ip-result'),
        lookup: rect('#lookup-result')
      };
    });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('Network desktop shell uses the available content width without horizontal overflow', async () => {
  const layout = await inspectLayout({ width: 1440, height: 900 });

  assert.equal(layout.scrollWidth, 1440);
  assert.ok(layout.main.width >= 1180, `expected main width >= 1180, received ${layout.main.width}`);
  assert.ok(layout.intro.width >= 1100, `expected intro width >= 1100, received ${layout.intro.width}`);
  assert.ok(layout.current.width >= 1100, `expected current result width >= 1100, received ${layout.current.width}`);
  assert.ok(layout.lookup.width >= 1100, `expected lookup result width >= 1100, received ${layout.lookup.width}`);
});

test('Network mobile content stays in the viewport without clipping', async () => {
  const layout = await inspectLayout({ width: 390, height: 844 });

  assert.equal(layout.scrollWidth, 390);
  for (const [name, rect] of Object.entries({ main: layout.main, intro: layout.intro, current: layout.current, lookup: layout.lookup })) {
    assert.ok(rect.left >= 0, `${name} starts outside the viewport: ${rect.left}`);
    assert.ok(rect.right <= 390, `${name} ends outside the viewport: ${rect.right}`);
    assert.ok(rect.width >= 358, `${name} is unexpectedly narrow: ${rect.width}`);
  }
});
