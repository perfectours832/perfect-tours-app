'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { structuredTrip, legacyTrip, mockScript } = require('./fixtures');

const root = path.resolve(__dirname, '..');
let server;
let browser;
let baseURL;
const mimeTypes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

before(async () => {
  server = http.createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(`${root}${path.sep}`)) { res.writeHead(403).end(); return; }
    try {
      const contents = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(file)] || 'application/octet-stream' });
      res.end(contents);
    } catch { res.writeHead(404).end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function openFixture(t, options = {}) {
  const { viewport = { width: 393, height: 851 }, pathname = '/?trip=synthetic-test-token', ...mockOptions } = options;
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const errors = [];
  const external = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === baseURL) return route.continue();
    external.push(url.href);
    if (url.hostname === 'cdn.jsdelivr.net' && /^\/npm\/@supabase\/supabase-js@2(?:\.\d+\.\d+)?$/.test(url.pathname)) {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: mockScript(mockOptions) });
    }
    if (url.hostname === 'images.example.test') {
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600"><rect width="1000" height="600" fill="#6d8c86"/><path d="M0 450 L220 240 L390 350 L620 140 L1000 430 V600 H0Z" fill="#324f57"/><text x="500" y="520" fill="white" text-anchor="middle" font-family="sans-serif" font-size="32">TEST ONLY · Synthetic attraction image</text></svg>' });
    }
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    assert.deepEqual(errors, [], 'No unhandled browser exceptions');
    assert.equal(external.some(url => new URL(url).hostname.endsWith('.supabase.co')), false, 'All Supabase behavior stays inside the mock');
    await context.close();
  });
  await page.goto(`${baseURL}${pathname}`);
  return page;
}

async function assertNoOverflow(page) {
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(dimensions.scroll <= dimensions.width + 1, `Page should fit phone viewport: ${JSON.stringify(dimensions)}`);
}

async function editTrip(page) {
  await page.locator('[data-tab="tripListCard"]').click();
  await page.locator('#tripList [data-action="edit-trip"]').first().click();
  await page.locator('#itineraryEditor').waitFor({ state: 'visible' });
}

test('Android client groups days, keeps summaries compact and distinguishes booked tickets from entry time', async t => {
  const page = await openFixture(t);
  await page.locator('#timeline details').first().waitFor();
  assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
  assert.equal(await page.locator('html').getAttribute('lang'), 'he');
  await assertNoOverflow(page);
  const cards = page.locator('#timeline details');
  assert.equal(await page.locator('#timeline .pt-day-button').count(), 2);
  assert.equal(await cards.count(), 2);
  assert.match(await cards.first().locator('summary').innerText(), /08:30.*קפה/s, 'Client activities are chronological');
  const museum = cards.filter({ hasText: 'מוזיאון הוותיקן' });
  const summary = museum.locator('summary');
  const summaryText = await summary.innerText();
  assert.match(summaryText, /10:00/);
  assert.match(summaryText, /כרטיס/);
  assert.doesNotMatch(summaryText, /קומה|כתובת|10:15/);
  assert.equal(await summary.locator('a, button, input').count(), 0);
  assert.equal(await museum.getAttribute('open'), null);
  await summary.click();
  assert.match(await museum.innerText(), /10:15/);
  assert.match(await museum.innerText(), /120|שעתיים|2 שעות/);
  assert.match(await museum.innerText(), /קומה ראשונה \| סיור מודרך/);
  assert.equal(await museum.locator('img').count(), 1);
  assert.equal(await museum.locator('a[href="https://maps.example.test/museum"]').count(), 1);
  assert.equal(await museum.locator('a[href="https://documents.example.test/ticket.pdf"]').count(), 1);
  assert.match(await museum.innerText(), /דילוג|לוותר/);
  assert.match(await museum.innerText(), /החזר/);
  assert.equal(await page.locator('#clientPage a[href^="javascript:"], #clientPage img[src^="data:text/html"]').count(), 0);
  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: path.join(root, 'artifacts', 'client-android-393.png'), fullPage: true });
  await page.setViewportSize({ width: 360, height: 800 });
  await assertNoOverflow(page);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: path.join(root, 'artifacts', 'client-android-360.png'), fullPage: true });
  await page.locator('#timeline .pt-day-button').nth(1).click();
  assert.equal(await cards.count(), 1);
  const garden = cards.filter({ hasText: 'הגנים של רומא' });
  assert.doesNotMatch(await garden.locator('summary').innerText(), /כרטיס/);
  await page.locator('#langBtn').click();
  assert.equal(await page.locator('html').getAttribute('dir'), 'ltr');
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await assertNoOverflow(page);
});

test('ticket purchase alone does not invent a mandatory entry time', async t => {
  const trip = structuredClone(structuredTrip);
  trip.itinerary = [{ ...trip.itinerary[0], entry_time: '' }];
  const page = await openFixture(t, { trips: [trip] });
  await page.locator('#timeline summary').click();
  assert.equal(await page.locator('#timeline .pt-ticket').count(), 1);
  assert.equal(await page.locator('#timeline .pt-fixed-entry, #timeline .pt-entry-note').count(), 0);
  assert.match(await page.locator('#timeline .pt-ticket-note').innerText(), /החזר/);
});

test('ambiguous legacy rows remain one preserved text block instead of invented activity cards', async t => {
  const page = await openFixture(t, { trips: [legacyTrip], pathname: '/?trip=synthetic-legacy-token' });
  await page.locator('#timeline').getByText('מוזיאון הוותיקן', { exact: false }).waitFor();
  assert.equal(await page.locator('#timeline details').count(), 0);
  const text = await page.locator('#timeline').innerText();
  assert.match(text, /יום 1/);
  assert.match(text, /09:00/);
  assert.match(text, /להגיע 15 דקות/);
  assert.doesNotMatch(text, /custom_legacy|retain-me|"day"/, 'Only itinerary text is projected; internal metadata is not exposed as JSON');
  await assertNoOverflow(page);
});

test('unsupported itinerary shapes show a useful fallback without exposing raw metadata', async t => {
  for (const itinerary of [
    { internal_note: 'PRIVATE-TEST-SENTINEL', nested: { supplier_cost: 'PRIVATE-COST-SENTINEL' } },
    [null, { internal_note: 'PRIVATE-TEST-SENTINEL' }, ['PRIVATE-NESTED-SENTINEL']],
  ]) {
    const trip = { ...structuredClone(structuredTrip), itinerary };
    const page = await openFixture(t, { trips: [trip] });
    await page.locator('#timeline .pt-empty').waitFor();
    assert.match(await page.locator('#timeline').innerText(), /המסלול יתווסף בהמשך/);
    assert.doesNotMatch(await page.locator('#clientPage').innerText(), /PRIVATE-|internal_note|supplier_cost/);
    assert.equal(await page.locator('#timeline details, #timeline .pt-legacy-text').count(), 0);
    await assertNoOverflow(page);
  }
});

test('unrelated trip edits preserve legacy data and document metadata verbatim', async t => {
  const page = await openFixture(t, { trips: [legacyTrip], authenticated: true, pathname: '/' });
  await editTrip(page);
  await page.locator('#clientName').fill('שם בדיקה מעודכן TEST ONLY');
  await page.locator('#saveBtn').click();
  await page.waitForFunction(() => window.__testWrites.length === 1);
  const write = await page.evaluate(() => window.__testWrites[0]);
  assert.equal(write.operation, 'update');
  assert.deepEqual(write.filter, ['id', legacyTrip.id]);
  assert.equal(write.payload.client_name, 'שם בדיקה מעודכן TEST ONLY');
  assert.deepEqual(write.payload.itinerary, legacyTrip.itinerary);
  assert.deepEqual(write.payload.documents, legacyTrip.documents);
});

test('structured editing preserves multiline text, unknown metadata and order through save and reload', async t => {
  const trip = structuredClone(structuredTrip);
  trip.itinerary[1].map_url = '';
  trip.itinerary[1].image_url = '';
  trip.itinerary[1].document_url = '';
  const page = await openFixture(t, { trips: [trip], authenticated: true, pathname: '/' });
  await editTrip(page);
  await page.locator('[data-activity-panel="0-0"] > summary').click();
  const field = key => page.locator(`#itineraryEditor [data-day-index="0"][data-activity-index="0"][data-field="${key}"]`);
  await field('title').fill('מוזיאון מעודכן · נתוני בדיקה');
  await field('description').fill('הערה ראשונה | שער מערבי\nהערה שנייה — בלי פיצול לכרטיסים');
  await field('duration_minutes').fill('135');
  await field('entry_time').fill('10:20');
  await page.locator('[data-action="move-activity-down"][data-day-index="0"][data-activity-index="0"]').click();
  await assertNoOverflow(page);
  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: path.join(root, 'artifacts', 'editor-android.png'), fullPage: true });
  // A component capture has no page chrome. Make the sticky header static only
  // during this capture so it cannot appear halfway down the tall editor image.
  await page.locator('#itineraryEditor').screenshot({ path: path.join(root, 'artifacts', 'editor-days-android.png'), style: '.top { position: static !important; }' });
  await page.locator('#saveBtn').click();
  await page.waitForFunction(() => window.__testWrites.length === 1);
  const payload = await page.evaluate(() => window.__testWrites[0].payload);
  assert.deepEqual(payload.itinerary.map(item => item.activity_id), ['test-breakfast', 'test-museum', 'test-gardens']);
  const museum = payload.itinerary.find(item => item.activity_id === 'test-museum');
  assert.equal(museum.title, 'מוזיאון מעודכן · נתוני בדיקה');
  assert.equal(museum.description, 'הערה ראשונה | שער מערבי\nהערה שנייה — בלי פיצול לכרטיסים');
  assert.equal(museum.duration_minutes, 135);
  assert.equal(museum.entry_time, '10:20');
  assert.deepEqual(museum.supplier_reference, trip.itinerary[0].supplier_reference);
  assert.deepEqual(payload.documents, trip.documents);

  await editTrip(page);
  await page.locator('[data-activity-panel="0-1"] > summary').click();
  assert.equal(await page.locator('[data-day-index="0"][data-activity-index="1"][data-field="description"]').inputValue(), museum.description);
  assert.equal(await page.locator('[data-day-index="0"][data-activity-index="1"][data-field="duration_minutes"]').inputValue(), '135');
});

test('a new draft trip saves an empty day and a moved activity, then reloads both', async t => {
  const page = await openFixture(t, { trips: [], authenticated: true, pathname: '/' });
  await page.locator('[data-new-trip]').first().click();
  await page.locator('#clientName').fill('לקוח חדש לבדיקה TEST ONLY');
  await page.locator('#destination').fill('יעד בדיקה חדש');
  await page.locator('#startDate').fill('2026-11-10');
  await page.locator('#endDate').fill('2026-11-12');
  assert.equal(await page.locator('#tripStatus').inputValue(), 'draft');
  await page.locator('[data-action="add-day"]').click();
  await page.locator('[data-day-index="0"][data-field="label"]').fill('יום מנוחה');
  await page.locator('[data-day-index="0"][data-field="date"]').fill('2026-11-10');
  await page.locator('[data-action="add-day"]').click();
  await page.locator('[data-day-index="1"][data-field="label"]').fill('יום סיורים');
  await page.locator('[data-day-index="1"][data-field="date"]').fill('2026-11-11');
  await page.locator('[data-action="add-activity"][data-day-index="0"]').click();
  await page.locator('[data-day-index="0"][data-activity-index="0"][data-field="title"]').fill('סיור חדש לבדיקה');
  await page.locator('[data-day-index="0"][data-activity-index="0"][data-field="description"]').fill('פעילות בדיקה | שעה מומלצת\nאפשר לבחור בקצב אישי');
  await page.locator('[data-day-index="0"][data-activity-index="0"][data-field="time"]').fill('09:30');
  await page.locator('[data-day-index="0"][data-activity-index="0"][data-field="duration_minutes"]').fill('60');
  await page.locator('[data-move-to][data-day-index="0"][data-activity-index="0"]').selectOption('1');
  assert.equal(await page.locator('[data-day-panel="0"] .editor-activity').count(), 0);
  assert.equal(await page.locator('[data-day-panel="1"] .editor-activity').count(), 1);
  await page.locator('#saveBtn').click();
  await page.waitForFunction(() => window.__testWrites.length === 1);
  const write = await page.evaluate(() => window.__testWrites[0]);
  assert.equal(write.operation, 'insert');
  assert.equal(write.payload.status, 'draft');
  assert.match(write.payload.public_id, /^[a-f0-9]{32}$/);
  assert.equal(write.payload.itinerary.length, 2);
  const emptyDay = write.payload.itinerary[0];
  const activity = write.payload.itinerary[1];
  assert.equal(emptyDay.kind, 'day');
  assert.equal(emptyDay.day, 'יום מנוחה');
  assert.equal(emptyDay.day_date, '2026-11-10');
  assert.equal(activity.day, 'יום סיורים');
  assert.equal(activity.day_date, '2026-11-11');
  assert.equal(activity.title, 'סיור חדש לבדיקה');
  assert.equal(activity.time, '09:30');
  assert.equal(activity.duration_minutes, 60);
  assert.ok(activity.activity_id);
  assert.notEqual(emptyDay.day_id, activity.day_id);
  await editTrip(page);
  assert.equal(await page.locator('.editor-day').count(), 2);
  assert.equal(await page.locator('[data-day-index="0"][data-field="label"]').inputValue(), 'יום מנוחה');
  assert.equal(await page.locator('[data-day-panel="0"] .editor-activity').count(), 0);
  await page.locator('[data-activity-panel="1-0"] > summary').click();
  assert.equal(await page.locator('[data-day-index="1"][data-activity-index="0"][data-field="title"]').inputValue(), activity.title);
  assert.equal(await page.locator('[data-day-index="1"][data-activity-index="0"][data-field="description"]').inputValue(), activity.description);
  await page.locator('#clientName').fill('לקוח חדש אחרי טעינה TEST ONLY');
  await page.locator('#saveBtn').click();
  await page.waitForFunction(() => window.__testWrites.length === 2);
  assert.deepEqual(await page.evaluate(() => window.__testWrites[1].payload.itinerary), write.payload.itinerary);
});

test('legacy import requires a valid preview and explicit apply, and leaves the source available', async t => {
  const page = await openFixture(t, { trips: [legacyTrip], authenticated: true, pathname: '/' });
  await editTrip(page);
  await page.locator('.editor-import > summary').click();
  await page.locator('[data-import-text]').fill('09:00\nשם פעילות\nהערה');
  await page.locator('[data-action="preview-import"]').click();
  assert.equal(await page.locator('[data-action="apply-import"]').count(), 0);
  assert.equal(await page.evaluate(() => window.__testWrites.length), 0);
  await page.locator('[data-import-text]').fill('יום 1 | 09:00 | סיור בדיקה | להגיע לשער | | |');
  await page.locator('[data-action="preview-import"]').click();
  await page.locator('[data-action="apply-import"]').waitFor();
  assert.equal(await page.locator('.editor-day').count(), 0, 'Preview has not changed the active itinerary');
  assert.equal(await page.evaluate(() => window.__testWrites.length), 0);
  await page.locator('[data-action="apply-import"]').click();
  assert.equal(await page.locator('.editor-day').count(), 1);
  assert.equal(await page.locator('[data-action="download-original"]').count(), 1);
  assert.equal(await page.evaluate(() => window.__testWrites.length), 0, 'Apply is still local until the trip is saved');
  await page.locator('#saveBtn').click();
  await page.waitForFunction(() => window.__testWrites.length === 1);
  const payload = await page.evaluate(() => window.__testWrites[0].payload);
  assert.equal(payload.itinerary.length, 1);
  assert.equal(payload.itinerary[0].title, 'סיור בדיקה');
});

test('a failed save keeps unsaved editor changes available for retry', async t => {
  const page = await openFixture(t, { authenticated: true, pathname: '/' });
  await editTrip(page);
  await page.locator('#clientName').fill('שינוי ממתין לשמירה TEST ONLY');
  await page.evaluate(() => { window.__testFailure = 'Synthetic save failure'; });
  await page.locator('#saveBtn').click();
  await page.waitForFunction(() => document.getElementById('saveError').textContent.includes('Synthetic save failure'));
  assert.equal(await page.locator('#clientName').inputValue(), 'שינוי ממתין לשמירה TEST ONLY');
  assert.equal(await page.locator('#itineraryEditor').isVisible(), true);
  assert.equal(await page.evaluate(() => window.__testWrites.length), 0);
  await page.evaluate(() => { window.__testFailure = null; });
  await page.locator('#saveBtn').click();
  await page.waitForFunction(() => window.__testWrites.length === 1);
});

test('unknown public trip token shows a useful error without loading admin data', async t => {
  const page = await openFixture(t, { pathname: '/?trip=unknown-synthetic-token' });
  await page.getByText(/הקישור.*(?:תקין|זמין)/).waitFor();
  assert.equal(await page.locator('#adminPage').isVisible(), false);
  const calls = await page.evaluate(() => window.__testCalls);
  assert.equal(calls.some(call => call.table === 'trips'), false);
  assert.equal(await page.evaluate(() => window.__testWrites.length), 0);
});

test('login and logout continue to use the Supabase auth flow and clear the dashboard', async t => {
  const page = await openFixture(t, { pathname: '/' });
  await page.locator('#loginCard').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#dashboard').isVisible(), false);
  assert.equal(await page.evaluate(() => window.__testCalls.some(call => call.table === 'trips')), false);
  await page.locator('#email').fill('test@example.test');
  await page.locator('#password').fill('SYNTHETIC-NOT-A-REAL-PASSWORD');
  await page.locator('#loginForm button[type="submit"], #loginForm button').first().click();
  await page.locator('#dashboard').waitFor({ state: 'visible' });
  await page.waitForFunction(() => window.__testCalls.some(call => call.table === 'trips'));
  assert.equal(await page.locator('#password').inputValue(), '');
  assert.equal(await page.locator('#loginCard').isVisible(), false);
  await page.locator('#logoutBtn').click();
  await page.locator('#loginCard').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#dashboard').isVisible(), false);
  assert.equal(await page.locator('#tripList .trip').count(), 0);
  assert.equal(await page.evaluate(() => window.__testWrites.length), 0);
});

test('historical entry pages preserve personal links and anchors when routing to the canonical app', async t => {
  const page = await openFixture(t, { pathname: '/client.html?id=synthetic-test-token&source=test#schedule' });
  await page.locator('#timeline summary').first().waitFor();
  let url = new URL(page.url());
  assert.equal(url.pathname, '/');
  assert.equal(url.searchParams.get('trip'), structuredTrip.public_id);
  assert.equal(url.searchParams.get('source'), 'test');
  assert.equal(url.searchParams.has('id'), false);
  assert.equal(url.hash, '#schedule');
  await page.goto(`${baseURL}/index-new.html?trip=synthetic-test-token#docs`);
  await page.locator('#timeline summary').first().waitFor();
  url = new URL(page.url());
  assert.equal(url.pathname, '/');
  assert.equal(url.searchParams.get('trip'), structuredTrip.public_id);
  assert.equal(url.hash, '#docs');
  await page.goto(`${baseURL}/admin.html?source=recovery#loginCard`);
  await page.locator('#loginCard').waitFor({ state: 'visible' });
  url = new URL(page.url());
  assert.equal(url.pathname, '/');
  assert.equal(url.searchParams.get('source'), 'recovery');
  assert.equal(url.hash, '#loginCard');
});

test('document reordering, deletion and renaming preserve metadata on the correct document', async t => {
  const trip = structuredClone(structuredTrip);
  trip.documents = [
    { id: 'test-doc-a', name: 'טיסה לבדיקה', url: 'https://documents.example.test/a.pdf', private_metadata: { source: 'A' } },
    { id: 'test-doc-b', name: 'מלון לבדיקה', url: 'https://documents.example.test/b.pdf', private_metadata: { source: 'B' } },
    { id: 'test-doc-c', name: 'סיור לבדיקה', url: 'https://documents.example.test/c.pdf', private_metadata: { source: 'C' } },
  ];
  const page = await openFixture(t, { trips: [trip], authenticated: true, pathname: '/' });
  await editTrip(page);
  await page.locator('#documents').fill([
    'סיור לבדיקה | https://documents.example.test/c.pdf',
    'טיסה לבדיקה | https://documents.example.test/a.pdf',
    'מלון לבדיקה | https://documents.example.test/b.pdf',
  ].join('\n'));
  await page.locator('#saveBtn').click();
  await page.waitForFunction(() => window.__testWrites.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__testWrites[0].payload.documents), [trip.documents[2], trip.documents[0], trip.documents[1]]);
  await editTrip(page);
  await page.locator('#documents').fill([
    'מלון בשם חדש לבדיקה | https://documents.example.test/b.pdf',
    'סיור לבדיקה | https://documents.example.test/c-updated.pdf',
    'מסמך חדש לבדיקה | https://documents.example.test/new.pdf',
  ].join('\n'));
  await page.locator('#saveBtn').click();
  await page.waitForFunction(() => window.__testWrites.length === 2);
  const documents = await page.evaluate(() => window.__testWrites[1].payload.documents);
  assert.deepEqual(documents, [
    { ...trip.documents[1], name: 'מלון בשם חדש לבדיקה' },
    { ...trip.documents[2], url: 'https://documents.example.test/c-updated.pdf' },
    { name: 'מסמך חדש לבדיקה', url: 'https://documents.example.test/new.pdf' },
  ]);
});

test('dismissing cancellation of metadata-only edits preserves the unsaved form', async t => {
  const otherTrip = { ...structuredClone(structuredTrip), id: 'test-other-trip', public_id: 'test-other-public', client_name: 'לקוח בדיקה אחר' };
  const page = await openFixture(t, { trips: [structuredTrip, otherTrip], authenticated: true, pathname: '/' });
  const dialogs = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await editTrip(page);
  await page.locator('#clientName').fill('שם שלא נשמר TEST ONLY');
  await page.locator('#hotelName').fill('מלון שלא נשמר TEST ONLY');
  await page.locator('#cancelBtn').click();
  assert.equal(dialogs.length, 1);
  assert.equal(await page.locator('#clientName').inputValue(), 'שם שלא נשמר TEST ONLY');
  assert.equal(await page.locator('#hotelName').inputValue(), 'מלון שלא נשמר TEST ONLY');
  assert.equal(await page.locator('#itineraryEditor').isVisible(), true);
  await page.locator('[data-new-trip]').first().click();
  assert.equal(dialogs.length, 2);
  assert.equal(await page.locator('#editId').inputValue(), structuredTrip.id);
  await page.locator('[data-tab="tripListCard"]').click();
  await page.locator('#tripList [data-action="edit-trip"][data-id="test-other-trip"]').click();
  assert.equal(dialogs.length, 3);
  assert.equal(await page.locator('#editId').inputValue(), structuredTrip.id);
  assert.equal(await page.locator('#clientName').inputValue(), 'שם שלא נשמר TEST ONLY');
  assert.equal(await page.evaluate(() => window.__testWrites.length), 0);
});

test('an in-flight save locks administrative controls until the response completes', async t => {
  const page = await openFixture(t, { authenticated: true, pathname: '/' });
  await editTrip(page);
  await page.locator('#clientName').fill('שם בזמן שמירה TEST ONLY');
  await page.evaluate(() => { window.__testDelay['trips:update'] = true; });
  await page.locator('#saveBtn').click();
  await page.waitForFunction(() => window.__testPending.some(item => item.key === 'trips:update'));
  assert.equal(await page.locator('#adminPage').evaluate(element => element.inert), true);
  assert.equal(await page.locator('#tripForm').getAttribute('aria-busy'), 'true');
  assert.equal(await page.locator('#saveBtn').isDisabled(), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.getElementById('adminPage').contains(document.activeElement)), false, 'The pending form is excluded from keyboard focus');
  await assert.rejects(page.locator('[data-new-trip]').first().click({ timeout: 250 }), /Timeout/);
  assert.equal(await page.locator('#editId').inputValue(), structuredTrip.id);
  assert.equal(await page.locator('#clientName').inputValue(), 'שם בזמן שמירה TEST ONLY');
  await page.evaluate(() => { window.__testRelease('trips:update'); });
  await page.waitForFunction(() => !document.getElementById('adminPage').inert);
  assert.equal(await page.locator('#tripForm').getAttribute('aria-busy'), null);
  assert.equal(await page.locator('#saveBtn').isDisabled(), false);
  assert.equal(await page.locator('#tripListCard').isVisible(), true);
  assert.equal(await page.locator('#editId').inputValue(), '');
  assert.equal(await page.evaluate(() => window.__testWrites.length), 1);
});

test('late responses from the previous session cannot restore customer data after logout', async t => {
  const page = await openFixture(t, { pathname: '/' });
  await page.locator('#loginCard').waitFor({ state: 'visible' });
  await page.evaluate(() => {
    window.__testDelay['trips:select'] = true;
    window.__testDelay['business_settings:select'] = true;
    window.__testAuthEvent({ user: { id: 'test-previous-owner', email: 'previous@example.test' } });
  });
  await page.waitForFunction(() => window.__testPending.length === 2);
  await page.locator('#logoutBtn').click();
  await page.locator('#loginCard').waitFor({ state: 'visible' });
  await page.evaluate(async () => {
    window.__testRelease();
    await new Promise(resolve => requestAnimationFrame(resolve));
  });
  assert.equal(await page.locator('#dashboard').isVisible(), false);
  assert.equal(await page.locator('#tripList .trip').count(), 0);
  assert.equal(await page.locator('#tripCount').innerText(), '0');
  assert.equal(await page.locator('#adminBrandName').innerText(), 'Perfect Tours');
  assert.equal(await page.locator('#businessName').inputValue(), 'Perfect Tours');
  assert.equal(await page.evaluate(() => window.__testWrites.length), 0);
});

test('a draft returned by the RPC remains hidden in the client presentation', async t => {
  const trip = { ...structuredClone(structuredTrip), status: 'draft' };
  const page = await openFixture(t, { trips: [trip] });
  await page.getByText(/המסלול עדיין בהכנה/).waitFor();
  assert.equal(await page.locator('#clientPage').isVisible(), false);
  assert.equal(await page.locator('#timeline details').count(), 0);
  assert.equal(await page.locator('#adminPage').isVisible(), false);
  assert.equal(await page.evaluate(() => window.__testWrites.length), 0);
});
