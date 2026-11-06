'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { structuredTrip, mockScript } = require('./fixtures');

const root = path.resolve(__dirname, '..');
let server, browser, baseURL;
const mimeTypes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

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

function feedbackTrip() {
  const trip = structuredClone(structuredTrip);
  // The base fixture intentionally contains unsafe legacy URLs. Phase D
  // approval edits use valid synthetic documents and locations only.
  trip.itinerary[1].map_url = '';
  trip.itinerary[1].image_url = '';
  trip.itinerary[1].document_url = '';
  return trip;
}

async function openFixture(t, options = {}) {
  const { pathname = '/?trip=synthetic-test-token', ...overrides } = options;
  const config = { feedbackEnabled: true, trips: [feedbackTrip()], authenticated: true, ...overrides };
  const context = await browser.newContext({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const errors = [];
  const attemptedSupabase = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === baseURL) return route.continue();
    if (url.hostname.endsWith('.supabase.co')) attemptedSupabase.push(url.href);
    if (url.hostname === 'cdn.jsdelivr.net' && /^\/npm\/@supabase\/supabase-js@2(?:\.\d+\.\d+)?$/.test(url.pathname)) {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: mockScript(config) });
    }
    if (url.hostname === 'images.example.test') {
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="540"><rect width="900" height="540" fill="#587777"/><path d="M0 450L240 170L430 320L620 100L900 420V540H0Z" fill="#243f4a"/><text x="450" y="490" fill="white" text-anchor="middle" font-family="sans-serif" font-size="28">TEST ONLY · Synthetic trip image</text></svg>' });
    }
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    try {
      assert.deepEqual(errors, [], 'No unhandled browser exceptions');
      assert.deepEqual(attemptedSupabase, [], 'No real Supabase/customer request is made');
    } finally { await context.close(); }
  });
  await page.goto(`${baseURL}${pathname}`);
  return page;
}

const activity = (page, id = 'test-museum') => page.locator(`[data-cf-activity="${id}"]`);
const activityForm = (page, id) => activity(page, id).locator('.cf-activity-form');
const requestForm = (page, id) => activity(page, id).locator('.cf-request-form');
const chooseRating = (form, name, value) => form.locator(`label.cf-rating-option:has(input[name="${name}"][value="${value}"])`).click();
async function openActivity(page, id = 'test-museum') {
  const card = page.locator(`details[data-activity-id="${id}"]`);
  await card.waitFor();
  if (await card.getAttribute('open') === null) await card.locator(':scope > summary').click();
  await activityForm(page, id).waitFor();
  return activityForm(page, id);
}
async function assertNoOverflow(page) {
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  assert.equal(fits, true, 'Feedback fits the Android phone viewport');
}
async function waitRpcWrite(page, name, count = 1) {
  await page.waitForFunction(({ name, count }) => window.__testRpcWrites.filter(write => write.rpc === name).length >= count, { name, count });
}
async function agentTab(page) {
  await page.goto(`${baseURL}/`);
  await page.locator('[data-tab="feedbackCard"]').click();
  await page.locator('#agentFeedback [data-af-trip]').selectOption('test-trip-1');
  await page.locator('#agentFeedback').waitFor({ state: 'visible' });
  await page.locator('#agentFeedback [data-af-activity="test-museum"]').waitFor();
}
async function openRequest(page) {
  await openActivity(page);
  const details = activity(page).locator('.cf-request-details');
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
  return requestForm(page);
}
async function sendRequest(page, message = 'נעדיף להתחיל מאוחר יותר · בקשת בדיקה') {
  const form = await openRequest(page);
  await form.locator('[name="message"]').fill(message);
  await form.locator('button[type="submit"]').click();
  await form.locator('.cf-message').waitFor({ state: 'visible' });
  return page.evaluate(() => window.__testFeedback['test-trip-1'].requests.at(-1).id);
}

test('activity completion, rating, comment and delay survive a client reload without changing the official itinerary', async t => {
  const page = await openFixture(t);
  let form = await openActivity(page);
  assert.equal(await activity(page).locator('.cf-current-status').getAttribute('data-status'), 'unreported');
  await form.locator('[name="status"][value="done"]').check();
  await chooseRating(form, 'rating', 5);
  await form.locator('[name="delay_minutes"]').fill('20');
  await form.locator('[name="comment"]').fill('חוויה מצוינת — משוב בדיקה בלבד');
  await form.locator('button[type="submit"]').click();
  await waitRpcWrite(page, 'pt_feedback_save_activity');
  await form.locator('.cf-message').waitFor({ state: 'visible' });
  assert.equal(await activity(page).locator('.cf-current-status').getAttribute('data-status'), 'done');
  assert.equal(await page.evaluate(() => window.__testWrites.length), 0);
  assert.deepEqual(await page.evaluate(() => window.__testTrips[0].itinerary), feedbackTrip().itinerary);
  await page.reload();
  form = await openActivity(page);
  assert.equal(await form.locator('[name="status"][value="done"]').isChecked(), true);
  assert.equal(await form.locator('[name="rating"][value="5"]').isChecked(), true);
  assert.equal(await form.locator('[name="delay_minutes"]').inputValue(), '20');
  assert.equal(await form.locator('[name="comment"]').inputValue(), 'חוויה מצוינת — משוב בדיקה בלבד');
  await assertNoOverflow(page);
  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: path.join(root, 'artifacts', 'feedback-client-android.png'), fullPage: true });
  await activity(page).screenshot({ path: path.join(root, 'artifacts', 'feedback-activity-android.png') });
  await agentTab(page);
  const agentReport = page.locator('[data-af-activity="test-museum"]');
  await agentReport.locator('.af-status-done').waitFor();
  assert.match(await agentReport.innerText(), /5\s*\/\s*5/);
  assert.match(await agentReport.innerText(), /20/);
  assert.match(await agentReport.innerText(), /חוויה מצוינת/);
  assert.equal(await page.locator('[data-af-activity="test-breakfast"] .af-status-unreported').count(), 1);
  await page.locator('[data-af-day]').selectOption('test-day-2');
  assert.equal(await page.locator('[data-af-activity="test-gardens"] .af-status-unreported').count(), 1);
});

test('a purchased activity can be skipped with a reason and never cancels its booking', async t => {
  const page = await openFixture(t);
  const form = await openActivity(page);
  await form.locator('[name="status"][value="skipped"]').check();
  await form.locator('button[type="submit"]').click();
  assert.equal(await page.evaluate(() => window.__testRpcWrites.length), 0, 'Skipping requires a reason');
  await form.locator('[name="reason"]').fill('מעדיפים לנוח היום · בדיקה');
  await form.locator('button[type="submit"]').click();
  await waitRpcWrite(page, 'pt_feedback_save_activity');
  const report = await page.evaluate(() => window.__testFeedback['test-trip-1'].reports[0]);
  assert.equal(report.status, 'skipped');
  assert.equal(report.reason, 'מעדיפים לנוח היום · בדיקה');
  assert.equal(await page.evaluate(() => window.__testTrips[0].itinerary[0].reservation_status), 'confirmed');
  assert.equal(await page.evaluate(() => window.__testTrips[0].itinerary[0].ticket_purchased), true);
  assert.equal(await page.evaluate(() => window.__testWrites.length), 0);
  assert.match(await page.locator('details[data-activity-id="test-museum"]').innerText(), /אינו מבטל|לא מבטל/);
});

test('past activity times stay unreported in both client and agent views until the client reports', async t => {
  const trip = feedbackTrip();
  trip.start_date = '2020-01-01';
  trip.end_date = '2020-01-02';
  trip.itinerary.forEach(item => { item.day_date = item.day_id === 'test-day-1' ? '2020-01-01' : '2020-01-02'; });
  const page = await openFixture(t, { trips: [trip] });
  await openActivity(page);
  assert.equal(await activity(page).locator('.cf-current-status').getAttribute('data-status'), 'unreported');
  assert.equal(await page.locator('[data-cf-day="test-day-1"] .cf-day-counts [data-status="unreported"] strong').innerText(), '2');
  await agentTab(page);
  assert.equal(await page.locator('.af-status-unreported').count(), 2);
  assert.equal(await page.locator('.af-status-done').count(), 0);
  assert.equal(await page.evaluate(() => window.__testRpcWrites.length), 0);
});

test('day summaries and final vacation/service ratings persist as internal feedback', async t => {
  const page = await openFixture(t);
  let day = page.locator('[data-cf-day="test-day-1"]');
  await day.locator('details.cf-details > summary').click();
  let form = day.locator('.cf-day-form');
  await chooseRating(form, 'rating', 4);
  await form.locator('[name="comment"]').fill('יום מוצלח עם מעט עומס · בדיקה');
  await form.locator('[name="tomorrow_preferences"]').fill('מחר נעדיף יותר זמן חופשי');
  await form.locator('button[type="submit"]').click();
  await waitRpcWrite(page, 'pt_feedback_save_day');
  const review = page.locator('.cf-trip-form');
  await review.locator('..').locator('summary').click();
  await chooseRating(review, 'vacation_rating', 5);
  await chooseRating(review, 'service_rating', 4);
  await review.locator('[name="comment"]').fill('שירות קשוב · משוב בדיקה');
  await review.locator('button[type="submit"]').click();
  await waitRpcWrite(page, 'pt_feedback_save_trip');
  await page.reload();
  day = page.locator('[data-cf-day="test-day-1"]');
  await day.locator('details.cf-details > summary').click();
  form = day.locator('.cf-day-form');
  assert.equal(await form.locator('[name="rating"][value="4"]').isChecked(), true);
  assert.equal(await form.locator('[name="tomorrow_preferences"]').inputValue(), 'מחר נעדיף יותר זמן חופשי');
  const persisted = await page.evaluate(() => window.__testFeedback['test-trip-1']);
  assert.equal(persisted.trip_review.vacation_rating, 5);
  assert.equal(persisted.trip_review.service_rating, 4);
  assert.equal(await page.evaluate(() => window.__testWrites.length), 0);
  await agentTab(page);
  assert.match(await page.locator('#agentFeedback').innerText(), /מחר נעדיף יותר זמן חופשי/);
  assert.match(await page.locator('#agentFeedback').innerText(), /שירות קשוב/);
});

test('failed and pending feedback saves keep drafts available and never show false success', async t => {
  const page = await openFixture(t);
  const form = await openActivity(page);
  await form.locator('[name="status"][value="deferred"]').check();
  await form.locator('[name="reason"]').fill('עיכוב בדרך · נתוני בדיקה');
  await page.evaluate(() => { window.__testRpcFailures.pt_feedback_save_activity = 'Synthetic feedback failure'; });
  await form.locator('button[type="submit"]').click();
  await form.locator('.cf-error').waitFor({ state: 'visible' });
  assert.match(await form.locator('.cf-error').innerText(), /לא אושרה|לא התקבל|לא נשמרה/);
  assert.equal(await form.locator('.cf-message').isVisible(), false);
  assert.equal(await activity(page).locator('.cf-current-status').getAttribute('data-status'), 'unreported');
  assert.equal(await form.locator('[name="reason"]').inputValue(), 'עיכוב בדרך · נתוני בדיקה');
  assert.equal(await page.evaluate(() => window.__testRpcWrites.length), 0);
  await page.evaluate(() => {
    delete window.__testRpcFailures.pt_feedback_save_activity;
    window.__testDelay.pt_feedback_save_activity = true;
  });
  await form.locator('button[type="submit"]').click();
  await page.waitForFunction(() => window.__testPending.some(item => item.key === 'pt_feedback_save_activity'));
  assert.equal(await form.locator('button[type="submit"]').isDisabled(), true);
  assert.equal(await activity(page).locator('.cf-current-status').getAttribute('data-status'), 'unreported');
  await page.evaluate(() => window.__testRelease('pt_feedback_save_activity'));
  await form.locator('.cf-message').waitFor({ state: 'visible' });
  assert.equal(await form.locator('button[type="submit"]').isDisabled(), false);
  assert.equal(await activity(page).locator('.cf-current-status').getAttribute('data-status'), 'deferred');
});

test('unsaved activity and day drafts survive switching days and language', async t => {
  const page = await openFixture(t);
  let form = await openActivity(page);
  await form.locator('[name="status"][value="skipped"]').check();
  await form.locator('[name="reason"]').fill('טיוטת סיבת דילוג שלא נשמרה');
  await page.locator('[data-cf-day="test-day-1"] details.cf-details > summary').click();
  await page.locator('[data-cf-day="test-day-1"] [name="tomorrow_preferences"]').fill('טיוטת העדפה למחר');
  await page.locator('#timeline .pt-day-button').nth(1).click();
  await page.locator('#langBtn').click();
  await page.locator('#timeline .pt-day-button').nth(0).click();
  form = await openActivity(page);
  assert.equal(await form.locator('[name="status"][value="skipped"]').isChecked(), true);
  assert.equal(await form.locator('[name="reason"]').inputValue(), 'טיוטת סיבת דילוג שלא נשמרה');
  await page.locator('[data-cf-day="test-day-1"] details.cf-details > summary').click();
  assert.equal(await page.locator('[data-cf-day="test-day-1"] [name="tomorrow_preferences"]').inputValue(), 'טיוטת העדפה למחר');
  assert.equal(await page.evaluate(() => window.__testRpcWrites.length), 0);
  await assertNoOverflow(page);
});

test('missing feedback RPCs and missing stored IDs expose no pretend feedback controls', async t => {
  const unavailable = await openFixture(t, { feedbackEnabled: false });
  await unavailable.locator('#timeline summary').first().waitFor();
  assert.equal(await unavailable.locator('.cf-activity-form, .cf-day-form, .cf-trip-form').count(), 0);
  const trip = feedbackTrip();
  trip.itinerary.forEach(item => { delete item.activity_id; delete item.day_id; });
  const noIds = await openFixture(t, { trips: [trip] });
  await noIds.locator('#timeline summary').first().waitFor();
  assert.equal(await noIds.locator('.cf-activity-form, .cf-day-form, .cf-request-form').count(), 0);
  assert.equal(await noIds.locator('.cf-trip-form').count(), 1, 'Trip-wide ratings do not depend on stored activity IDs');
  assert.equal(await noIds.evaluate(() => window.__testRpcWrites.length), 0);
});

test('request retry after an unconfirmed committed response is idempotent and keeps the original message', async t => {
  const page = await openFixture(t);
  const form = await openRequest(page);
  const message = 'נרצה פעילות רגועה יותר · בדיקת ניסיון חוזר';
  await form.locator('[name="message"]').fill(message);
  await page.evaluate(() => { window.__testRpcResponseFailures.pt_feedback_request_change = 'Synthetic response lost after commit'; });
  await form.locator('button[type="submit"]').click();
  await form.locator('.cf-error').waitFor({ state: 'visible' });
  assert.equal(await form.locator('.cf-message').isVisible(), false);
  assert.equal(await form.locator('[name="message"]').inputValue(), message);
  assert.equal(await page.evaluate(() => window.__testFeedback['test-trip-1'].requests.length), 1);
  await page.evaluate(() => { delete window.__testRpcResponseFailures.pt_feedback_request_change; window.__testDelay.pt_feedback_request_change = true; });
  await form.locator('button[type="submit"]').click();
  await page.waitForFunction(() => window.__testPending.some(item => item.key === 'pt_feedback_request_change'));
  assert.equal(await form.locator('button[type="submit"]').isDisabled(), true);
  await page.evaluate(() => window.__testRelease('pt_feedback_request_change'));
  await form.locator('.cf-message').waitFor({ state: 'visible' });
  const submitted = await page.evaluate(() => window.__testRpcWrites.filter(write => write.rpc === 'pt_feedback_request_change'));
  assert.equal(submitted.length, 2);
  assert.equal(submitted[0].args.p_client_request_id, submitted[1].args.p_client_request_id);
  assert.equal(await page.evaluate(() => window.__testFeedback['test-trip-1'].requests.length), 1);
  assert.equal(await activity(page).locator('.cf-request-status[data-status="pending"]').count(), 1);
  assert.equal(await page.evaluate(() => window.__testWrites.length), 0);
});

for (const mode of ['alternative', 'rejected']) {
  test(`a client change request receives an agent ${mode} reply without mutating the official itinerary`, async t => {
    const page = await openFixture(t);
    const requestId = await sendRequest(page);
    await agentTab(page);
    const row = page.locator(`[data-af-request="${requestId}"]`);
    await row.locator(`[data-af-action="respond-${mode}"]`).click();
    const reply = mode === 'alternative' ? 'אפשר להציע סיור קצר בגנים · תשובת בדיקה' : 'שעת הכניסה מחייבת ולכן אי אפשר להזיז · הסבר בדיקה';
    await page.locator('[data-af-reply]').fill(reply);
    await page.locator('[data-af-action="submit-response"]').click();
    await waitRpcWrite(page, 'pt_feedback_resolve_request');
    await page.locator(`[data-af-request="${requestId}"] .af-request-${mode}`).waitFor();
    assert.equal(await page.evaluate(() => window.__testFeedback['test-trip-1'].requests[0].status), mode);
    assert.deepEqual(await page.evaluate(() => window.__testTrips[0].itinerary), feedbackTrip().itinerary);
    assert.equal(await page.evaluate(() => window.__testWrites.length), 0);
    await assertNoOverflow(page);
    if (mode === 'alternative') {
      await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
      await page.locator('#agentFeedback').screenshot({ path: path.join(root, 'artifacts', 'feedback-agent-android.png'), style: '.top { position: static !important; }' });
    }
    await page.goto(`${baseURL}/?trip=synthetic-test-token`);
    await openActivity(page);
    await activity(page).locator(`.cf-request-status[data-status="${mode}"]`).waitFor();
    assert.match(await activity(page).locator('.cf-agent-response').innerText(), new RegExp(reply));
  });
}

test('agent approval sends the actual edited itinerary and expected revision in one RPC', async t => {
  const page = await openFixture(t);
  const requestId = await sendRequest(page);
  await agentTab(page);
  await page.locator(`[data-af-request="${requestId}"] [data-af-action="respond-approved"]`).click();
  await page.locator('[data-af-reply]').fill('שינינו את שעת הפעילות בהתאם לבקשה · בדיקה');
  await page.locator('[data-af-action="submit-response"]').click();
  await page.locator('[data-af-response-message].af-error').waitFor();
  assert.equal(await page.evaluate(() => window.__testRpcWrites.filter(write => write.rpc === 'pt_feedback_resolve_request').length), 0);
  const editor = page.locator('[data-af-approval-editor]');
  await editor.locator('[data-activity-panel="0-0"] > summary').click();
  await editor.locator('[data-day-index="0"][data-activity-index="0"][data-field="time"]').fill('11:30');
  await page.locator('[data-af-action="submit-response"]').click();
  await waitRpcWrite(page, 'pt_feedback_resolve_request');
  await page.locator(`[data-af-request="${requestId}"] .af-request-approved`).waitFor();
  const mutation = await page.evaluate(() => window.__testRpcWrites.find(write => write.rpc === 'pt_feedback_resolve_request'));
  assert.equal(mutation.args.p_request_id, requestId);
  assert.equal(mutation.args.p_status, 'approved');
  assert.equal(mutation.args.p_expected_updated_at, feedbackTrip().updated_at);
  assert.equal(mutation.args.p_itinerary.find(item => item.activity_id === 'test-museum').time, '11:30');
  assert.deepEqual(mutation.args.p_itinerary.find(item => item.activity_id === 'test-museum').supplier_reference, feedbackTrip().itinerary[0].supplier_reference);
  assert.equal(await page.evaluate(() => window.__testWrites.length), 0, 'Approval uses a single atomic RPC rather than a separate trip update');
  assert.notEqual(await page.evaluate(() => window.__testTrips[0].updated_at), feedbackTrip().updated_at);
  await page.goto(`${baseURL}/?trip=synthetic-test-token`);
  await openActivity(page);
  assert.match(await page.locator('details[data-activity-id="test-museum"] > summary').innerText(), /11:30/);
  await activity(page).locator('.cf-request-status[data-status="approved"]').waitFor();
});

test('a conflicting agent approval preserves the reply/editor draft and never marks the request approved', async t => {
  const page = await openFixture(t);
  const requestId = await sendRequest(page);
  await agentTab(page);
  await page.locator(`[data-af-request="${requestId}"] [data-af-action="respond-approved"]`).click();
  const reply = 'טיוטת מענה לבדיקה, טרם נשמרה';
  await page.locator('[data-af-reply]').fill(reply);
  const editor = page.locator('[data-af-approval-editor]');
  await editor.locator('[data-activity-panel="0-0"] > summary').click();
  await editor.locator('[data-day-index="0"][data-activity-index="0"][data-field="time"]').fill('11:45');
  await page.evaluate(() => { window.__testTrips[0].updated_at = '2026-11-06T12:00:00.000Z'; });
  await page.locator('[data-af-action="submit-response"]').click();
  await page.locator('[data-af-response-message].af-error').waitFor();
  assert.equal(await page.locator('[data-af-reply]').inputValue(), reply);
  assert.equal(await editor.locator('[data-day-index="0"][data-activity-index="0"][data-field="time"]').inputValue(), '11:45');
  assert.equal(await page.evaluate(() => window.__testFeedback['test-trip-1'].requests[0].status), 'pending');
  assert.equal(await page.evaluate(() => window.__testTrips[0].itinerary[0].time), '10:00');
  assert.equal(await page.evaluate(() => window.__testRpcWrites.filter(write => write.rpc === 'pt_feedback_resolve_request').length), 0);
});

test('stored IDs are prepared explicitly by the agent before activity/day reporting becomes available', async t => {
  const trip = feedbackTrip();
  trip.itinerary.forEach(item => { delete item.activity_id; delete item.day_id; });
  const page = await openFixture(t, { trips: [trip], pathname: '/' });
  await page.locator('[data-tab="tripListCard"]').click();
  await page.locator('#tripList [data-action="edit-trip"]').first().click();
  await page.locator('[data-action="prepare-feedback-ids"]').click();
  assert.equal(await page.evaluate(() => window.__testWrites.length), 0, 'Preparing IDs stays local until the trip is saved');
  await page.locator('#saveBtn').click();
  await page.waitForFunction(() => window.__testWrites.length === 1);
  const rows = await page.evaluate(() => window.__testWrites[0].payload.itinerary);
  assert.equal(rows.length, trip.itinerary.length);
  assert.ok(rows.every(row => row.activity_id && row.day_id));
  assert.equal(new Set(rows.map(row => row.activity_id)).size, 3);
  assert.deepEqual(rows[0].supplier_reference, trip.itinerary[0].supplier_reference);
  await page.goto(`${baseURL}/?trip=synthetic-test-token`);
  await page.locator('.cf-day-form').waitFor({ state: 'attached' });
  assert.equal(await page.locator('.cf-activity-form').count(), 2);
  assert.equal(await page.locator('.cf-day-form').count(), 1);
});

test('the scoped public-trip RPC provides the published language and never falls back after an access denial', async t => {
  const trip = feedbackTrip();
  trip.language = 'en';
  trip.owner_id = 'PRIVATE-TEST-OWNER-ID';
  const page = await openFixture(t, { trips: [trip] });
  await page.locator('.cf-activity-form').first().waitFor({ state: 'attached' });
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await page.locator('html').getAttribute('dir'), 'ltr');
  const calls = await page.evaluate(() => window.__testCalls);
  assert.equal(calls.some(call => call.rpc === 'pt_feedback_public_trip'), true);
  assert.equal(calls.some(call => call.rpc === 'get_public_trip'), false);
  assert.doesNotMatch(await page.locator('#clientPage').innerText(), /PRIVATE-TEST-OWNER-ID/);

  const draft = { ...trip, status: 'draft' };
  const denied = await openFixture(t, { trips: [draft] });
  await denied.locator('#loading p').waitFor();
  await denied.waitForFunction(() => window.__testCalls.some(call => call.rpc === 'pt_feedback_public_trip'));
  assert.equal(await denied.locator('#clientPage').isVisible(), false);
  assert.equal(await denied.locator('.cf-activity-form, .cf-trip-form').count(), 0);
  assert.equal(await denied.evaluate(() => window.__testCalls.some(call => call.rpc === 'get_public_trip')), false, 'A denied scoped RPC cannot fall back to the older public RPC');
});

test('saving a stale main-editor draft cannot overwrite an itinerary changed in another session', async t => {
  const page = await openFixture(t, { pathname: '/' });
  await page.locator('[data-tab="tripListCard"]').click();
  await page.locator('#tripList [data-action="edit-trip"]').first().click();
  await page.locator('#clientName').fill('טיוטת לקוח שלא נשמרה TEST ONLY');
  const newerRevision = '2026-11-06T14:00:00.000Z';
  await page.evaluate(newerRevision => {
    window.__testTrips[0].updated_at = newerRevision;
    window.__testTrips[0].itinerary[0].title = 'פעילות רשמית שעודכנה בחלון אחר TEST ONLY';
  }, newerRevision);
  await page.locator('#saveBtn').click();
  await page.locator('#saveError').waitFor({ state: 'visible' });
  assert.match(await page.locator('#saveError').innerText(), /עודכ|מחדש|שונ/);
  assert.equal(await page.locator('#clientName').inputValue(), 'טיוטת לקוח שלא נשמרה TEST ONLY');
  assert.equal(await page.locator('#itineraryEditor').isVisible(), true);
  assert.equal(await page.evaluate(() => window.__testTrips[0].itinerary[0].title), 'פעילות רשמית שעודכנה בחלון אחר TEST ONLY');
  assert.equal(await page.evaluate(() => window.__testTrips[0].updated_at), newerRevision);
  assert.equal(await page.evaluate(() => window.__testTrips[0].client_name), feedbackTrip().client_name);
  assert.equal(await page.evaluate(() => window.__testWrites.length), 0, 'No row was updated after the revision mismatch');
  const attempted = await page.evaluate(() => window.__testCalls.find(call => call.table === 'trips' && call.operation === 'update'));
  assert.deepEqual(attempted.filter, ['id', structuredTrip.id]);
  assert.ok(attempted.filters.some(filter => filter.field === 'updated_at' && filter.value === structuredTrip.updated_at));
  assert.equal(attempted.returning, true);
});

test('an existing null revision uses an IS NULL guard and accepts exactly one confirmed update', async t => {
  const trip = { ...feedbackTrip(), updated_at: null };
  const page = await openFixture(t, { trips: [trip], pathname: '/' });
  await page.locator('[data-tab="tripListCard"]').click();
  await page.locator('#tripList [data-action="edit-trip"]').first().click();
  await page.locator('#clientName').fill('לקוח עם גרסה ישנה TEST ONLY');
  await page.locator('#saveBtn').click();
  await page.waitForFunction(() => window.__testWrites.length === 1);
  const write = await page.evaluate(() => window.__testWrites[0]);
  assert.ok(write.filters.some(filter => filter.field === 'updated_at' && filter.value === null && filter.operator === 'is'));
  assert.equal(write.returning, true);
  assert.equal(await page.evaluate(() => window.__testTrips[0].client_name), 'לקוח עם גרסה ישנה TEST ONLY');
  assert.ok(await page.evaluate(() => window.__testTrips[0].updated_at));
  assert.equal(await page.locator('#saveError').isVisible(), false);
});

test('moving an activity preserves the original day report and summary while the new day starts unreported', async t => {
  const trip = feedbackTrip();
  trip.itinerary = [
    { ...trip.itinerary[0], day_id: 'test-day-2', day: 'יום 2', day_date: '2026-11-11' },
    trip.itinerary[2],
  ];
  const history = {
    version: 1,
    reports: [{ activity_id: 'test-museum', day_id: 'test-day-1', activity_title: 'המוזיאון ביום המקורי', day_label: 'היום המקורי', status: 'done', reason: '', delay_minutes: 10, rating: 5, comment: 'משוב היסטורי של היום המקורי', updated_at: '2026-11-05T12:00:00.000Z' }],
    day_summaries: [{ day_id: 'test-day-1', day_label: 'היום המקורי', rating: 4, comment: 'סיכום היסטורי נשמר', tomorrow_preferences: 'העדפה היסטורית נשמרת', submitted_at: '2026-11-05T13:00:00.000Z' }],
    trip_review: null, requests: [],
  };
  const page = await openFixture(t, { trips: [trip], feedback: { 'test-trip-1': history }, pathname: '/' });
  await agentTab(page);
  assert.equal(await page.locator('[data-af-activity="test-museum"] .af-status-unreported').count(), 1);
  await page.locator('[data-af-day]').selectOption('test-day-1');
  await page.locator('[data-af-activity="test-museum"] .af-status-done').waitFor();
  assert.match(await page.locator('#agentFeedback').innerText(), /משוב היסטורי של היום המקורי/);
  assert.match(await page.locator('#agentFeedback').innerText(), /סיכום היסטורי נשמר/);
  assert.match(await page.locator('#agentFeedback').innerText(), /העדפה היסטורית נשמרת/);

  await page.goto(`${baseURL}/?trip=synthetic-test-token`);
  let form = await openActivity(page);
  assert.equal(await activity(page).locator('.cf-current-status').getAttribute('data-status'), 'unreported');
  assert.equal(await page.locator('[data-cf-day="test-day-2"] .cf-day-counts [data-status="done"] strong').innerText(), '0');
  await form.locator('[name="status"][value="done"]').check();
  await chooseRating(form, 'rating', 4);
  await form.locator('[name="comment"]').fill('משוב חדש ליום השני');
  await form.locator('button[type="submit"]').click();
  await form.locator('.cf-message').waitFor({ state: 'visible' });
  const reports = await page.evaluate(() => window.__testFeedback['test-trip-1'].reports);
  assert.equal(reports.length, 2);
  assert.equal(reports.find(report => report.day_id === 'test-day-1').comment, history.reports[0].comment);
  assert.equal(reports.find(report => report.day_id === 'test-day-1').rating, 5);
  assert.equal(reports.find(report => report.day_id === 'test-day-2').rating, 4);
  assert.equal(await page.evaluate(() => window.__testRpcWrites[0].args.p_day_id), 'test-day-2');
  await page.reload();
  form = await openActivity(page);
  assert.equal(await form.locator('[name="rating"][value="4"]').isChecked(), true);
  assert.equal(await form.locator('[name="comment"]').inputValue(), 'משוב חדש ליום השני');
  await agentTab(page);
  await page.locator('[data-af-day]').selectOption('test-day-1');
  assert.match(await page.locator('[data-af-activity="test-museum"]').innerText(), /משוב היסטורי של היום המקורי/);
});

test('a stale client cannot attach a report to an activity that was moved to another day', async t => {
  const page = await openFixture(t);
  const form = await openActivity(page);
  await form.locator('[name="status"][value="done"]').check();
  await form.locator('[name="comment"]').fill('טיוטת דיווח מהיום המקורי');
  await page.evaluate(() => {
    const official = window.__testTrips[0].itinerary.find(item => item.activity_id === 'test-museum');
    official.day_id = 'test-day-2';
    official.day = 'יום 2';
    official.day_date = '2026-11-11';
  });
  await form.locator('button[type="submit"]').click();
  await form.locator('.cf-error').waitFor({ state: 'visible' });
  assert.match(await form.locator('.cf-error').innerText(), /עודכן|רעננו/);
  assert.equal(await form.locator('[name="comment"]').inputValue(), 'טיוטת דיווח מהיום המקורי');
  assert.equal(await activity(page).locator('.cf-current-status').getAttribute('data-status'), 'unreported');
  assert.equal(await page.evaluate(() => window.__testFeedback['test-trip-1'].reports.length), 0);
  assert.equal(await page.evaluate(() => window.__testRpcWrites.length), 0);
  const attempted = await page.evaluate(() => window.__testCalls.find(call => call.rpc === 'pt_feedback_save_activity'));
  assert.equal(attempted.args.p_day_id, 'test-day-1');
});
