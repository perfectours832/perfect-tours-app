'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const model = require('../itinerary-model.js');

test('the same model loads as a browser global without CommonJS', () => {
  const browser = vm.createContext({URL});
  vm.runInContext(fs.readFileSync(require.resolve('../itinerary-model.js'), 'utf8'), browser);
  assert.equal(typeof browser.ItineraryModel.decode, 'function');
  assert.equal(browser.ItineraryModel.safeUrl('https://example.com'), 'https://example.com/');
  assert.equal(browser.ItineraryModel.decode('09:00\nמוזיאון').kind, 'legacy');
});

test('legacy fragments stay one preserved block instead of becoming activity cards', () => {
  const fragments = ['יום 1', '09:00', 'מוזיאון הוותיקן', 'להגיע 15 דקות לפני הכניסה']
    .map(day => ({day, time: '', title: '', description: ''}));
  const decoded = model.decode(fragments);
  assert.equal(decoded.kind, 'legacy');
  assert.deepEqual(decoded.days, []);
  assert.deepEqual(decoded.original, fragments);
  assert.equal(decoded.legacyText, 'יום 1\n09:00\nמוזיאון הוותיקן\nלהגיע 15 דקות לפני הכניסה');
  decoded.original[0].day = 'edited copy';
  assert.equal(fragments[0].day, 'יום 1');
});

test('strings including valid pipe text never convert automatically', () => {
  const text = 'יום 1 | 09:00 | מוזיאון | תיאור | כן | |';
  const decoded = model.decode(text);
  assert.equal(decoded.kind, 'legacy');
  assert.equal(decoded.original, text);
  assert.equal(decoded.legacyText, text);
});

test('structured edit preserves unknown metadata, pipes, and multiline descriptions', () => {
  const input = [{day: 'יום 1', time: '09:00', title: 'מוזיאון | תערוכה',
    description: 'קומה 1\nקומה 2 | אגף מזרח', entry_time: '09:15', duration_minutes: 120,
    supplier: {reference: 'PRIVATE-TEST-123'}, ticket_purchased: false}];
  const original = JSON.parse(JSON.stringify(input));
  const decoded = model.decode(input);
  assert.equal(decoded.kind, 'structured');
  decoded.days[0].activities[0].address = 'רחוב בדיקה';
  const encoded = model.encode(decoded.days);
  assert.equal(encoded.length, 1);
  assert.equal(encoded[0].title, input[0].title);
  assert.equal(encoded[0].description, input[0].description);
  assert.equal(encoded[0].entry_time, '09:15');
  assert.equal(encoded[0].duration_minutes, 120);
  assert.deepEqual(encoded[0].supplier, input[0].supplier);
  encoded[0].supplier.reference = 'changed copy';
  assert.deepEqual(input, original);
});

test('display fallback IDs become stable record IDs only when an edited itinerary is encoded', () => {
  const original = [{day: 'יום 1', title: 'פעילות ישנה', description: 'ללא המרה בעת צפייה'}];
  const decoded = model.decode(original);
  assert.equal(decoded.days[0].id, 'day-index-0');
  assert.equal(decoded.days[0].activities[0].activity_id, 'activity-index-0');
  assert.deepEqual(decoded.original, original);
  assert.deepEqual(original, [{day: 'יום 1', title: 'פעילות ישנה', description: 'ללא המרה בעת צפייה'}]);
  const saved = model.encode(decoded.days);
  assert.doesNotMatch(saved[0].day_id, /^day-index-/);
  assert.doesNotMatch(saved[0].activity_id, /^activity-index-/);
  const reloaded = model.encode(model.decode(saved).days);
  assert.equal(reloaded[0].activity_id, saved[0].activity_id);
  assert.equal(reloaded[0].day_id, saved[0].day_id);
});

test('known false representations never become purchased tickets', () => {
  for (const value of [false, 'false', 'no', 'לא', '0', 0, '', null, undefined]) {
    assert.equal(model.paid(value), false, String(value));
  }
  for (const value of [true, 'TRUE', 'yes', 'כרטיס', 'נרכש', 'כן', 'paid', 1]) {
    assert.equal(model.paid(value), true, String(value));
  }
  const day = model.decode([{day: 'יום 1', title: 'פעילות', ticket_purchased: 'false'}]).days;
  assert.equal(model.encode(day)[0].ticket_purchased, false);
});

test('empty days and marker metadata survive save/reload and adding activities', () => {
  const marker = {kind: 'day', day_id: 'day-a', day: 'יום מנוחה', day_date: '2026-11-05',
    internal_notes: {supplier: 'test'}};
  const decoded = model.decode([marker]);
  assert.equal(decoded.kind, 'structured');
  assert.equal(decoded.days[0].activities.length, 0);
  assert.deepEqual(model.encode(decoded.days), [marker]);
  decoded.days[0].label = 'יום חדש';
  decoded.days[0].activities.push({title: 'טיול בוקר', time: '08:00'});
  const encoded = model.encode(decoded.days);
  assert.equal(encoded[0].kind, 'day');
  assert.deepEqual(encoded[0].internal_notes, marker.internal_notes);
  assert.equal(encoded[0].day, 'יום חדש');
  assert.equal(encoded[1].day_id, 'day-a');
  assert.equal(model.decode(encoded).days.length, 1);
});

test('new empty days are represented explicitly and unsupported shapes remain intact', () => {
  assert.deepEqual(model.encode([{id: 'empty', label: 'יום 2', date: '', activities: []}]),
    [{kind: 'day', day_id: 'empty', day: 'יום 2', day_date: ''}]);
  const unsupported = {schema_version: 99, mysterious: {rows: ['keep']}};
  const decoded = model.decode(unsupported);
  assert.equal(decoded.kind, 'unsupported');
  assert.deepEqual(decoded.original, unsupported);
  assert.match(decoded.legacyText, /mysterious/);
  assert.equal(model.decode([{unexpected: 1}]).kind, 'unsupported');
  assert.equal(model.decode([{title: ['invalid']}]).kind, 'unsupported');
  assert.equal(model.decode([{}]).legacyText, '[\n  {}\n]');
  assert.equal(model.decode([{title: 'א', activity_id: {unknown: 1}}]).kind, 'unsupported');
});

test('noncontiguous activities group by day while explicit distinct IDs remain distinct', () => {
  const rows = [
    {day: 'יום 1', title: 'א', time: '14:00'},
    {day: 'יום 2', title: 'ב', time: '10:00'},
    {day: 'יום 1', title: 'ג', time: '09:00'}
  ];
  const decoded = model.decode(rows);
  assert.equal(decoded.days.length, 2);
  assert.deepEqual(decoded.days[0].activities.map(row => row.title), ['א', 'ג']);
  assert.equal(model.decode(rows).days[0].id, decoded.days[0].id);
  assert.equal(model.decode(rows).days[0].activities[0].activity_id, decoded.days[0].activities[0].activity_id);
  assert.equal(model.decode([{day_id: 'a', day: 'אותו שם', title: 'א'},
    {day_id: 'b', day: 'אותו שם', title: 'ב'}]).days.length, 2);
});

test('a marker and old activities sharing its unambiguous label become one day', () => {
  const decoded = model.decode([{day: 'יום 1', title: 'א'},
    {kind: 'day', day_id: 'explicit', day: 'יום 1', custom: 'preserve'},
    {day: 'יום 1', title: 'ב'}]);
  assert.equal(decoded.days.length, 1);
  assert.equal(decoded.days[0].id, 'explicit');
  assert.equal(model.encode(decoded.days)[0].custom, 'preserve');
});

test('chronological display sorting is stable and never changes manual stored order', () => {
  const activities = [
    {title: 'later', time: '14:00'}, {title: 'unknown', time: ''},
    {title: 'first', time: '9:00'}, {title: 'same', time: '09:00'},
    {title: 'invalid', time: '29:00'}
  ];
  assert.deepEqual(model.orderedActivities(activities).map(row => row.title),
    ['first', 'same', 'later', 'unknown', 'invalid']);
  assert.equal(activities[0].title, 'later');
  assert.equal(model.orderedActivities(activities)[0], activities[2]);
});

test('import produces a reviewable preview only for explicit validated seven-column lines', () => {
  const text = 'יום 1 | 09:00 | מוזיאון | תיאור | כן | https://example.com/photo.jpg | https://maps.example.com/a\n' +
    'יום 2 | | מנוחה | | לא | |\nיום 1 | 12:00 | צהריים | | | |';
  const result = model.previewImport(text);
  assert.deepEqual(result.errors, []);
  assert.equal(result.days.length, 2);
  assert.equal(result.days[0].activities.length, 2);
  assert.equal(result.days[0].activities[0].ticket_purchased, true);
  assert.equal(result.days[1].activities[0].ticket_purchased, false);
  assert.equal(model.decode(text).kind, 'legacy');
  assert.equal(model.encode(result.days).length, 3);
});

test('one invalid import row rejects the entire preview without guessing or losing original text', () => {
  for (const text of [
    '09:00\nמוזיאון\nהערה',
    'יום 1 | 09:00 | מוזיאון | תיאור',
    'יום 1 | 25:00 | מוזיאון | | | |',
    'יום 1 | 09:00 | | תיאור | | |',
    'יום 1 | 09:00 | מוזיאון | | אולי | |',
    'יום 1 | 09:00 | מוזיאון | | | javascript:alert(1) |',
    'יום 1 | 09:00 | מוזיאון | | | | data:text/plain,bad'
  ]) {
    const preview = model.previewImport(text);
    assert.ok(preview.errors.length, text);
    assert.deepEqual(preview.days, []);
    assert.equal(model.decode(text).original, text);
  }
});

test('URLs and HTML are safe to render without destroying source values', () => {
  for (const url of ['javascript:alert(1)', 'data:image/svg+xml,bad', '//example.com', '/relative',
    'https://user:pass@example.com', 'file:///private', '']) assert.equal(model.safeUrl(url), '');
  assert.equal(model.safeUrl(' https://example.com/a?q=1&b=2 '), 'https://example.com/a?q=1&b=2');
  assert.equal(model.safeUrl('http://example.com'), 'http://example.com/');
  assert.equal(model.escapeHtml('<img onerror="alert(1)">&\''), '&lt;img onerror=&quot;alert(1)&quot;&gt;&amp;&#39;');
  const source = [{day: 'יום 1', title: 'א', map_url: 'javascript:bad()'}];
  assert.equal(model.decode(source).original[0].map_url, 'javascript:bad()');
});

test('encode rejects invalid structured state and createId supplies distinct local IDs', () => {
  assert.throws(() => model.encode({}), /array/);
  assert.throws(() => model.encode([{id: 'a', activities: [{title: ''}]}]), /title/);
  assert.notEqual(model.createId(), model.createId());
  assert.deepEqual(model.decode(null).days, []);
  assert.deepEqual(model.decode([]).days, []);
});
