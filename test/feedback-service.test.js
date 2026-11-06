'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const FeedbackService = require('../feedback-service');

// Explicitly synthetic, RPC-only fixtures. No connection to Supabase is created.
const PUBLIC_ID = '11111111111111111111111111111111';
const ACTIVITY_ID = '30000000-0000-0000-0000-000000000001';
const DAY_ID = '40000000-0000-0000-0000-000000000001';
const EMPTY_DAY_ID = '40000000-0000-0000-0000-000000000002';
const REQUEST_ID = '50000000-0000-0000-0000-000000000001';
const TRIP_ID = '10000000-0000-0000-0000-000000000001';
const trip = {
  id: TRIP_ID,
  itinerary: [
    {activity_id: ACTIVITY_ID, day_id: DAY_ID, day: 'יום בדיקה', title: 'פעילות בדיקה', time: '09:00'},
    {kind: 'day', day_id: EMPTY_DAY_ID, day: 'יום ריק לבדיקה'}
  ]
};

const snapshot = (fields = {}) => ({
  version: 1, reports: [], day_summaries: [], trip_review: null, requests: [], ...fields
});
const success = data => ({data, error: null});
const failure = (code, message = 'Synthetic server failure') => ({data: null, error: {code, message}});
const done = (fields = {}) => ({activity_id: ACTIVITY_ID, status: 'done', ...fields});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

function createService(handler = () => success(snapshot()), options = {}) {
  const calls = [];
  const db = {
    rpc(name, args) {
      calls.push({name, args: structuredClone(args)});
      return handler(name, args);
    },
    from() { throw new Error('Feedback must never write an official trip directly.'); }
  };
  return {service: new FeedbackService(db, {trip, publicId: PUBLIC_ID, ...options}), calls};
}

async function loadedService(handler, options) {
  const fixture = createService(handler, options);
  assert.ok(await fixture.service.loadClient(), 'Synthetic feedback read is confirmed');
  return fixture;
}

test('missing feedback RPC leaves the itinerary usable and prevents every customer write', async () => {
  const {service, calls} = createService(() => failure('PGRST202'));
  let notified = 0;
  service.subscribe(() => { notified += 1; });

  assert.equal(await service.loadClient(), null);
  assert.equal(service.available, false);
  assert.equal(service.lastError.code, 'unavailable');
  assert.deepEqual(service.state, snapshot());
  await assert.rejects(service.saveActivity(done()), {code: 'unavailable'});
  await assert.rejects(service.saveDay({day_id: DAY_ID}), {code: 'unavailable'});
  await assert.rejects(service.saveTrip({vacation_rating: 5, service_rating: 4}), {code: 'unavailable'});
  await assert.rejects(service.requestChange({activity_id: ACTIVITY_ID, message: 'Synthetic request', client_request_id: REQUEST_ID}), {code: 'unavailable'});
  assert.equal(calls.length, 1, 'No write is attempted against a missing backend');
  assert.equal(notified, 0, 'An unavailable read never signals persisted success');
});

test('a public token is required before reading feedback', async () => {
  const {service, calls} = createService(undefined, {publicId: null});
  assert.equal(await service.loadClient(), null);
  assert.equal(service.lastError.code, 'forbidden');
  assert.equal(calls.length, 0);
});

test('a complete version-one envelope is required before enabling writes', async () => {
  const missingReview = snapshot();
  delete missingReview.trip_review;
  const missingRequests = snapshot();
  delete missingRequests.requests;
  const malformed = [
    null, {}, snapshot({version: 2}), snapshot({reports: null}),
    snapshot({day_summaries: {}}), missingRequests, missingReview,
    snapshot({trip_review: 'Synthetic malformed review'}), snapshot({trip_review: []})
  ];
  for (const payload of malformed) {
    const {service, calls} = createService(() => success(payload));
    assert.equal(await service.loadClient(), null, JSON.stringify(payload));
    assert.equal(service.available, false);
    assert.equal(service.lastError.code, 'network');
    assert.deepEqual(service.state, snapshot());
    await assert.rejects(service.saveActivity(done()), {code: 'unavailable'});
    assert.equal(calls.length, 1);
  }
});

test('confirmed feedback snapshots accept the RPC object or single-row wrapper and copy server data', async () => {
  for (const wrapped of [false, true]) {
    const data = snapshot({trip_review: {vacation_rating: 5, service_rating: 4}});
    const {service} = createService(() => success(wrapped ? [data] : data));
    assert.deepEqual(await service.loadClient(), data);
    assert.equal(service.available, true);
    data.trip_review.vacation_rating = 1;
    assert.equal(service.state.trip_review.vacation_rating, 5);
  }
});

test('legacy, missing, duplicate and temporary IDs cannot receive activity reports or requests', async () => {
  const variants = [
    [{day: 'יום ישן', title: 'פעילות ישנה'}],
    [{activity_id: ACTIVITY_ID, title: 'פעילות ללא מזהה יום'}],
    [{activity_id: ACTIVITY_ID, day_id: DAY_ID}, {activity_id: ACTIVITY_ID, day_id: DAY_ID}],
    [{activity_id: 'activity-index-0', day_id: DAY_ID, title: 'מזהה תצוגה זמני'}],
    [{activity_id: ACTIVITY_ID, day_id: 'day-index-0', title: 'מזהה יום זמני'}]
  ];
  for (const itinerary of variants) {
    const {service, calls} = await loadedService(undefined, {trip: {itinerary}});
    const id = itinerary[0]?.activity_id || 'activity-index-0';
    assert.equal(service.hasActivity(id), false);
    await assert.rejects(service.saveActivity(done({activity_id: id})), {code: 'validation'});
    await assert.rejects(service.requestChange({activity_id: id, message: 'Synthetic request', client_request_id: REQUEST_ID}), {code: 'validation'});
    assert.equal(calls.length, 1);
  }
});

test('day summaries require a saved day ID, including days with no activities', async () => {
  const {service, calls} = await loadedService();
  assert.equal(service.hasDay(DAY_ID), true);
  assert.equal(service.hasDay(EMPTY_DAY_ID), true);
  await assert.rejects(service.saveDay({day_id: 'missing-day', rating: 4}), {code: 'validation'});
  assert.equal(calls.length, 1);
  await service.saveDay({day_id: EMPTY_DAY_ID, rating: 4, tomorrow_preferences: 'Synthetic slower day'});
  assert.equal(calls.at(-1).args.p_day_id, EMPTY_DAY_ID);

  const temporary = await loadedService(undefined, {trip: {itinerary: [{kind: 'day', day_id: 'day-index-0', day: 'יום זמני'}]}});
  assert.equal(temporary.service.hasDay('day-index-0'), false);
  await assert.rejects(temporary.service.saveDay({day_id: 'day-index-0', rating: 4}), {code: 'validation'});
  assert.equal(temporary.calls.length, 1);
});

test('activity reports enforce explicit status, reasons, completion-only ratings and delay bounds', async () => {
  const {service, calls} = await loadedService();
  const invalid = [
    done({status: ''}), done({status: 'unreported'}),
    done({status: 'skipped', reason: ''}), done({status: 'deferred', reason: '   '}),
    done({status: 'skipped', reason: 'Synthetic skip', rating: 4}),
    done({status: 'deferred', reason: 'Synthetic delay', rating: 1}),
    done({rating: 0}), done({rating: 6}), done({rating: 2.5}),
    done({delay_minutes: -1}), done({delay_minutes: 1441}), done({delay_minutes: 1.5}),
    done({delay_minutes: 'unknown'}), done({comment: 'x'.repeat(2001)}), done({reason: {invalid: true}})
  ];
  for (const input of invalid) await assert.rejects(service.saveActivity(input), {code: 'validation'});
  assert.equal(calls.length, 1, 'Rejected fields never reach the server');

  await service.saveActivity(done({rating: '5', delay_minutes: '1440', comment: '  Synthetic comment  '}));
  assert.equal(calls.at(-1).args.p_rating, 5);
  assert.equal(calls.at(-1).args.p_delay_minutes, 1440);
  assert.equal(calls.at(-1).args.p_comment, 'Synthetic comment');
  await service.saveActivity(done({status: 'skipped', reason: '  Synthetic skip  ', rating: ''}));
  assert.equal(calls.at(-1).args.p_reason, 'Synthetic skip');
  assert.equal(calls.at(-1).args.p_rating, null);
});

test('day and vacation reviews validate ratings and preserve tomorrow preferences', async () => {
  const {service, calls} = await loadedService();
  await assert.rejects(service.saveDay({day_id: DAY_ID, rating: 6}), {code: 'validation'});
  await assert.rejects(service.saveTrip({vacation_rating: '', service_rating: 5}), {code: 'validation'});
  await assert.rejects(service.saveTrip({vacation_rating: 5, service_rating: 0}), {code: 'validation'});
  await assert.rejects(service.saveDay({day_id: DAY_ID, tomorrow_preferences: 'x'.repeat(2001)}), {code: 'validation'});
  assert.equal(calls.length, 1);

  await service.saveDay({day_id: DAY_ID, rating: '4', comment: ' Synthetic day ', tomorrow_preferences: ' Less walking '});
  assert.deepEqual(calls.at(-1), {name: 'pt_feedback_save_day', args: {
    p_public_id: PUBLIC_ID, p_day_id: DAY_ID, p_rating: 4, p_comment: 'Synthetic day', p_tomorrow_preferences: 'Less walking'
  }});
  await service.saveTrip({vacation_rating: 5, service_rating: '4', comment: ' Synthetic trip '});
  assert.deepEqual(calls.at(-1), {name: 'pt_feedback_save_trip', args: {
    p_public_id: PUBLIC_ID, p_vacation_rating: 5, p_service_rating: 4, p_comment: 'Synthetic trip'
  }});
});

test('customer writes are scoped by the service token and cannot smuggle official itinerary fields', async () => {
  const {service, calls} = await loadedService();
  const official = structuredClone(trip);
  await service.saveActivity(done({
    rating: 5, itinerary: [{title: 'Attempted official edit'}],
    owner_id: 'another-owner', trip_id: 'another-trip', public_id: 'another-token',
    day_id: 'another-day', reservation_status: 'cancelled'
  }));
  assert.deepEqual(calls.at(-1), {name: 'pt_feedback_save_activity', args: {
    p_public_id: PUBLIC_ID, p_activity_id: ACTIVITY_ID, p_day_id: DAY_ID, p_status: 'done', p_reason: '',
    p_delay_minutes: 0, p_rating: 5, p_comment: ''
  }});
  assert.deepEqual(trip, official);
});

test('activity report day follows the loaded official itinerary and changes only after loading the moved activity', async () => {
  const changedTrip = structuredClone(trip);
  const beforeMove = await loadedService(undefined, {trip: changedTrip});
  changedTrip.itinerary[0].day_id = EMPTY_DAY_ID;
  changedTrip.itinerary[0].day = 'יום חדש לאחר העברה';

  await beforeMove.service.saveActivity(done({day_id: EMPTY_DAY_ID}));
  assert.equal(beforeMove.calls.at(-1).args.p_day_id, DAY_ID,
    'An existing service keeps its original day snapshot so the server can reject a stale report');

  const afterMove = await loadedService(undefined, {trip: changedTrip});
  await afterMove.service.saveActivity(done({day_id: DAY_ID}));
  assert.equal(afterMove.calls.at(-1).args.p_day_id, EMPTY_DAY_ID,
    'A newly loaded official itinerary supplies the moved day; caller input cannot redirect it');
});

test('a pending write leaves state unchanged until the complete persisted snapshot is confirmed', async () => {
  const saving = deferred();
  const started = deferred();
  const {service} = await loadedService(name => {
    if (name === 'pt_feedback_client') return success(snapshot());
    started.resolve();
    return saving.promise;
  });
  const observed = [];
  service.subscribe(state => observed.push(structuredClone(state)));
  const operation = service.saveActivity(done({rating: 5}));
  await started.promise;
  assert.deepEqual(service.state, snapshot());
  assert.equal(observed.length, 0);

  const confirmed = snapshot({reports: [{activity_id: ACTIVITY_ID, status: 'done', rating: 5}]});
  saving.resolve(success(confirmed));
  assert.deepEqual(await operation, confirmed);
  assert.deepEqual(service.state, confirmed);
  assert.deepEqual(observed, [confirmed]);
});

test('a broken display subscriber cannot turn a committed save into a failure or block other subscribers', async () => {
  const committed = snapshot({reports: [{activity_id: ACTIVITY_ID, status: 'done', rating: 5}]});
  const {service, calls} = await loadedService(name => success(name === 'pt_feedback_client' ? snapshot() : committed));
  let brokenNotifications = 0;
  const observed = [];
  service.subscribe(() => {
    brokenNotifications += 1;
    throw new Error('Synthetic display rendering failure after a committed save');
  });
  service.subscribe(state => observed.push(structuredClone(state)));

  const saved = await service.saveActivity(done({rating: 5}));
  assert.deepEqual(saved, committed, 'The confirmed save still resolves successfully');
  assert.deepEqual(service.state, committed);
  assert.deepEqual(observed, [committed], 'Subscribers after the broken display are still notified');
  assert.equal(brokenNotifications, 1);
  assert.equal(service.available, true);
  assert.equal(service.lastError, null);
  assert.equal(service.viewNeedsRefresh, true);
  assert.equal(calls.length, 2, 'A presentation error must not cause an automatic duplicate write');
});

test('a malformed write response never replaces confirmed data and a later retry can succeed', async () => {
  const initial = snapshot({reports: [{activity_id: ACTIVITY_ID, status: 'done', rating: 4}]});
  let attempts = 0;
  const {service} = await loadedService(name => {
    if (name === 'pt_feedback_client') return success(initial);
    attempts += 1;
    if (attempts === 1) return success({version: 1, reports: []});
    return success(snapshot({reports: [{activity_id: ACTIVITY_ID, status: 'done', rating: 5}]}));
  });
  let updates = 0;
  service.subscribe(() => { updates += 1; });
  await assert.rejects(service.saveActivity(done({rating: 5})), {code: 'network'});
  assert.deepEqual(service.state, initial);
  assert.equal(updates, 0);
  await service.saveActivity(done({rating: 5}));
  assert.equal(service.state.reports[0].rating, 5);
  assert.equal(updates, 1);
});

test('customer writes are serialized so a later snapshot cannot be overwritten by an earlier save', async () => {
  const first = deferred(), firstStarted = deferred();
  const second = deferred(), secondStarted = deferred();
  const {service, calls} = await loadedService(name => {
    if (name === 'pt_feedback_client') return success(snapshot());
    if (name === 'pt_feedback_save_activity') { firstStarted.resolve(); return first.promise; }
    secondStarted.resolve(); return second.promise;
  });
  const report = {activity_id: ACTIVITY_ID, status: 'done'};
  const day = {day_id: DAY_ID, rating: 4};
  const reportWrite = service.saveActivity(done());
  const dayWrite = service.saveDay(day);
  await firstStarted.promise;
  assert.deepEqual(calls.map(call => call.name), ['pt_feedback_client', 'pt_feedback_save_activity']);

  first.resolve(success(snapshot({reports: [report]})));
  await reportWrite;
  await secondStarted.promise;
  assert.deepEqual(service.state.reports, [report]);
  second.resolve(success(snapshot({reports: [report], day_summaries: [day]})));
  await dayWrite;
  assert.deepEqual(service.state, snapshot({reports: [report], day_summaries: [day]}));
});

test('a transport failure preserves confirmed state and does not poison the next queued save', async () => {
  let attempts = 0;
  const {service} = await loadedService(name => {
    if (name === 'pt_feedback_client') return success(snapshot());
    if (++attempts === 1) throw new Error('Synthetic network outage with private transport detail');
    return success(snapshot({reports: [{activity_id: ACTIVITY_ID, status: 'done'}]}));
  });
  const failed = service.saveActivity(done());
  const retry = service.saveActivity(done());
  await assert.rejects(failed, cause => {
    assert.equal(cause.code, 'network');
    assert.doesNotMatch(cause.message, /private transport/);
    return true;
  });
  await retry;
  assert.equal(attempts, 2);
  assert.equal(service.state.reports[0].status, 'done');
});

test('change requests require text and a stable caller-supplied retry ID', async () => {
  let writes = 0;
  const {service, calls} = await loadedService(name => {
    if (name === 'pt_feedback_client') return success(snapshot());
    writes += 1;
    if (writes === 1) return failure('PGRST000');
    return success(snapshot({requests: [{id: 'server-request', client_request_id: REQUEST_ID, status: 'pending'}]}));
  });
  for (const input of [
    {message: '', client_request_id: REQUEST_ID},
    {message: 'Synthetic request', client_request_id: ''},
    {message: 'Synthetic request', client_request_id: 'not-a-uuid'},
    {message: 'x'.repeat(4001), client_request_id: REQUEST_ID}
  ]) await assert.rejects(service.requestChange({activity_id: ACTIVITY_ID, ...input}), {code: 'validation'});
  assert.equal(calls.length, 1);

  const request = {activity_id: ACTIVITY_ID, message: '  Synthetic change request  ', client_request_id: REQUEST_ID};
  await assert.rejects(service.requestChange(request), {code: 'network'});
  assert.equal(service.state.requests.length, 0);
  await service.requestChange(request);
  const expected = {name: 'pt_feedback_request_change', args: {
    p_public_id: PUBLIC_ID, p_activity_id: ACTIVITY_ID, p_message: 'Synthetic change request', p_client_request_id: REQUEST_ID
  }};
  assert.deepEqual(calls.slice(1), [expected, expected], 'Retries carry the identical idempotency key and payload');
  assert.equal(service.state.requests.length, 1);
});

test('agent reads use the trip ID without borrowing the public customer token', async () => {
  const {service, calls} = createService(() => success(snapshot()), {trip: null, publicId: null});
  assert.deepEqual(await service.agent(TRIP_ID), snapshot());
  assert.deepEqual(calls, [{name: 'pt_feedback_agent', args: {p_trip_id: TRIP_ID}}]);
});

test('agent approval requires an edited itinerary while alternatives and rejections never send one', async () => {
  const {service, calls} = createService();
  await assert.rejects(service.resolveRequest({request_id: REQUEST_ID, status: 'approved', reply: 'Synthetic approval'}), {code: 'validation'});
  await assert.rejects(service.resolveRequest({request_id: REQUEST_ID, status: 'rejected', reply: '  '}), {code: 'validation'});
  await assert.rejects(service.resolveRequest({request_id: REQUEST_ID, status: 'unknown', reply: 'Synthetic reply'}), {code: 'validation'});
  assert.equal(calls.length, 0);

  const changed = structuredClone(trip.itinerary);
  changed[0].time = '10:00';
  const revision = '2026-11-06T10:00:00.000Z';
  await service.resolveRequest({request_id: REQUEST_ID, status: 'approved', reply: ' Synthetic approval ', itinerary: changed, expected_updated_at: revision});
  assert.deepEqual(calls.at(-1), {name: 'pt_feedback_resolve_request', args: {
    p_request_id: REQUEST_ID, p_status: 'approved', p_reply: 'Synthetic approval', p_itinerary: changed, p_expected_updated_at: revision
  }});
  for (const status of ['alternative', 'rejected']) {
    await service.resolveRequest({request_id: REQUEST_ID, status, reply: 'Synthetic reply', itinerary: changed});
    assert.equal(calls.at(-1).args.p_itinerary, null);
    assert.equal(calls.at(-1).args.p_public_id, undefined);
  }
});

test('revision conflicts and authorization failures are distinguished from generic network errors', async () => {
  for (const [code, message, expected] of [
    ['40001', 'Synthetic conflict', 'conflict'],
    ['P0001', 'revision_conflict', 'conflict'],
    ['42501', 'Synthetic denial', 'forbidden'],
    ['PGRST301', 'Synthetic expired token', 'forbidden'],
    ['22023', 'Synthetic rejected input', 'validation'],
    ['42883', 'Synthetic missing function', 'unavailable'],
    ['unknown', 'Synthetic private server detail', 'network']
  ]) {
    const {service} = createService(() => failure(code, message), {publicId: null});
    await assert.rejects(service.resolveRequest({request_id: REQUEST_ID, status: 'approved', reply: 'Synthetic approval', itinerary: trip.itinerary}), cause => {
      assert.equal(cause.code, expected);
      assert.doesNotMatch(cause.message, /Synthetic/);
      return true;
    });
  }
});

test('destroying a service ignores a pending initial read and prevents later agent calls', async () => {
  const response = deferred();
  const {service, calls} = createService(() => response.promise);
  let notifications = 0;
  service.subscribe(() => { notifications += 1; });
  const loading = service.loadClient();
  service.destroy();
  response.resolve(success(snapshot({reports: [{activity_id: ACTIVITY_ID, status: 'done'}]})));
  assert.equal(await loading, null);
  assert.equal(service.available, false);
  assert.deepEqual(service.state, snapshot());
  assert.equal(notifications, 0);
  await assert.rejects(service.agent(TRIP_ID), {code: 'forbidden'});
  assert.equal(calls.length, 1);
});

test('destroying a service rejects queued saves without publishing stale state or sending the next write', async () => {
  const response = deferred(), started = deferred();
  const {service, calls} = await loadedService(name => {
    if (name === 'pt_feedback_client') return success(snapshot());
    started.resolve(); return response.promise;
  });
  let notifications = 0;
  service.subscribe(() => { notifications += 1; });
  const first = service.saveActivity(done());
  const next = service.saveDay({day_id: DAY_ID, rating: 4});
  await started.promise;
  service.destroy();
  response.resolve(success(snapshot({reports: [{activity_id: ACTIVITY_ID, status: 'done'}]})));
  await assert.rejects(first, {code: 'forbidden'});
  await assert.rejects(next, {code: 'forbidden'});
  assert.deepEqual(service.state, snapshot());
  assert.equal(notifications, 0);
  assert.equal(calls.length, 2, 'Only initial read and the first already-started save reached the RPC boundary');
});
