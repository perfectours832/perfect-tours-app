/* Persisted feedback boundary. No local-only success or official-trip writes. */
(function (root, factory) {
  const Service = factory();
  if (typeof module === 'object' && module.exports) module.exports = Service;
  if (root) root.FeedbackService = Service;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const empty = () => ({version: 1, reports: [], day_summaries: [], trip_review: null, requests: []});
  const copy = value => structuredClone(value);
  const error = (message, code = 'validation') => Object.assign(new Error(message), {code});

  function normalize(value) {
    const data = Array.isArray(value) && value.length === 1 ? value[0] : value;
    if (!data || data.version !== 1 || !Array.isArray(data.reports) ||
        !Array.isArray(data.day_summaries) || !Array.isArray(data.requests) ||
        !Object.hasOwn(data, 'trip_review') || (data.trip_review !== null &&
          (typeof data.trip_review !== 'object' || Array.isArray(data.trip_review)))) {
      throw error('השרת החזיר תשובה לא תקינה. הפעולה לא אושרה.', 'network');
    }
    return copy(data);
  }

  function asError(source) {
    if (source instanceof Error && ['validation', 'conflict', 'unavailable', 'network', 'forbidden'].includes(source.code)) return source;
    const code = String(source?.code || '');
    const message = String(source?.message || '');
    if (['PGRST202', '42883'].includes(code)) return error('הדיווחים עדיין לא חוברו לשמירה במערכת.', 'unavailable');
    if (code === '40001' || /revision_conflict/i.test(message)) return error('המסלול עודכן בינתיים. טענו אותו מחדש לפני שמירת השינוי.', 'conflict');
    if (['42501', 'PGRST301', 'PGRST302'].includes(code)) return error('אין הרשאה לפעולה הזו. בדקו את הקישור או התחברו מחדש.', 'forbidden');
    if (['22023', '23514', '23505'].includes(code)) return error('הפרטים לא התקבלו בשרת. בדקו את הדיווח ונסו שוב.', 'validation');
    return error('הפעולה לא נשמרה. בדקו את החיבור ונסו שוב.', 'network');
  }

  function text(value, max = 2000) {
    if (value != null && typeof value !== 'string') throw error('יש להזין טקסט תקין.');
    const result = String(value || '').trim();
    if (result.length > max) throw error(`הטקסט ארוך מדי. אפשר להזין עד ${max} תווים.`);
    return result;
  }

  function rating(value, required = false) {
    if (value === '' || value == null) {
      if (required) throw error('יש לבחור דירוג מ־1 עד 5.');
      return null;
    }
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > 5) throw error('הדירוג צריך להיות מ־1 עד 5.');
    return number;
  }

  class FeedbackService {
    constructor(db, {trip = null, publicId = null} = {}) {
      this.db = db;
      this.trip = trip;
      this.publicId = publicId;
      this.available = false;
      this.state = empty();
      this.lastError = null;
      this.listeners = new Set();
      this.pending = Promise.resolve();
      this.destroyed = false;
      const rows = Array.isArray(trip?.itinerary) ? trip.itinerary : [];
      const counts = new Map();
      rows.forEach(row => {
        if (row && row.kind !== 'day' && typeof row.activity_id === 'string' && row.activity_id.trim()) {
          counts.set(row.activity_id, (counts.get(row.activity_id) || 0) + 1);
        }
      });
      this.activities = new Map(rows.filter(row => row && row.kind !== 'day' &&
        typeof row.activity_id === 'string' && row.activity_id.trim() && !/^activity-index-\d+$/.test(row.activity_id) && counts.get(row.activity_id) === 1 &&
        typeof row.day_id === 'string' && row.day_id.trim() && !/^day-index-\d+$/.test(row.day_id)).map(row => [row.activity_id, copy(row)]));
      this.days = new Set(rows.filter(row => row && typeof row.day_id === 'string' && row.day_id.trim() && !/^day-index-\d+$/.test(row.day_id)).map(row => row.day_id));
    }

    hasActivity(id) { return this.activities.has(id); }
    hasDay(id) { return this.days.has(id); }
    subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    notify() {
      for (const listener of this.listeners) {
        try { listener(this.state); }
        catch (_) {
          // A display error must not turn a committed save into a failed save.
          this.viewNeedsRefresh = true;
        }
      }
    }
    destroy() { this.destroyed = true; this.listeners.clear(); }

    async call(name, args) {
      if (this.destroyed) throw error('הפעולה הופסקה.', 'forbidden');
      let result;
      try { result = await this.db.rpc(`pt_feedback_${name}`, args); }
      catch (cause) { throw asError(cause); }
      if (this.destroyed) throw error('הפעולה הופסקה.', 'forbidden');
      if (result.error) throw asError(result.error);
      return normalize(result.data);
    }

    async loadClient() {
      try {
        if (!this.publicId) throw error('קישור החופשה חסר.', 'forbidden');
        this.state = await this.call('client', {p_public_id: this.publicId});
        this.available = true; this.lastError = null; this.notify();
        return this.state;
      } catch (cause) {
        this.available = false; this.lastError = asError(cause);
        return null; // Reading the existing itinerary remains usable.
      }
    }

    mutate(name, args) {
      const operation = this.pending.then(async () => {
        if (!this.available || !this.publicId) throw error('הדיווחים עדיין לא חוברו לשמירה במערכת.', 'unavailable');
        const state = await this.call(name, {p_public_id: this.publicId, ...args});
        this.state = state; this.notify();
        return state;
      });
      this.pending = operation.catch(() => {});
      return operation;
    }

    saveActivity(input) {
      if (!this.hasActivity(input.activity_id)) return Promise.reject(error('הפעילות עדיין אינה מוכנה לדיווח. פנו לסוכן.'));
      if (!['done', 'skipped', 'deferred'].includes(input.status)) return Promise.reject(error('בחרו מה עשיתם בפעילות.'));
      try {
        const reason = text(input.reason);
        if (input.status !== 'done' && !reason) throw error('הוסיפו סיבה קצרה לדילוג או לדחייה.');
        const delay = input.delay_minutes === '' || input.delay_minutes == null ? 0 : Number(input.delay_minutes);
        if (!Number.isInteger(delay) || delay < 0 || delay > 1440) throw error('העיכוב צריך להיות מספר דקות בין 0 ל־1440.');
        const score = rating(input.rating);
        if (input.status !== 'done' && score !== null) throw error('אפשר לדרג פעילות לאחר שבוצעה.');
        return this.mutate('save_activity', {
          p_activity_id: input.activity_id, p_day_id: this.activities.get(input.activity_id).day_id,
          p_status: input.status, p_reason: reason,
          p_delay_minutes: delay, p_rating: score, p_comment: text(input.comment)
        });
      } catch (cause) { return Promise.reject(cause); }
    }

    saveDay(input) {
      if (!this.hasDay(input.day_id)) return Promise.reject(error('היום עדיין אינו מוכן לסיכום. פנו לסוכן.'));
      try {
        return this.mutate('save_day', {p_day_id: input.day_id, p_rating: rating(input.rating),
          p_comment: text(input.comment), p_tomorrow_preferences: text(input.tomorrow_preferences)});
      } catch (cause) { return Promise.reject(cause); }
    }

    saveTrip(input) {
      try {
        return this.mutate('save_trip', {p_vacation_rating: rating(input.vacation_rating, true),
          p_service_rating: rating(input.service_rating, true), p_comment: text(input.comment)});
      } catch (cause) { return Promise.reject(cause); }
    }

    requestChange(input) {
      if (!this.hasActivity(input.activity_id)) return Promise.reject(error('הפעילות עדיין אינה מוכנה לבקשת שינוי. פנו לסוכן.'));
      try {
        const message = text(input.message, 4000);
        if (!message) throw error('כתבו מה תרצו לשנות.');
        if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(input.client_request_id || '')) throw error('לא ניתן לזהות את הבקשה. נסו לפתוח את הכרטיס מחדש.');
        return this.mutate('request_change', {p_activity_id: input.activity_id, p_message: message,
          p_client_request_id: input.client_request_id});
      } catch (cause) { return Promise.reject(cause); }
    }

    async agent(tripId) {
      return this.call('agent', {p_trip_id: tripId});
    }

    async resolveRequest(input) {
      const reply = text(input.reply, 4000);
      if (!reply) throw error('הוסיפו תשובה ללקוח.');
      if (!['approved', 'alternative', 'rejected'].includes(input.status)) throw error('בחרו כיצד לטפל בבקשה.');
      if (input.status === 'approved' && !Array.isArray(input.itinerary)) throw error('יש לערוך את המסלול לפני אישור השינוי.');
      return this.call('resolve_request', {p_request_id: input.request_id, p_status: input.status,
        p_reply: reply, p_itinerary: input.status === 'approved' ? input.itinerary : null,
        p_expected_updated_at: input.expected_updated_at || null});
    }
  }

  return FeedbackService;
});
