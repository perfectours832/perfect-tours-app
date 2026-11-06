/* Shared, side-effect-free itinerary data contract. No customer data is migrated here. */
(function (root, factory) {
  'use strict';
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  if (root) root.ItineraryModel = model;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const isRecord = value => value !== null && typeof value === 'object' &&
    !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const stringValue = value => typeof value === 'string' ? value : '';
  let idSequence = 0;

  function clone(value, seen = new Map()) {
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);
    const copy = Array.isArray(value) ? [] : {};
    seen.set(value, copy);
    for (const key of Object.keys(value)) {
      Object.defineProperty(copy, key, {
        value: clone(value[key], seen), enumerable: true, configurable: true, writable: true
      });
    }
    return copy;
  }

  function createId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    // These are local record identities, never authentication or public access tokens.
    idSequence += 1;
    return `local-${Date.now().toString(36)}-${idSequence}-${Math.random().toString(36).slice(2)}`;
  }

  function paid(value) {
    return value === true || /^(כן|כרטיס|נרכש|true|yes|paid|1)$/i.test(String(value ?? '').trim());
  }

  function safeUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const url = new URL(value.trim());
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
        ? url.href : '';
    } catch (_) { return ''; }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
  }

  function jsonText(value) {
    try { return JSON.stringify(value, null, 2) ?? ''; }
    catch (_) { return String(value ?? ''); }
  }

  function legacyText(input) {
    if (typeof input === 'string') return input;
    if (!Array.isArray(input)) return input == null ? '' : jsonText(input);
    return input.map(row => {
      if (typeof row === 'string') return row;
      if (!isRecord(row)) return jsonText(row);
      const keys = Object.keys(row);
      const textKeys = ['day', 'time', 'title', 'description'];
      // Unknown shapes remain visible verbatim rather than silently losing fields.
      if (keys.some(key => !textKeys.includes(key)) ||
          keys.some(key => typeof row[key] !== 'string' && row[key] != null)) return jsonText(row);
      return textKeys.map(key => stringValue(row[key])).filter(value => value !== '').join(' | ');
    }).join('\n');
  }

  function textIdentity(row) {
    return JSON.stringify([stringValue(row.day), stringValue(row.day_date)]);
  }

  function identifier(value) {
    return typeof value === 'string' && value.trim() ? value : '';
  }

  function decode(input) {
    const original = clone(input);
    const result = (kind, days = []) => ({kind, days, original,
      legacyText: kind === 'unsupported' ? jsonText(input) : legacyText(input)});
    if (input == null) return result('structured');
    // Text is always preserved. Even text that resembles the import format needs review.
    if (typeof input === 'string') return result('legacy');
    if (!Array.isArray(input)) return result('unsupported');
    if (!input.length) return result('structured');
    if (input.some(row => !isRecord(row))) {
      return result(input.every(row => typeof row === 'string' || isRecord(row)) ? 'legacy' : 'unsupported');
    }

    let hasLegacyRows = false;
    for (const row of input) {
      if (['day', 'day_date', 'time', 'title', 'description', 'day_id', 'activity_id'].some(key =>
        owns(row, key) && row[key] != null && typeof row[key] !== 'string')) return result('unsupported');
      if (row.kind === 'day') {
        if (!owns(row, 'day') && !identifier(row.day_id)) return result('unsupported');
        continue;
      }
      if (!['day', 'time', 'title', 'description'].some(key => owns(row, key))) return result('unsupported');
      if (!stringValue(row.title).trim()) hasLegacyRows = true;
    }
    if (hasLegacyRows) return result('legacy');

    // A label can identify an old day only when it has at most one explicit ID.
    const idsByLabel = new Map();
    input.forEach(row => {
      if (!identifier(row.day_id)) return;
      const key = textIdentity(row);
      if (!idsByLabel.has(key)) idsByLabel.set(key, new Set());
      idsByLabel.get(key).add(row.day_id);
    });
    const days = [];
    const groups = new Map();
    input.forEach((row, index) => {
      const textKey = textIdentity(row);
      const matchingIds = idsByLabel.get(textKey);
      const dayId = identifier(row.day_id) ||
        (matchingIds && matchingIds.size === 1 ? [...matchingIds][0] : '');
      const key = dayId ? `id:${dayId}` : `label:${textKey}`;
      let day = groups.get(key);
      if (!day) {
        day = {
          id: dayId || `day-index-${index}`,
          label: stringValue(row.day), date: stringValue(row.day_date), activities: []
        };
        groups.set(key, day);
        days.push(day);
      }
      if (row.kind === 'day') {
        // Keep marker metadata even when an empty day later receives activities.
        day._marker = {...(day._marker || {}), ...clone(row)};
        if (owns(row, 'day')) day.label = stringValue(row.day);
        if (owns(row, 'day_date')) day.date = stringValue(row.day_date);
      } else {
        day.activities.push({
          ...clone(row), activity_id: identifier(row.activity_id) || `activity-index-${index}`,
          day_id: day.id, day: day.label, day_date: day.date
        });
      }
    });
    return result('structured', days);
  }

  function encode(days) {
    if (!Array.isArray(days)) throw new TypeError('Itinerary days must be an array.');
    return days.flatMap(day => {
      if (!isRecord(day) || !Array.isArray(day.activities)) throw new TypeError('Invalid itinerary day.');
      const common = {
        day_id: identifier(day.id) && !/^day-index-\d+$/.test(day.id) ? day.id : createId(), day: stringValue(day.label), day_date: stringValue(day.date)
      };
      const rows = [];
      if (!day.activities.length || isRecord(day._marker)) {
        rows.push({...clone(day._marker || {}), kind: 'day', ...common});
      }
      day.activities.forEach(activity => {
        if (!isRecord(activity) || !stringValue(activity.title).trim()) {
          throw new TypeError('Every structured activity needs a title.');
        }
        rows.push({
          ...clone(activity),
          activity_id: identifier(activity.activity_id) && !/^activity-index-\d+$/.test(activity.activity_id) ? activity.activity_id : createId(), ...common,
          time: activity.time ?? '', title: activity.title, description: activity.description ?? '',
          duration_minutes: activity.duration_minutes ?? '', address: activity.address ?? '',
          ticket_purchased: paid(activity.ticket_purchased), entry_time: activity.entry_time ?? '',
          reservation_status: activity.reservation_status ?? '', image_url: activity.image_url ?? '',
          map_url: activity.map_url ?? '', document_url: activity.document_url ?? ''
        });
      });
      return rows;
    });
  }

  function timeMinutes(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(stringValue(value).trim());
    return match && Number(match[1]) < 24 && Number(match[2]) < 60
      ? Number(match[1]) * 60 + Number(match[2]) : Infinity;
  }

  function orderedActivities(activities) {
    if (!Array.isArray(activities)) return [];
    return activities.map((activity, index) => ({activity, index, minutes: timeMinutes(activity.time)}))
      .sort((a, b) => a.minutes - b.minutes || a.index - b.index).map(row => row.activity);
  }

  function previewImport(text) {
    const errors = [];
    if (typeof text !== 'string' || !text.trim()) {
      return {days: [], errors: ['יש להזין מסלול לבדיקה.']};
    }
    const rows = [];
    text.split(/\r?\n/).forEach((line, index) => {
      if (!line.trim()) return;
      const columns = line.split('|').map(value => value.trim());
      const prefix = `שורה ${index + 1}: `;
      if (columns.length !== 7) {
        errors.push(prefix + 'נדרשים בדיוק 7 שדות: יום | שעה | שם פעילות | תיאור | כרטיס | תמונה | ניווט.');
        return;
      }
      const [day, time, title, description, ticket, image, map] = columns;
      if (!day || !title) errors.push(prefix + 'יש למלא יום ושם פעילות.');
      if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) errors.push(prefix + 'שעה חייבת להיות בפורמט HH:mm.');
      if (ticket && !/^(כן|כרטיס|נרכש|true|yes|paid|1|לא|false|no|0|ללא)$/i.test(ticket)) {
        errors.push(prefix + 'ערך כרטיס לא מזוהה; יש להשתמש בכרטיס, כן, לא או להשאיר ריק.');
      }
      if (image && !safeUrl(image)) errors.push(prefix + 'קישור התמונה חייב להתחיל ב־https:// או http://.');
      if (map && !safeUrl(map)) errors.push(prefix + 'קישור הניווט חייב להתחיל ב־https:// או http://.');
      rows.push({day, time, title, description, ticket_purchased: paid(ticket),
        image_url: image ? safeUrl(image) : '', map_url: map ? safeUrl(map) : '', activity_id: createId()});
    });
    if (errors.length) return {days: [], errors};
    const decoded = decode(rows);
    decoded.days.forEach(day => { day.id = createId(); });
    // Reconcile generated day IDs in the preview without writing to the source text.
    decoded.days.forEach(day => day.activities.forEach(activity => { activity.day_id = day.id; }));
    return {days: decoded.days, errors: []};
  }

  return Object.freeze({decode, encode, createId, paid, safeUrl, escapeHtml, legacyText,
    previewImport, orderedActivities});
});
