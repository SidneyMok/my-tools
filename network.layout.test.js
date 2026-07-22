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
    const filename = path.join(root, pathname === '/' ? 'network.html' : pathname);
    try {
      const content = await readFile(filename);
      response.writeHead(200, {
        'content-type': filename.endsWith('.css') ? 'text/css' : filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.svg') ? 'image/svg+xml' : 'text/html'
      });
      response.end(content);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function withPage(viewport, run) {
  const { server, url } = await serve();
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  try {
    return await run(page, url);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

function response(ip) {
  return {
    success: true, ip, type: ip.includes(':') ? 'IPv6' : 'IPv4', country: 'Test Country', city: 'Test City',
    connection: { asn: 64500, isp: 'Test ISP', org: 'Test Org' }, timezone: { id: 'Etc/UTC' }
  };
}

test('Network uses one workspace for initial, manual, invalid, and retryable IP queries', async () => {
  await withPage({ width: 1440, height: 900 }, async (page, baseUrl) => {
    const requests = [];
    let failures = 0;
    await page.route('https://ipwho.is/**', (route) => {
      const target = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
      requests.push(target);
      if (target === '8.8.8.8' && failures++ === 0) {
        return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ success: false }) });
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(response(target || '203.0.113.7')) });
    });
    await page.goto(`${baseUrl}/network.html`, { waitUntil: 'networkidle' });

    await assert.doesNotMatch(await page.content(), /NETWORK UTILITIES|tool-number|04/);
    await assert.doesNotMatch(await page.content(), /current-ip-status|lookup-status|retry-current-ip|retry-lookup/);
    await page.locator('#ip-result').waitFor({ state: 'visible' });
    assert.deepEqual(requests, ['']);

    await page.locator('#ip-lookup-input').fill('2606:4700:4700::1111');
    await page.locator('#ip-lookup-form').evaluate((form) => form.requestSubmit());
    await page.locator('#ip-result').waitFor({ state: 'visible' });
    assert.equal(requests.at(-1), '2606:4700:4700::1111');

    const beforeInvalid = requests.length;
    await page.locator('#ip-lookup-input').fill('999.1.1.1');
    await page.locator('#ip-lookup-form').evaluate((form) => form.requestSubmit());
    await assert.doesNotMatch(await page.locator('#ip-lookup-error').textContent(), /^$/);
    assert.equal(requests.length, beforeInvalid);

    await page.locator('#ip-lookup-input').fill('8.8.8.8');
    await page.locator('#ip-lookup-form').evaluate((form) => form.requestSubmit());
    await page.locator('#retry-ip').waitFor({ state: 'visible' });
    await page.locator('#retry-ip').click();
    await page.locator('#ip-result').waitFor({ state: 'visible' });
    assert.deepEqual(requests.slice(-2), ['8.8.8.8', '8.8.8.8']);
  });
});

test('all tool pages reference the shared local favicon', async () => {
  for (const name of ['index.html', 'html-preview.html', 'timestamp.html', 'network.html']) {
    const html = await readFile(path.join(root, name), 'utf8');
    assert.match(html, /<link rel="icon" href="favicon\.svg" type="image\/svg\+xml" \/>/);
  }
  await assert.doesNotReject(readFile(path.join(root, 'favicon.svg')));
});

test('Network compact workspace matches baseline page widths without clipping', async () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await withPage(viewport, async (page, baseUrl) => {
      await page.route('https://ipwho.is/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(response('203.0.113.7')) }));
      await page.goto(`${baseUrl}/network.html`, { waitUntil: 'networkidle' });
      const geometry = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
        const network = rect('.network-section');
        const form = rect('#ip-lookup-form');
        return { scrollWidth: document.documentElement.scrollWidth, width: innerWidth, network: { left: network.left, right: network.right, width: network.width }, form: { left: form.left, right: form.right, width: form.width } };
      });
      assert.equal(geometry.scrollWidth, viewport.width);
      assert.ok(geometry.network.left >= 0 && geometry.network.right <= viewport.width);
      assert.ok(geometry.form.left >= 0 && geometry.form.right <= viewport.width);
      if (viewport.width === 1440) assert.equal(geometry.network.width, 1040);
      else assert.equal(geometry.network.width, 390);
    });
  }
});
