'use strict';

// Explicitly synthetic records. These fixtures are intercepted in the browser;
// no request is sent to Supabase and no real customer record is read or changed.
const structuredTrip = {
  id: 'test-trip-1',
  public_id: 'synthetic-test-token',
  client_name: 'לקוח בדיקה TEST ONLY',
  partner_name: '',
  destination: 'רומא · נתוני בדיקה',
  booking_number: 'TEST-ONLY-001',
  start_date: '2026-11-10',
  end_date: '2026-11-12',
  client_phone: '',
  language: 'he',
  status: 'active',
  hotel_name: 'מלון בדיקה בלבד',
  hotel_map: 'https://maps.example.test/hotel',
  outbound_flight: 'TEST 101 · 08:10',
  return_flight: 'TEST 102 · 21:40',
  welcome_message: 'תצוגה עם נתוני בדיקה בלבד — ללא לקוחות אמיתיים.',
  itinerary: [
    {
      activity_id: 'test-museum', day_id: 'test-day-1', day: 'יום 1', day_date: '2026-11-10',
      time: '10:00', title: 'מוזיאון הוותיקן · בדיקה',
      description: 'קומה ראשונה | סיור מודרך\nקומה שנייה — זמן חופשי',
      duration_minutes: 120, address: 'כתובת בדיקה, רומא',
      ticket_purchased: true, entry_time: '10:15', reservation_status: 'confirmed',
      image_url: 'https://images.example.test/attraction.svg',
      map_url: 'https://maps.example.test/museum',
      document_url: 'https://documents.example.test/ticket.pdf',
      supplier_reference: { id: 'TEST-SUPPLIER-123', retain: true },
    },
    {
      activity_id: 'test-breakfast', day_id: 'test-day-1', day: 'יום 1', day_date: '2026-11-10',
      time: '08:30', title: 'קפה בשכונה · בדיקה', description: 'בוקר נינוח בנתוני בדיקה בלבד.',
      duration_minutes: 45, ticket_purchased: false, entry_time: '', reservation_status: 'none',
      map_url: 'javascript:alert("unsafe")', image_url: 'data:text/html,unsafe',
      document_url: 'javascript:alert("unsafe-document")',
    },
    {
      activity_id: 'test-gardens', day_id: 'test-day-2', day: 'יום 2', day_date: '2026-11-11',
      time: '11:00', title: 'הגנים של רומא · בדיקה', description: 'טיול רגוע בגנים.',
      duration_minutes: 90, ticket_purchased: 'false', entry_time: '', reservation_status: 'none',
      map_url: 'https://maps.example.test/gardens',
    },
  ],
  documents: [
    { name: 'מסמך בדיקה', url: 'https://documents.example.test/test.pdf', private_metadata: 'retain' },
    { name: 'קישור מסוכן לבדיקה', url: 'javascript:alert("unsafe-document")' },
  ],
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
};

const legacyTrip = {
  ...structuredTrip,
  id: 'test-trip-legacy', public_id: 'synthetic-legacy-token',
  itinerary: [
    { day: 'יום 1', time: '', title: '', description: '', custom_legacy: 'retain-me' },
    { day: '09:00', time: '', title: '', description: '' },
    { day: 'מוזיאון הוותיקן', time: '', title: '', description: '' },
    { day: 'להגיע 15 דקות לפני הכניסה', time: '', title: '', description: '' },
  ],
};

const settings = {
  business_name: 'Perfect Tours · סביבת בדיקה', contact_phone: '0500000000',
  whatsapp_phone: '972500000000', primary_color: '#12374b', default_welcome: '',
  logo_data: null, email: 'test@example.test', website: '',
};

function installMock(config) {
  const clone = value => JSON.parse(JSON.stringify(value));
  const fixture = clone(config);
  let savedFeedback = null;
  if (fixture.feedbackEnabled) {
    try { savedFeedback = JSON.parse(sessionStorage.getItem('pt-feedback-synthetic-db')); } catch (_) {}
  }
  window.__testWrites = [];
  window.__testRpcWrites = [];
  window.__testCalls = [];
  window.__testFailure = null;
  window.__testTrips = savedFeedback?.trips || fixture.trips;
  window.__testTrips.forEach(trip => {
    if (!Object.hasOwn(trip, 'updated_at')) trip.updated_at = trip.created_at || null;
  });
  window.__testFeedback = savedFeedback?.feedback || clone(fixture.feedback || {});
  window.__testRpcFailures = clone(fixture.rpcFailures || {});
  window.__testRpcResponseFailures = clone(fixture.rpcResponseFailures || {});
  window.__testDelay = clone(fixture.delays || {});
  window.__testPending = [];
  let session = fixture.authenticated ? { user: { id: 'test-owner-only', email: 'test@example.test' } } : null;
  let authCallback = null;
  let revision = 0;
  const persistFeedback = () => {
    if (fixture.feedbackEnabled) sessionStorage.setItem('pt-feedback-synthetic-db', JSON.stringify({ trips: window.__testTrips, feedback: window.__testFeedback }));
  };
  const feedbackState = tripId => {
    if (!window.__testFeedback[tripId]) window.__testFeedback[tripId] = { version: 1, reports: [], day_summaries: [], trip_review: null, requests: [] };
    return window.__testFeedback[tripId];
  };
  const stamp = () => new Date(Date.UTC(2026, 10, 6, 0, 0, ++revision)).toISOString();

  // Delay responses, rather than using sleeps, to exercise in-flight save and
  // authentication races deterministically. Results are captured at query time.
  const deliver = (key, result) => window.__testDelay[key]
    ? new Promise(resolve => window.__testPending.push({ key, respond: () => resolve(result) }))
    : Promise.resolve(result);
  window.__testRelease = key => {
    const responses = window.__testPending.filter(item => !key || item.key === key);
    window.__testPending = window.__testPending.filter(item => key && item.key !== key);
    responses.forEach(item => item.respond());
  };
  window.__testAuthEvent = nextSession => {
    session = nextSession ? clone(nextSession) : null;
    if (authCallback) authCallback(session ? 'SIGNED_IN' : 'SIGNED_OUT', session);
  };

  function tableQuery(table) {
    const state = { table, operation: 'select', payload: null, filter: null, filters: [], single: false, returning: false, columns: '*' };
    const matches = row => state.filters.every(({ field, value, operator }) => operator === 'is' && value === null ? row[field] == null : row[field] === value);
    const projection = row => state.columns === '*' ? clone(row) : Object.fromEntries(state.columns.split(',').map(key => key.trim()).filter(Boolean).map(key => [key, row[key]]));
    const query = {
      select(columns = '*') { state.columns = columns; state.returning = state.operation !== 'select'; return query; },
      order() { return query; },
      limit() { return query; },
      eq(field, value) { state.filter ||= [field, value]; state.filters.push({ field, value, operator: 'eq' }); return query; },
      is(field, value) { state.filter ||= [field, value]; state.filters.push({ field, value, operator: 'is' }); return query; },
      maybeSingle() { state.single = true; return query; },
      single() { state.single = true; return query; },
      insert(payload) { state.operation = 'insert'; state.payload = clone(payload); return query; },
      update(payload) { state.operation = 'update'; state.payload = clone(payload); return query; },
      upsert(payload) { state.operation = 'upsert'; state.payload = clone(payload); return query; },
      delete() { state.operation = 'delete'; return query; },
      then(resolve, reject) {
        try {
          window.__testCalls.push(clone(state));
          if (state.operation === 'select') {
            let data = table === 'business_settings' ? [fixture.settings] : window.__testTrips;
            data = data.filter(matches);
            return deliver(`${table}:select`, { data: clone(state.single ? data[0] || null : data), error: null }).then(resolve, reject);
          }
          if (window.__testFailure) {
            return deliver(`${table}:${state.operation}`, { data: null, error: { message: window.__testFailure } }).then(resolve, reject);
          }
          let affected = [];
          if (table === 'trips') {
            if (state.operation === 'update') {
              window.__testTrips = window.__testTrips.map(row => {
                if (!matches(row)) return row;
                const updated = { ...row, ...clone(state.payload) };
                affected.push(updated);
                return updated;
              });
            } else if (state.operation === 'insert') {
              const inserted = { id: 'test-created-trip', ...clone(state.payload) };
              window.__testTrips.push(inserted);
              affected.push(inserted);
            } else if (state.operation === 'delete') {
              affected = window.__testTrips.filter(matches);
              window.__testTrips = window.__testTrips.filter(row => !matches(row));
            }
          }
          if (affected.length || table !== 'trips') window.__testWrites.push(clone(state));
          persistFeedback();
          const rows = state.returning ? affected.map(projection) : null;
          return deliver(`${table}:${state.operation}`, { data: rows && state.single ? rows[0] || null : rows, error: null }).then(resolve, reject);
        } catch (error) { return Promise.reject(error).then(resolve, reject); }
      },
    };
    return query;
  }

  window.supabase = {
    createClient() {
      return {
        auth: {
          getSession: async () => ({ data: { session }, error: null }),
          onAuthStateChange: callback => { authCallback = callback; return { data: { subscription: { unsubscribe() {} } } }; },
          signInWithPassword: async () => {
            session = { user: { id: 'test-owner-only', email: 'test@example.test' } };
            if (authCallback) authCallback('SIGNED_IN', session);
            return { data: { session }, error: null };
          },
          signOut: async () => { session = null; if (authCallback) authCallback('SIGNED_OUT', null); return { error: null }; },
          getUser: async () => ({ data: { user: session?.user || null }, error: null }),
        },
        from: tableQuery,
        rpc: async (name, args) => {
          window.__testCalls.push({ rpc: name, args: clone(args || {}) });
          if (name === 'get_public_settings') return { data: clone(fixture.settings), error: null };
          if (name === 'get_public_trip') {
            const trip = window.__testTrips.find(item => item.public_id === args.lookup_public_id);
            return { data: trip ? [clone(trip)] : [], error: null };
          }
          const missing = { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache` } };
          if (!name.startsWith('pt_feedback_') || !fixture.feedbackEnabled) return missing;
          const failure = window.__testRpcFailures[name];
          if (failure) return deliver(name, { data: null, error: typeof failure === 'string' ? { code: 'TEST_FAILURE', message: failure } : clone(failure) });
          let trip;
          if (name === 'pt_feedback_agent') trip = window.__testTrips.find(item => item.id === args.p_trip_id);
          else if (name === 'pt_feedback_resolve_request') {
            trip = window.__testTrips.find(item => feedbackState(item.id).requests.some(request => request.id === args.p_request_id));
          } else trip = window.__testTrips.find(item => item.public_id === args.p_public_id);
          if (!trip) return deliver(name, { data: null, error: { code: '42501', message: 'Synthetic trip not found' } });
          if ((name === 'pt_feedback_agent' || name === 'pt_feedback_resolve_request') && !session) return deliver(name, { data: null, error: { code: '42501', message: 'Authentication required' } });
          if (trip.status === 'draft' && name !== 'pt_feedback_agent' && name !== 'pt_feedback_resolve_request') return deliver(name, { data: null, error: { code: '42501', message: 'Trip is not published' } });
          if (name === 'pt_feedback_public_trip') {
            const publicFields = ['public_id', 'client_name', 'partner_name', 'destination', 'booking_number', 'start_date', 'end_date', 'language', 'status', 'hotel_name', 'hotel_map', 'outbound_flight', 'return_flight', 'welcome_message', 'itinerary', 'documents', 'updated_at'];
            return deliver(name, { data: clone(Object.fromEntries(publicFields.filter(key => Object.hasOwn(trip, key)).map(key => [key, trip[key]]))), error: null });
          }
          const state = feedbackState(trip.id);
          const envelope = () => ({ ...clone(state), trip_updated_at: trip.updated_at });
          const error = (message, code = '22023') => deliver(name, { data: null, error: { code, message } });
          const put = (list, key, value) => {
            const keys = Array.isArray(key) ? key : [key];
            const index = list.findIndex(item => keys.every(field => item[field] === value[field]));
            if (index < 0) list.push(value); else list[index] = value;
          };
          if (name === 'pt_feedback_client' || name === 'pt_feedback_agent') return deliver(name, { data: envelope(), error: null });
          const activity = Array.isArray(trip.itinerary) && trip.itinerary.find(item => item.activity_id === args.p_activity_id);
          if (name === 'pt_feedback_save_activity') {
            if (!activity) return error('Unknown activity');
            if (args.p_day_id !== activity.day_id) return error('revision_conflict: the activity has moved to a different day', '40001');
            if (!['done', 'skipped', 'deferred'].includes(args.p_status)) return error('Choose an activity status');
            if (args.p_status === 'skipped' && !String(args.p_reason || '').trim()) return error('A reason is required when skipping');
            put(state.reports, ['activity_id', 'day_id'], {
              activity_id: args.p_activity_id, day_id: activity.day_id, activity_title: activity.title, day_label: activity.day, status: args.p_status,
              reason: args.p_reason || '', delay_minutes: args.p_delay_minutes || 0,
              rating: args.p_rating || null, comment: args.p_comment || '', updated_at: stamp(),
            });
          } else if (name === 'pt_feedback_save_day') {
            const dayExists = Array.isArray(trip.itinerary) && trip.itinerary.some(item => item.day_id === args.p_day_id);
            if (!dayExists) return error('Unknown day');
            const day = trip.itinerary.find(item => item.day_id === args.p_day_id);
            put(state.day_summaries, 'day_id', { day_id: args.p_day_id, day_label: day.day, rating: args.p_rating || null, comment: args.p_comment || '', tomorrow_preferences: args.p_tomorrow_preferences || '', submitted_at: stamp() });
          } else if (name === 'pt_feedback_save_trip') {
            state.trip_review = { vacation_rating: args.p_vacation_rating || null, service_rating: args.p_service_rating || null, comment: args.p_comment || '', submitted_at: stamp() };
          } else if (name === 'pt_feedback_request_change') {
            if (!activity) return error('Unknown activity');
            if (!String(args.p_message || '').trim()) return error('Write a change request');
            if (!state.requests.some(request => request.client_request_id === args.p_client_request_id)) {
              state.requests.push({
                id: `00000000-0000-4000-8000-${String(state.requests.length + 1).padStart(12, '0')}`,
                activity_id: args.p_activity_id, day_id: activity.day_id, client_request_id: args.p_client_request_id,
                activity_title: activity.title, day_label: activity.day,
                request_text: args.p_message, agent_reply: '', status: 'pending', created_at: stamp(), resolved_at: null,
              });
            }
          } else if (name === 'pt_feedback_resolve_request') {
            const request = state.requests.find(item => item.id === args.p_request_id);
            if (!request || !['approved', 'alternative', 'rejected'].includes(args.p_status)) return error('Invalid request response');
            if (request.status !== 'pending') return error('revision_conflict: the request was already handled', '40001');
            if (!String(args.p_reply || '').trim()) return error('Write a reply');
            if (args.p_status === 'approved') {
              if (!Array.isArray(args.p_itinerary) || JSON.stringify(args.p_itinerary) === JSON.stringify(trip.itinerary)) return error('Approval requires an actual itinerary change');
              if (args.p_expected_updated_at !== trip.updated_at) return error('revision_conflict: the itinerary has changed', '40001');
              trip.itinerary = clone(args.p_itinerary);
              trip.updated_at = stamp();
            }
            request.status = args.p_status;
            request.agent_reply = args.p_reply;
            request.resolved_at = stamp();
          } else return missing;
          window.__testRpcWrites.push({ rpc: name, args: clone(args) });
          persistFeedback();
          const responseFailure = window.__testRpcResponseFailures[name];
          if (responseFailure) return deliver(name, { data: null, error: typeof responseFailure === 'string' ? { code: 'TEST_FAILURE', message: responseFailure } : clone(responseFailure) });
          return deliver(name, { data: envelope(), error: null });
        },
      };
    },
  };
}

function mockScript(options = {}) {
  const config = { trips: [structuredTrip], settings, authenticated: false, ...options };
  return `(${installMock.toString()})(${JSON.stringify(config)});`;
}

module.exports = { structuredTrip, legacyTrip, settings, mockScript };
