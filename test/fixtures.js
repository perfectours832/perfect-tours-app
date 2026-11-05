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
  window.__testWrites = [];
  window.__testCalls = [];
  window.__testFailure = null;
  window.__testTrips = fixture.trips;
  window.__testDelay = clone(fixture.delays || {});
  window.__testPending = [];
  let session = fixture.authenticated ? { user: { id: 'test-owner-only', email: 'test@example.test' } } : null;
  let authCallback = null;

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
    const state = { table, operation: 'select', payload: null, filter: null, single: false };
    const query = {
      select() { return query; },
      order() { return query; },
      limit() { return query; },
      eq(field, value) { state.filter = [field, value]; return query; },
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
            if (state.filter) data = data.filter(row => row[state.filter[0]] === state.filter[1]);
            return deliver(`${table}:select`, { data: clone(state.single ? data[0] || null : data), error: null }).then(resolve, reject);
          }
          if (window.__testFailure) {
            return deliver(`${table}:${state.operation}`, { data: null, error: { message: window.__testFailure } }).then(resolve, reject);
          }
          window.__testWrites.push(clone(state));
          if (table === 'trips') {
            if (state.operation === 'update') {
              window.__testTrips = window.__testTrips.map(row => !state.filter || row[state.filter[0]] === state.filter[1] ? { ...row, ...clone(state.payload) } : row);
            } else if (state.operation === 'insert') {
              window.__testTrips.push({ id: 'test-created-trip', ...clone(state.payload) });
            } else if (state.operation === 'delete') {
              window.__testTrips = window.__testTrips.filter(row => !state.filter || row[state.filter[0]] !== state.filter[1]);
            }
          }
          return deliver(`${table}:${state.operation}`, { data: null, error: null }).then(resolve, reject);
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
          return { data: null, error: { message: 'Unexpected test RPC' } };
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
