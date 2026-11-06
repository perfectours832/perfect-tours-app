/* Client reports and feedback. Every saved indicator follows a confirmed server response. */
(() => {
  'use strict';

  let instanceSequence = 0;
  const esc = value => window.ItineraryModel.escapeHtml(value);
  const statuses = ['done', 'skipped', 'deferred'];
  const dictionaries = {
    he: {
      experience: 'החוויה שלכם', report: 'דיווח ודירוג הפעילות', status: 'מה עשיתם בפועל?',
      reportNote: 'הדיווח מתאר את ההתנהלות שלכם. הוא אינו משנה את המסלול הרשמי או הזמנות.',
      done: 'בוצע', skipped: 'דילגנו', deferred: 'נדחה מבחינתנו', unreported: 'לא דווח',
      current: 'הדיווח השמור: ', reason: 'מה הסיבה?', reasonHint: 'נדרש הסבר קצר לדילוג או לדחייה.',
      delay: 'עיכוב שדווח (בדקות)', delayHint: 'אם לא היה עיכוב, אפשר להשאיר 0.',
      activityRating: 'איך הייתה הפעילות? (לא חובה)', comment: 'משהו שתרצו לשתף?',
      saveReport: 'שמירת דיווח', saving: 'שומר…', saved: 'נשמר ונשלח לסוכן.',
      unsaved: 'יש שינויים שעדיין לא נשמרו.', private: 'המשוב פרטי ונגיש לסוכן שלכם בלבד.',
      reported: 'דיווח שמור', chooseStatus: 'בחרו מה עשיתם בפעילות.',
      reasonRequired: 'כתבו סיבה קצרה לדילוג או לדחייה.', invalidDelay: 'יש להזין עיכוב של 0 עד 1,440 דקות, במספר שלם.',
      invalidRating: 'יש לבחור דירוג של 1 עד 5.', tooLong: 'הטקסט ארוך מדי. קצרו אותו ונסו שוב.',
      request: 'בקשה לשינוי הפעילות', requestText: 'מה הייתם רוצים לשנות?',
      requestNote: 'הסוכן בלבד מעדכן את המסלול הרשמי. שליחת בקשה אינה משנה או מבטלת הזמנה.',
      sendRequest: 'שליחת בקשה לסוכן', sending: 'שולח…', requestSaved: 'הבקשה נשמרה וממתינה לטיפול הסוכן.',
      emptyRequest: 'כתבו מה הייתם רוצים לשנות.', requestHistory: 'הבקשות שלכם', reply: 'תשובת הסוכן',
      pending: 'ממתינה לטיפול', approved: 'בוצע שינוי', alternative: 'הוצעה חלופה', rejected: 'הבקשה נדחתה',
      dayTitle: 'סיכום היום', dayOpen: 'השלמת סיכום ודירוג היום', dayRating: 'איך היה היום שלכם?',
      dayComment: 'משוב כללי על היום', tomorrow: 'מה הייתם מעדיפים למחר?', saveDay: 'שליחת סיכום היום',
      daySaved: 'סיכום היום נשמר ונשלח לסוכן.', countsNote: 'הסיכום מבוסס על הדיווחים שלכם בלבד. שעה שחלפה אינה מעידה על ביצוע.',
      countDone: 'בוצעו', countSkipped: 'דולגו', countDeferred: 'נדחו', countUnreported: 'לא דווח',
      tripTitle: 'איך הייתה החופשה?', tripOpen: 'דירוג החופשה והשירות', vacationRating: 'דירוג החופשה', serviceRating: 'דירוג השירות',
      tripComment: 'מה כדאי שנדע לחופשה הבאה?', saveTrip: 'שליחת המשוב', tripSaved: 'המשוב נשמר. תודה ששיתפתם.',
      unavailable: 'הדיווח אינו זמין כרגע. נסו שוב בהמשך או פנו לסוכן.',
      conflict: 'המסלול עודכן מאז שפתחתם אותו. רעננו את הדף ובדקו את הפרטים לפני שליחה חוזרת.',
      forbidden: 'לא ניתן לשמור באמצעות הקישור הזה. פנו לסוכן לקבלת קישור תקין.',
      validation: 'בדקו את פרטי הדיווח ונסו שוב.', network: 'השמירה לא אושרה. בדקו את החיבור ונסו שוב; הטיוטה נשמרת במסך.',
      generic: 'לא התקבל אישור שמירה. הטיוטה נשארה כאן ואפשר לנסות שוב.',
      ratingLabel: number => `${number} מתוך 5`
    },
    en: {
      experience: 'Your experience', report: 'Activity report and rating', status: 'What did you actually do?',
      reportNote: 'Your report describes what you did. It does not change the official itinerary or any bookings.',
      done: 'Completed', skipped: 'Skipped', deferred: 'Deferred by us', unreported: 'Not reported',
      current: 'Saved report: ', reason: 'What was the reason?', reasonHint: 'Please explain briefly if you skipped or deferred the activity.',
      delay: 'Reported delay (minutes)', delayHint: 'Leave 0 if there was no delay.',
      activityRating: 'How was the activity? (optional)', comment: 'Anything you would like to share?',
      saveReport: 'Save report', saving: 'Saving…', saved: 'Saved and sent to your agent.',
      unsaved: 'Some changes have not been saved yet.', private: 'Your feedback is private and visible only to your agent.',
      reported: 'Saved report', chooseStatus: 'Choose what you did at the activity.',
      reasonRequired: 'Please give a brief reason for skipping or deferring.', invalidDelay: 'Enter a whole number from 0 to 1,440 minutes.',
      invalidRating: 'Choose a rating from 1 to 5.', tooLong: 'This text is too long. Please shorten it and try again.',
      request: 'Request an activity change', requestText: 'What would you like to change?',
      requestNote: 'Only your agent can update the official itinerary. Sending a request does not change or cancel a booking.',
      sendRequest: 'Send request to your agent', sending: 'Sending…', requestSaved: 'Your request was saved and is waiting for your agent.',
      emptyRequest: 'Describe what you would like to change.', requestHistory: 'Your requests', reply: 'Your agent’s response',
      pending: 'Waiting for your agent', approved: 'Change completed', alternative: 'Alternative proposed', rejected: 'Request declined',
      dayTitle: 'Daily summary', dayOpen: 'Complete your daily summary and rating', dayRating: 'How was your day?',
      dayComment: 'General feedback on the day', tomorrow: 'What would you prefer tomorrow?', saveDay: 'Send daily summary',
      daySaved: 'Your daily summary was saved and sent to your agent.', countsNote: 'This summary uses only your reports. A past activity time does not mean it was completed.',
      countDone: 'Completed', countSkipped: 'Skipped', countDeferred: 'Deferred', countUnreported: 'Not reported',
      tripTitle: 'How was your holiday?', tripOpen: 'Rate the holiday and service', vacationRating: 'Holiday rating', serviceRating: 'Service rating',
      tripComment: 'What should we know for your next trip?', saveTrip: 'Send feedback', tripSaved: 'Your feedback was saved. Thank you for sharing.',
      unavailable: 'Reporting is currently unavailable. Try again later or contact your agent.',
      conflict: 'The itinerary has changed since you opened it. Refresh the page and check the details before sending again.',
      forbidden: 'This link cannot save your report. Contact your agent for a valid link.',
      validation: 'Check the report details and try again.', network: 'Saving was not confirmed. Check your connection and try again; your draft is still here.',
      generic: 'Saving was not confirmed. Your draft is still here and you can try again.',
      ratingLabel: number => `${number} out of 5`
    }
  };

  const valueString = value => value == null ? '' : String(value);
  const validRating = (value, required = false) => (!required && value === '') || /^[1-5]$/.test(valueString(value));
  const controlId = (prefix, key) => `${prefix}-${key}`;

  function requestId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    if (!window.crypto?.getRandomValues) throw Object.assign(new Error('unavailable'), {code: 'unavailable'});
    const bytes = window.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const value = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }

  class ClientFeedback {
    constructor({service, trip, lang = 'he', root = null, onState = null}) {
      this.service = service;
      this.trip = trip;
      this.lang = lang === 'en' ? 'en' : 'he';
      this.root = root;
      this.onState = typeof onState === 'function' ? onState : null;
      this.drafts = {activities: new Map(), days: new Map(), requests: new Map(), trip: new Map()};
      this._mounts = new Map();
      this._operations = new Map();
      this._busy = new Set();
      this._prefix = `cf-${++instanceSequence}`;
      this._mountSequence = 0;
      this._destroyed = false;
      this._unsubscribe = service?.subscribe?.(() => {
        if (this._destroyed) return;
        this.refresh();
        this.onState?.(this.service.state);
      });
    }

    get available() { return !this._destroyed && this.service?.available === true; }
    get words() { return dictionaries[this.lang]; }
    get state() { return this.service?.state || {}; }

    _report(id, dayId) {
      if (!id || !dayId) return null;
      return (this.state.reports || []).find(row => row.activity_id === id && row.day_id === dayId) || null;
    }
    _day(id) { return (this.state.day_summaries || []).find(row => row.day_id === id) || null; }
    _operation(key) { return this._operations.get(key) || {phase: 'idle'}; }

    _draft(type, key, initial) {
      const map = this.drafts[type];
      if (!map.has(key)) map.set(key, {...initial, dirty: false});
      return map.get(key);
    }

    _register(type, key, host, context, builder) {
      if (!host || !this.available) return null;
      const mountKey = `${type}:${key}`;
      this._mounts.get(mountKey)?.node.remove();
      const node = document.createElement('section');
      node.className = `cf-section cf-${type}`;
      node.dataset.cfType = type;
      node.setAttribute('dir', this.lang === 'en' ? 'ltr' : 'rtl');
      node.setAttribute('lang', this.lang);
      host.append(node);
      const mount = {type, key, host, node, context, builder};
      this._mounts.set(mountKey, mount);
      builder.call(this, mount);
      return node;
    }

    _rating(name, label, value, prefix, required = false) {
      return `<fieldset class="cf-rating cf-field${name === 'rating' ? ' cf-rating-field' : ''}"><legend>${esc(label)}</legend><div class="cf-rating-options">${[1, 2, 3, 4, 5].map(number => `<label class="cf-rating-option"><input type="radio" name="${esc(name)}" value="${number}" aria-label="${esc(this.words.ratingLabel(number))}" ${valueString(value) === String(number) ? 'checked' : ''} ${required ? 'required' : ''}><span>${number}</span></label>`).join('')}</div></fieldset>`;
    }

    _field(name, label, value, prefix, options = {}) {
      const id = controlId(prefix, name);
      const extra = options.full ? ' cf-full' : '';
      const attrs = options.number ? 'type="number" min="0" max="1440" step="1" inputmode="numeric"' : '';
      return `<label class="cf-field${extra}" for="${id}"><span>${esc(label)}</span>${options.number ? `<input id="${id}" name="${name}" ${attrs} value="${esc(value)}">` : `<textarea id="${id}" name="${name}" rows="${options.rows || 2}" maxlength="${options.max || 2000}">${esc(value)}</textarea>`}${options.hint ? `<small class="cf-hint">${esc(options.hint)}</small>` : ''}</label>`;
    }

    _messages() { return '<p class="cf-error" role="alert" hidden></p><p class="cf-message" role="status" aria-live="polite" hidden></p>'; }

    _capture(form, draft) {
      form.querySelectorAll('input[name], textarea[name], select[name]').forEach(input => {
        if (input.type !== 'radio' || input.checked) draft[input.name] = input.value;
      });
    }

    _bindDraft(form, draft, callback = null) {
      const change = () => {
        this._capture(form, draft);
        draft.dirty = true;
        callback?.();
        this._updateOperation(form, form.dataset.operation, draft);
      };
      form.addEventListener('input', change);
      form.addEventListener('change', change);
    }

    _setBusy(form, busy) {
      form.querySelectorAll('button, input, textarea, select').forEach(control => { control.disabled = busy; });
      form.setAttribute('aria-busy', String(busy));
    }

    _errorText(error) {
      return this.words[error?.feedbackCode || error?.code] || this.words.generic;
    }

    _updateOperation(form, key, draft) {
      if (!form) return;
      const operation = this._operation(key);
      const error = form.querySelector('.cf-error');
      const message = form.querySelector('.cf-message');
      const button = form.querySelector('button[type=submit]');
      const busy = this._busy.has(key);
      this._setBusy(form, busy);
      if (button) button.textContent = busy ? this.words[form.dataset.pending || 'saving'] : this.words[form.dataset.submit];
      error.textContent = operation.phase === 'error' ? this._errorText(operation.error) : '';
      error.hidden = !error.textContent;
      let messageText = '';
      if (busy) messageText = this.words[form.dataset.pending || 'saving'];
      else if (operation.phase === 'error') messageText = '';
      else if (draft.dirty) messageText = this.words.unsaved;
      else if (operation.phase === 'saved') messageText = this.words[form.dataset.success || 'saved'];
      message.textContent = messageText;
      message.hidden = !messageText;
      message.classList.toggle('cf-saved', !busy && !draft.dirty && operation.phase === 'saved');
      message.classList.toggle('cf-unsaved', !busy && draft.dirty);
    }

    _localError(key, code) {
      this._operations.set(key, {phase: 'error', error: {feedbackCode: code}});
      this.refresh();
    }

    async _perform(key, action, after = null) {
      if (this._busy.has(key) || !this.available) return;
      this._busy.add(key);
      this._operations.set(key, {phase: 'saving'});
      this.refresh();
      try {
        const result = await action();
        if (!result || result.version !== 1 || !Array.isArray(result.reports) || !Array.isArray(result.requests) || !Array.isArray(result.day_summaries)) {
          throw Object.assign(new Error('Unconfirmed response'), {code: 'network'});
        }
        after?.(result);
        this._operations.set(key, {phase: 'saved'});
      } catch (error) {
        this._operations.set(key, {phase: 'error', error});
      } finally {
        this._busy.delete(key);
        if (!this._destroyed) this.refresh();
      }
    }

    mountActivity(host, activity, day) {
      const id = activity?.activity_id;
      if (!this.available || !id || !this.service.hasActivity(id)) return null;
      return this._register('activity', id, host, {activity, day}, this._buildActivity);
    }

    _buildActivity(mount) {
      const {node, key: id, context: {day}} = mount;
      const w = this.words;
      const reportIdentity = JSON.stringify([day.id, id]);
      const saved = this._report(id, day.id);
      const draft = this._draft('activities', reportIdentity, {
        status: statuses.includes(saved?.status) ? saved.status : '', reason: valueString(saved?.reason),
        delay_minutes: valueString(saved?.delay_minutes ?? 0), rating: valueString(saved?.rating), comment: valueString(saved?.comment)
      });
      const request = this._draft('requests', id, {message: '', client_request_id: '', attemptedMessage: ''});
      const prefix = `${this._prefix}-${++this._mountSequence}`;
      const reportKey = `report:${reportIdentity}`;
      const requestKey = `request:${id}`;
      node.dataset.cfActivity = id;
      node.innerHTML = `<h3>${esc(w.experience)}</h3><p class="cf-status-line">${esc(w.current)}<span class="cf-current-status cf-state-badge" data-status="unreported">${esc(w.unreported)}</span></p>
        <form class="cf-form cf-activity-form" novalidate data-operation="${esc(reportKey)}" data-submit="saveReport" data-success="saved" data-pending="saving">
          <fieldset class="cf-choice-group"><legend>${esc(w.status)}</legend><div class="cf-status-options">${statuses.map(status => `<label class="cf-status-option"><input type="radio" name="status" value="${status}" ${draft.status === status ? 'checked' : ''}><span>${esc(w[status])}</span></label>`).join('')}</div></fieldset><p class="cf-hint">${esc(w.reportNote)}</p>
          <div class="cf-reason">${this._field('reason', w.reason, draft.reason, prefix, {hint: w.reasonHint, max: 2000})}</div>
          <div class="cf-grid">${this._field('delay_minutes', w.delay, draft.delay_minutes, prefix, {number: true, full: true, hint: w.delayHint})}${this._rating('rating', w.activityRating, draft.rating, prefix)}${this._field('comment', w.comment, draft.comment, prefix, {full: true})}</div>
          ${this._messages()}<div class="cf-actions"><button class="cf-button" type="submit">${esc(w.saveReport)}</button></div>
        </form>
        <div class="cf-request-list" aria-live="polite"></div>
        <details class="cf-details cf-request-details"><summary>${esc(w.request)}</summary><p class="cf-hint">${esc(w.requestNote)}</p>
          <form class="cf-form cf-request-form" novalidate data-operation="${esc(requestKey)}" data-submit="sendRequest" data-success="requestSaved" data-pending="sending">
            ${this._field('message', w.requestText, request.message, `${prefix}-request`, {max: 4000, rows: 3})}${this._messages()}<div class="cf-actions"><button class="cf-button cf-secondary" type="submit">${esc(w.sendRequest)}</button></div>
          </form>
        </details><p class="cf-private-note">${esc(w.private)}</p>`;
      const reportForm = node.querySelector('.cf-activity-form');
      const requestForm = node.querySelector('.cf-request-form');
      const sync = () => {
        const status = draft.status;
        const reason = reportForm.querySelector('.cf-reason');
        reason.hidden = status !== 'skipped' && status !== 'deferred';
        reason.querySelector('textarea').required = !reason.hidden;
        const rating = reportForm.querySelector('.cf-rating-field');
        rating.hidden = status !== 'done';
        rating.disabled = status !== 'done' || this._busy.has(reportKey);
      };
      this._bindDraft(reportForm, draft, sync);
      this._bindDraft(requestForm, request, () => {
        if (request.attemptedMessage && request.message.trim() !== request.attemptedMessage) {
          request.client_request_id = '';
          request.attemptedMessage = '';
        }
      });
      reportForm.addEventListener('submit', event => {
        event.preventDefault();
        this._capture(reportForm, draft);
        if (!statuses.includes(draft.status)) return this._localError(reportKey, 'chooseStatus');
        if (['skipped', 'deferred'].includes(draft.status) && !draft.reason.trim()) return this._localError(reportKey, 'reasonRequired');
        if (!/^\d+$/.test(draft.delay_minutes) || Number(draft.delay_minutes) > 1440) return this._localError(reportKey, 'invalidDelay');
        if (draft.status === 'done' && !validRating(draft.rating)) return this._localError(reportKey, 'invalidRating');
        if (draft.reason.length > 2000 || draft.comment.length > 2000) return this._localError(reportKey, 'tooLong');
        const payload = {
          activity_id: id, status: draft.status, reason: ['skipped', 'deferred'].includes(draft.status) ? draft.reason.trim() : '',
          delay_minutes: Number(draft.delay_minutes), rating: draft.status === 'done' && draft.rating ? Number(draft.rating) : null,
          comment: draft.comment.trim()
        };
        this._perform(reportKey, () => this.service.saveActivity(payload), () => { draft.dirty = false; });
      });
      requestForm.addEventListener('submit', event => {
        event.preventDefault();
        this._capture(requestForm, request);
        const message = request.message.trim();
        if (!message) return this._localError(requestKey, 'emptyRequest');
        if (message.length > 4000) return this._localError(requestKey, 'tooLong');
        try { if (!request.client_request_id) request.client_request_id = requestId(); }
        catch (error) { this._operations.set(requestKey, {phase: 'error', error}); this.refresh(); return; }
        request.attemptedMessage = message;
        const payload = {activity_id: id, message, client_request_id: request.client_request_id};
        this._perform(requestKey, () => this.service.requestChange(payload), () => {
          request.message = '';
          request.client_request_id = '';
          request.attemptedMessage = '';
          request.dirty = false;
          const currentInput = this._mounts.get(`activity:${id}`)?.node.querySelector('.cf-request-form textarea[name=message]');
          if (currentInput) currentInput.value = '';
        });
      });
      mount.refresh = () => {
        const report = this._report(id, day.id);
        const savedStatus = statuses.includes(report?.status) ? report.status : 'unreported';
        const badge = node.querySelector('.cf-current-status');
        badge.textContent = this.words[savedStatus];
        badge.dataset.status = savedStatus;
        this._updateOperation(reportForm, reportKey, draft);
        this._updateOperation(requestForm, requestKey, request);
        sync();
        this._requestHistory(node.querySelector('.cf-request-list'), id);
      };
      mount.refresh();
    }

    _requestHistory(host, activityId) {
      const list = (this.state.requests || []).filter(request => request.activity_id === activityId).slice().sort((a, b) => valueString(b.created_at).localeCompare(valueString(a.created_at)));
      host.innerHTML = list.length ? `<h4>${esc(this.words.requestHistory)}</h4>${list.map(request => {
        const status = ['pending', 'approved', 'alternative', 'rejected'].includes(request.status) ? request.status : 'pending';
        return `<article class="cf-request"><span class="cf-request-status" data-status="${status}">${esc(this.words[status])}</span><p>${esc(request.request_text || '')}</p>${request.agent_reply ? `<div class="cf-agent-response"><strong>${esc(this.words.reply)}</strong><p>${esc(request.agent_reply)}</p></div>` : ''}</article>`;
      }).join('')}` : '';
    }

    mountDay(host, day) {
      if (!this.available || !day?.id || !this.service.hasDay(day.id)) return null;
      return this._register('day-summary', day.id, host, {day}, this._buildDay);
    }

    _buildDay(mount) {
      const {node, key: id, context: {day}} = mount;
      const w = this.words;
      const saved = this._day(id);
      const draft = this._draft('days', id, {rating: valueString(saved?.rating), comment: valueString(saved?.comment), tomorrow_preferences: valueString(saved?.tomorrow_preferences)});
      const key = `day:${id}`;
      const prefix = `${this._prefix}-${++this._mountSequence}`;
      node.dataset.cfDay = id;
      node.innerHTML = `<h3>${esc(w.dayTitle)}</h3><div class="cf-day-counts" aria-live="polite"></div><p class="cf-hint">${esc(w.countsNote)}</p><details class="cf-details"><summary>${esc(w.dayOpen)}</summary>
        <form class="cf-form cf-day-form" novalidate data-operation="${esc(key)}" data-submit="saveDay" data-success="daySaved" data-pending="saving">
          ${this._rating('rating', w.dayRating, draft.rating, prefix, true)}${this._field('comment', w.dayComment, draft.comment, prefix)}${this._field('tomorrow_preferences', w.tomorrow, draft.tomorrow_preferences, prefix)}${this._messages()}<div class="cf-actions"><button class="cf-button" type="submit">${esc(w.saveDay)}</button></div>
        </form></details><p class="cf-private-note">${esc(w.private)}</p><p class="cf-day-saved cf-saved" hidden></p>`;
      const form = node.querySelector('form');
      this._bindDraft(form, draft);
      form.addEventListener('submit', event => {
        event.preventDefault();
        this._capture(form, draft);
        if (!validRating(draft.rating, true)) return this._localError(key, 'invalidRating');
        if (draft.comment.length > 2000 || draft.tomorrow_preferences.length > 2000) return this._localError(key, 'tooLong');
        this._perform(key, () => this.service.saveDay({day_id: id, rating: Number(draft.rating), comment: draft.comment.trim(), tomorrow_preferences: draft.tomorrow_preferences.trim()}), () => { draft.dirty = false; });
      });
      mount.refresh = () => {
        const counts = {done: 0, skipped: 0, deferred: 0, unreported: 0};
        (day.activities || []).forEach(activity => {
          const status = this._report(activity.activity_id, day.id)?.status;
          counts[statuses.includes(status) ? status : 'unreported'] += 1;
        });
        const labels = {done: 'countDone', skipped: 'countSkipped', deferred: 'countDeferred', unreported: 'countUnreported'};
        node.querySelector('.cf-day-counts').innerHTML = Object.entries(counts).map(([status, count]) => `<div data-status="${status}"><strong>${count}</strong><span>${esc(this.words[labels[status]])}</span></div>`).join('');
        const savedLabel = node.querySelector('.cf-day-saved');
        savedLabel.textContent = this.words.daySaved;
        savedLabel.hidden = !this._day(id) || draft.dirty || this._busy.has(key);
        this._updateOperation(form, key, draft);
      };
      mount.refresh();
    }

    mountTrip(host) {
      if (!this.available) return null;
      return this._register('trip-review', 'trip', host, {}, this._buildTrip);
    }

    _buildTrip(mount) {
      const {node} = mount;
      const w = this.words;
      const saved = this.state.trip_review;
      const draft = this._draft('trip', 'trip', {vacation_rating: valueString(saved?.vacation_rating), service_rating: valueString(saved?.service_rating), comment: valueString(saved?.comment)});
      const key = 'trip:review';
      const prefix = `${this._prefix}-${++this._mountSequence}`;
      node.innerHTML = `<h3>${esc(w.tripTitle)}</h3><details class="cf-details"><summary>${esc(w.tripOpen)}</summary><form class="cf-form cf-trip-form" novalidate data-operation="${key}" data-submit="saveTrip" data-success="tripSaved" data-pending="saving">${this._rating('vacation_rating', w.vacationRating, draft.vacation_rating, prefix, true)}${this._rating('service_rating', w.serviceRating, draft.service_rating, prefix, true)}${this._field('comment', w.tripComment, draft.comment, prefix)}${this._messages()}<div class="cf-actions"><button class="cf-button" type="submit">${esc(w.saveTrip)}</button></div></form></details><p class="cf-private-note">${esc(w.private)}</p><p class="cf-trip-saved cf-saved" hidden></p>`;
      const form = node.querySelector('form');
      this._bindDraft(form, draft);
      form.addEventListener('submit', event => {
        event.preventDefault();
        this._capture(form, draft);
        if (!validRating(draft.vacation_rating, true) || !validRating(draft.service_rating, true)) return this._localError(key, 'invalidRating');
        if (draft.comment.length > 2000) return this._localError(key, 'tooLong');
        this._perform(key, () => this.service.saveTrip({vacation_rating: Number(draft.vacation_rating), service_rating: Number(draft.service_rating), comment: draft.comment.trim()}), () => { draft.dirty = false; });
      });
      mount.refresh = () => {
        const label = node.querySelector('.cf-trip-saved');
        label.textContent = this.words.tripSaved;
        label.hidden = !this.state.trip_review || draft.dirty || this._busy.has(key);
        this._updateOperation(form, key, draft);
      };
      mount.refresh();
    }

    refresh() {
      if (this._destroyed) return;
      for (const [key, mount] of this._mounts) {
        if (!mount.node.isConnected) { this._mounts.delete(key); continue; }
        if (!this.available) { mount.node.remove(); this._mounts.delete(key); continue; }
        mount.refresh?.();
      }
    }

    setLanguage(lang) {
      const next = lang === 'en' ? 'en' : 'he';
      if (next === this.lang) return;
      this.lang = next;
      for (const mount of this._mounts.values()) {
        if (!mount.node.isConnected) continue;
        const open = [...mount.node.querySelectorAll('details')].map(details => details.open);
        mount.node.setAttribute('dir', next === 'en' ? 'ltr' : 'rtl');
        mount.node.setAttribute('lang', next);
        mount.builder.call(this, mount);
        mount.node.querySelectorAll('details').forEach((details, index) => { details.open = open[index] === true; });
      }
    }

    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      if (typeof this._unsubscribe === 'function') this._unsubscribe();
      for (const mount of this._mounts.values()) mount.node.remove();
      this._mounts.clear();
    }
  }

  window.ClientFeedback = ClientFeedback;
})();
