/* Perfect Tours: routing, authentication and existing Supabase persistence. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const model = window.ItineraryModel;
  const defaults = {
    business_name: 'Perfect Tours', contact_phone: '0527142429',
    whatsapp_phone: '972527142429', primary_color: '#0b4268',
    default_welcome: 'ברוכים הבאים לחופשה שלכם.'
  };
  let settings = { ...defaults };
  let trips = [];
  let db, editor, toastTimer, activeUserId;
  let originalDocuments = [], documentsText = '';
  let saving = false;
  let tripDirty = false;
  let sessionGeneration = 0;
  let lang = 'he';

  function toast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').style.display = 'block';
    toastTimer = setTimeout(() => { $('toast').style.display = 'none'; }, 4500);
  }

  function dateFmt(value) {
    if (!value) return '—';
    const date = new Date(value + 'T12:00:00');
    return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleDateString('he-IL');
  }

  function publicToken() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  function showTab(id) {
    if (saving) return;
    document.querySelectorAll('.tabpage').forEach(el => el.classList.toggle('hidden', el.id !== id));
    document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.dataset.tab === id));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function applyBrand() {
    const color = /^#[\da-f]{6}$/i.test(settings.primary_color || '') ? settings.primary_color : defaults.primary_color;
    document.documentElement.style.setProperty('--p', color);
    $('businessName').value = settings.business_name || defaults.business_name;
    $('contactPhone').value = settings.contact_phone || '';
    $('whatsappPhone').value = settings.whatsapp_phone || '';
    $('businessEmail').value = settings.email || '';
    $('businessWebsite').value = settings.website || '';
    $('primaryColor').value = color;
    $('defaultWelcome').value = settings.default_welcome || '';
    $('adminBrandName').textContent = settings.business_name || 'מערכת ניהול חופשות';
    const logo = String(settings.logo_data || '');
    const safeLogo = /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(logo) ? logo : model.safeUrl(logo);
    for (const id of ['adminLogo', 'logoPreview']) {
      const img = $(id);
      if (safeLogo) img.src = safeLogo;
      else img.removeAttribute('src');
      img.style.display = safeLogo ? 'block' : 'none';
    }
  }

  async function loadSettings(publicMode, generation = sessionGeneration) {
    const result = publicMode
      ? await db.rpc('get_public_settings')
      : await db.from('business_settings').select('*').maybeSingle();
    if (!publicMode && generation !== sessionGeneration) return;
    if (result.error) {
      toast('לא ניתן לטעון את הגדרות העסק. מוצגים פרטי ברירת המחדל.');
    } else if (result.data) {
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      if (row) settings = { ...defaults, ...row };
    }
    applyBrand();
  }

  async function loadTrips(generation = sessionGeneration) {
    const { data, error } = await db.from('trips').select('*').order('created_at', { ascending: false });
    if (generation !== sessionGeneration) return;
    if (error) throw new Error('טעינת החופשות נכשלה: ' + error.message);
    trips = data || [];
    renderTrips();
  }

  function renderTrips() {
    const query = $('searchTrips').value.trim().toLocaleLowerCase();
    const filtered = trips.filter(t => `${t.client_name || ''} ${t.destination || ''}`.toLocaleLowerCase().includes(query));
    $('tripCount').textContent = trips.length;
    $('activeCount').textContent = trips.filter(t => t.status === 'active').length;
    $('customerCount').textContent = trips.length;
    $('documentCount').textContent = trips.reduce((n, t) => n + (Array.isArray(t.documents) ? t.documents.length : 0), 0);
    $('tripList').replaceChildren();
    if (!filtered.length) {
      $('tripList').textContent = 'לא נמצאו חופשות.';
      return;
    }
    const statuses = { active: 'פעילה', draft: 'טיוטה', done: 'הסתיימה' };
    for (const trip of filtered) {
      const card = document.createElement('article');
      card.className = 'trip';
      const info = document.createElement('div');
      const title = document.createElement('h3');
      title.textContent = `${trip.client_name || ''}${trip.partner_name ? ' ו' + trip.partner_name : ''} — ${trip.destination || ''} `;
      const status = document.createElement('span');
      status.className = 'status ' + (Object.hasOwn(statuses, trip.status) ? trip.status : 'draft');
      status.textContent = statuses[trip.status] || trip.status || 'טיוטה';
      title.append(status);
      const dates = document.createElement('p');
      dates.textContent = `${dateFmt(trip.start_date)} עד ${dateFmt(trip.end_date)}`;
      info.append(title, dates);
      const actions = document.createElement('div');
      actions.className = 'actions';
      const url = new URL('./', location.href);
      url.searchParams.set('trip', trip.public_id);
      const open = document.createElement('a');
      open.href = url.href; open.target = '_blank'; open.rel = 'noopener noreferrer';
      open.textContent = 'פתח';
      const copy = actionButton('העתק קישור', 'copy-trip', trip.id);
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(url.href); toast('הקישור הועתק'); }
        catch { toast('ההעתקה לא הצליחה. ניתן להעתיק את כתובת הקישור מכפתור פתח.'); }
      });
      const whatsapp = document.createElement('a');
      whatsapp.textContent = 'WhatsApp'; whatsapp.target = '_blank'; whatsapp.rel = 'noopener noreferrer';
      whatsapp.href = 'https://wa.me/?text=' + encodeURIComponent(`שלום ${trip.client_name || ''}, האפליקציה האישית לחופשה שלכם: ${url.href}`);
      const edit = actionButton('עריכה', 'edit-trip', trip.id);
      edit.addEventListener('click', () => editTrip(trip.id));
      const remove = actionButton('מחיקה', 'delete-trip', trip.id);
      remove.className = 'danger';
      remove.addEventListener('click', () => removeTrip(trip));
      actions.append(open, copy, whatsapp, edit, remove);
      card.append(info, actions);
      $('tripList').append(card);
    }
  }

  function actionButton(text, action, id) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = text;
    button.dataset.action = action; button.dataset.id = id;
    return button;
  }

  const fields = [
    ['clientName', 'client_name'], ['partnerName', 'partner_name'], ['destination', 'destination'],
    ['bookingNumber', 'booking_number'], ['startDate', 'start_date'], ['endDate', 'end_date'],
    ['clientPhone', 'client_phone'], ['hotelName', 'hotel_name'], ['hotelMap', 'hotel_map'],
    ['outboundFlight', 'outbound_flight'], ['returnFlight', 'return_flight'],
    ['welcomeMessage', 'welcome_message'], ['tripLanguage', 'language'], ['tripStatus', 'status']
  ];

  function loadDocuments(value) {
    originalDocuments = structuredClone(value);
    documentsText = Array.isArray(value)
      ? value.map(d => `${d?.name || ''} | ${d?.url || ''}`).join('\n')
      : typeof value === 'string' ? value : JSON.stringify(value, null, 2) || '';
    $('documents').value = documentsText;
    $('documents').readOnly = value != null && !Array.isArray(value);
  }

  function getDocuments() {
    if ($('documents').value === documentsText) return structuredClone(originalDocuments);
    const originals = Array.isArray(originalDocuments) ? originalDocuments : [];
    const matched = new Set();
    return $('documents').value.split(/\r?\n/).filter(s => s.trim()).map((line, index) => {
      const parts = line.split('|').map(s => s.trim());
      if (parts.length !== 2 || !parts[0] || !model.safeUrl(parts[1])) {
        throw new Error(`מסמך בשורה ${index + 1}: יש להזין שם וקישור HTTP או HTTPS בלבד.`);
      }
      // Match document identity, never line position: deletion/reordering must not
      // move a document's private metadata onto a different document.
      let source = originals.findIndex((d, i) => !matched.has(i) && d?.name === parts[0] && d?.url === parts[1]);
      if (source < 0) {
        for (const [key, value] of [['url', parts[1]], ['name', parts[0]]]) {
          const candidates = originals.map((d, i) => ({ d, i })).filter(({ d, i }) => !matched.has(i) && d?.[key] === value);
          if (candidates.length === 1) { source = candidates[0].i; break; }
        }
      }
      if (source >= 0) matched.add(source);
      return { ...(source >= 0 ? originals[source] : {}), name: parts[0], url: parts[1] };
    });
  }

  function hasUnsavedTrip() { return tripDirty || editor.isDirty(); }

  function editTrip(id) {
    if (saving) return;
    const trip = trips.find(t => t.id === id);
    if (!trip) return;
    if (hasUnsavedTrip() && !confirm('לעבור לחופשה אחרת ולוותר על השינויים שטרם נשמרו?')) return;
    for (const [id, key] of fields) $(id).value = trip[key] ?? ({ tripLanguage: 'he', tripStatus: 'draft' }[id] || '');
    editor.load(trip.itinerary);
    loadDocuments(trip.documents);
    $('editId').value = trip.id;
    $('editorTitle').textContent = 'עריכת החופשה של ' + trip.client_name;
    $('saveBtn').textContent = 'שמור שינויים';
    $('cancelBtn').classList.remove('hidden');
    $('saveError').classList.add('hidden');
    tripDirty = false;
    showTab('tripEditor');
  }

  function resetForm() {
    $('tripForm').reset();
    $('editId').value = '';
    $('editorTitle').textContent = 'יצירת חופשה';
    $('saveBtn').textContent = 'צור אפליקציה';
    $('cancelBtn').classList.add('hidden');
    $('saveError').classList.add('hidden');
    editor.reset();
    loadDocuments([]);
    tripDirty = false;
  }

  async function removeTrip(trip) {
    if (saving) return;
    const generation = sessionGeneration;
    if (!confirm(`למחוק את החופשה של ${trip.client_name}? הפעולה תמחק את רשומת החופשה.`)) return;
    try {
      const { error } = await db.from('trips').delete().eq('id', trip.id);
      if (generation !== sessionGeneration) return;
      if (error) throw error;
      if ($('editId').value === trip.id) resetForm();
      await loadTrips(); toast('החופשה נמחקה');
    } catch (error) { if (generation === sessionGeneration) toast('המחיקה נכשלה: ' + error.message); }
  }

  async function saveTrip(event) {
    event.preventDefault();
    if (saving) return;
    $('saveError').classList.add('hidden');
    const id = $('editId').value;
    const generation = sessionGeneration;
    try {
      if ($('endDate').value < $('startDate').value) throw new Error('תאריך החזרה צריך להיות מאוחר מתאריך היציאה או זהה לו.');
      if ($('hotelMap').value.trim() && !model.safeUrl($('hotelMap').value.trim())) throw new Error('קישור המלון חייב להתחיל ב־HTTP או HTTPS.');
      const payload = {};
      for (const [field, key] of fields) payload[key] = $(field).value.trim() || null;
      payload.welcome_message ||= settings.default_welcome || defaults.default_welcome;
      const itinerary = editor.getValue();
      if (itinerary !== undefined) payload.itinerary = itinerary;
      const documents = getDocuments();
      if (documents !== undefined) payload.documents = documents;
      payload.updated_at = new Date().toISOString();
      saving = true; $('saveBtn').disabled = true; $('saveBtn').textContent = 'שומר…';
      $('adminPage').inert = true;
      $('tripForm').setAttribute('aria-busy', 'true');
      const result = id
        ? await db.from('trips').update(payload).eq('id', id)
        : await db.from('trips').insert({ ...payload, public_id: publicToken() });
      if (generation !== sessionGeneration) return;
      if (result.error) throw new Error('השמירה נכשלה: ' + result.error.message);
      resetForm();
      toast(id ? 'השינויים נשמרו' : 'החופשה נוצרה');
      saving = false;
      showTab('tripListCard');
      try { await loadTrips(); } catch (error) { toast('החופשה נשמרה. ' + error.message); }
    } catch (error) {
      if (generation !== sessionGeneration) return;
      $('saveError').textContent = error.message || 'השמירה נכשלה. נסו שוב.';
      $('saveError').classList.remove('hidden');
      $('saveError').scrollIntoView({ block: 'center' });
    } finally {
      saving = false; $('saveBtn').disabled = false;
      $('adminPage').inert = false;
      $('tripForm').removeAttribute('aria-busy');
      $('saveBtn').textContent = $('editId').value ? 'שמור שינויים' : 'צור אפליקציה';
    }
  }

  async function setSession(session) {
    const on = !!session;
    $('loginCard').classList.toggle('hidden', on);
    $('dashboard').classList.toggle('hidden', !on);
    $('logoutBtn').classList.toggle('hidden', !on);
    if (!on) {
      sessionGeneration += 1;
      activeUserId = undefined; trips = []; resetForm(); renderTrips();
      settings = { ...defaults }; applyBrand(); return;
    }
    const userId = session.user?.id;
    if (userId && userId === activeUserId) return;
    sessionGeneration += 1;
    const generation = sessionGeneration;
    trips = []; resetForm(); renderTrips();
    settings = { ...defaults }; applyBrand();
    activeUserId = userId;
    try { await Promise.all([loadSettings(false, generation), loadTrips(generation)]); }
    catch (error) { if (generation === sessionGeneration) toast(error.message); }
  }

  async function loadClient(id) {
    const { data, error } = await db.rpc('get_public_trip', { lookup_public_id: id });
    const trip = Array.isArray(data) ? data[0] : data;
    if (error || !trip) throw new Error('הקישור אינו זמין. פנו לסוכן הנסיעות לקבלת קישור תקין.');
    // This controls presentation only. RPC/RLS must also restrict draft access.
    if (trip.status === 'draft') throw new Error('המסלול עדיין בהכנה. הסוכן יעדכן אתכם כשהוא יהיה מוכן.');
    lang = trip.language === 'en' ? 'en' : 'he';
    const draw = () => window.ClientView.render(trip, settings, lang);
    $('langBtn').addEventListener('click', () => { lang = lang === 'he' ? 'en' : 'he'; draw(); });
    draw();
  }

  function bindAdmin() {
    document.querySelectorAll('.tab:not([data-new-trip])').forEach(button => button.addEventListener('click', () => showTab(button.dataset.tab)));
    document.querySelectorAll('[data-new-trip]').forEach(button => button.addEventListener('click', () => {
      if (saving) return;
      if (hasUnsavedTrip() && !confirm('ליצור חופשה חדשה ולוותר על השינויים שטרם נשמרו?')) return;
      resetForm(); showTab('tripEditor');
    }));
    document.querySelectorAll('[data-open-tab]').forEach(button => button.addEventListener('click', () => showTab(button.dataset.openTab)));
    $('searchTrips').addEventListener('input', renderTrips);
    $('tripForm').addEventListener('submit', saveTrip);
    $('tripForm').addEventListener('input', () => { tripDirty = true; });
    $('tripForm').addEventListener('change', () => { tripDirty = true; });
    $('cancelBtn').addEventListener('click', () => {
      if (saving) return;
      if (hasUnsavedTrip() && !confirm('לבטל את השינויים שטרם נשמרו?')) return;
      resetForm(); showTab('tripListCard');
    });
    $('loginForm').addEventListener('submit', async event => {
      event.preventDefault();
      const button = event.submitter; if (button) button.disabled = true;
      try {
        const { data, error } = await db.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
        if (error) throw error;
        $('password').value = '';
        if (data?.session) await setSession(data.session);
      } catch (error) { toast('ההתחברות נכשלה: ' + error.message); }
      finally { if (button) button.disabled = false; }
    });
    $('logoutBtn').addEventListener('click', async () => {
      try { const { error } = await db.auth.signOut(); if (error) throw error; await setSession(null); }
      catch (error) { toast('היציאה נכשלה: ' + error.message); }
    });
    $('logoInput').addEventListener('change', event => {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > 650000 || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
        toast('בחרו תמונת PNG, JPEG, WebP או GIF עד 650KB.'); event.target.value = ''; return;
      }
      const reader = new FileReader();
      reader.onload = () => { settings.logo_data = reader.result; applyBrand(); };
      reader.readAsDataURL(file);
    });
    $('removeLogo').addEventListener('click', () => { settings.logo_data = null; applyBrand(); });
    $('settingsForm').addEventListener('submit', async event => {
      event.preventDefault();
      const generation = sessionGeneration;
      const button = event.submitter; if (button) button.disabled = true;
      try {
        const { data: { user }, error: authError } = await db.auth.getUser();
        if (generation !== sessionGeneration) return;
        if (authError || !user) throw new Error('יש להתחבר מחדש.');
        const payload = {
          owner_id: user.id, business_name: $('businessName').value.trim() || defaults.business_name,
          contact_phone: $('contactPhone').value.trim(), whatsapp_phone: $('whatsappPhone').value.trim(),
          email: $('businessEmail').value.trim(), website: $('businessWebsite').value.trim(),
          primary_color: $('primaryColor').value, default_welcome: $('defaultWelcome').value.trim(),
          logo_data: settings.logo_data || null, updated_at: new Date().toISOString()
        };
        const { error } = await db.from('business_settings').upsert(payload, { onConflict: 'owner_id' });
        if (generation !== sessionGeneration) return;
        if (error) throw error;
        settings = { ...settings, ...payload }; applyBrand(); toast('ההגדרות נשמרו');
      } catch (error) { if (generation === sessionGeneration) toast('שמירת ההגדרות נכשלה: ' + error.message); }
      finally { if (button) button.disabled = false; }
    });
  }

  async function start() {
    try {
      if (!window.supabase || !model || !window.TripEditor || !window.ClientView) throw new Error('לא ניתן לטעון את רכיבי המערכת. בדקו את חיבור האינטרנט ורעננו.');
      db = window.supabase.createClient('https://pcwosixpckdiodixmvhq.supabase.co', 'sb_publishable_fz6-acfY-axDH35LNKrwvA_3lC5iOKT');
      editor = new window.TripEditor($('itineraryEditor'));
      editor.reset(); loadDocuments([]); bindAdmin();
      const id = new URLSearchParams(location.search).get('trip');
      if (id) {
        await loadSettings(true);
        await loadClient(id);
        $('clientPage').classList.remove('hidden');
      } else {
        $('adminPage').classList.remove('hidden');
        const { data: { session }, error } = await db.auth.getSession();
        if (error) throw error;
        await setSession(session);
        // Keep the auth callback synchronous; database calls run outside its lock.
        db.auth.onAuthStateChange((_event, session) => { setTimeout(() => { void setSession(session); }, 0); });
      }
      $('loading').classList.add('hidden');
    } catch (error) {
      $('loading').replaceChildren();
      const box = document.createElement('div');
      const title = document.createElement('h2'); title.textContent = 'Perfect Tours';
      const message = document.createElement('p'); message.textContent = error.message || 'לא ניתן לטעון את המערכת. נסו שוב.';
      box.append(title, message); $('loading').append(box);
      $('loading').classList.remove('hidden');
      $('clientPage').classList.add('hidden');
      $('adminPage').classList.add('hidden');
    }
  }

  void start();
})();
