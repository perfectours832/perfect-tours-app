/* Owner dashboard for saved customer reports and agent-controlled itinerary changes. */
(() => {
  'use strict';

  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const statuses = {done: 'בוצע', skipped: 'דולג', deferred: 'נדחה', unreported: 'לא דווח'};
  const requestStatuses = {pending: 'ממתינה לטיפול', approved: 'אושרה ובוצעה', alternative: 'הוצעה חלופה', rejected: 'נדחתה'};
  let instances = 0;

  class AgentFeedback {
    constructor({host, service, TripEditor = window.TripEditor, onTripUpdated, onEditTrip} = {}) {
      if (!host) throw new Error('לא נמצא אזור דיווחים ובקשות.');
      this.host = host;
      this.service = service;
      this.TripEditor = TripEditor;
      this.onTripUpdated = onTripUpdated;
      this.onEditTrip = onEditTrip;
      this.model = window.ItineraryModel;
      this.prefix = `agent-feedback-${++instances}`;
      this.trips = [];
      this.trip = null;
      this.feedback = null;
      this.draft = null;
      this.editor = null;
      this.generation = 0;
      this.destroyed = false;
      this.boundClick = event => this.handleClick(event);
      this.boundChange = event => this.handleChange(event);
      this.host.classList.add('agent-feedback');
      this.host.addEventListener('click', this.boundClick);
      this.host.addEventListener('change', this.boundChange);
      this.host.innerHTML = `<div class="af-heading"><div><h3>דיווחים ובקשות</h3><p>דיווחי הלקוחות נשמרים בנפרד מהמסלול הרשמי.</p></div><button type="button" data-af-action="refresh">רענון</button></div>
        <label class="af-trip-label" for="${this.prefix}-trip">בחירת חופשה<select id="${this.prefix}-trip" data-af-trip><option value="">אין חופשות להצגה</option></select></label>
        <div class="af-message" data-af-message role="status" aria-live="polite"></div>
        <div data-af-content></div><div data-af-response></div>`;
    }

    escape(value) { return this.model.escapeHtml(value); }

    async loadTrips(trips) {
      if (this.destroyed) return;
      this.trips = Array.isArray(trips) ? trips : [];
      const currentId = this.trip?.id;
      const current = this.trips.find(trip => trip.id === currentId) || this.trips[0] || null;
      this.renderTripOptions(current?.id);
      if (this.draft && currentId === current?.id) {
        this.trip = current;
        return;
      }
      if (!current) {
        this.generation += 1;
        this.trip = null;
        this.feedback = null;
        this.clearDraft();
        this.setMessage('');
        this.host.querySelector('[data-af-content]').innerHTML = '<p class="af-empty">לא נוצרו חופשות עדיין.</p>';
        return;
      }
      if (this.loadingTripId === current.id && this.loadingPromise) {
        this.trip = current;
        await this.loadingPromise;
        return;
      }
      this.loadingPromise = this.showTrip(current);
      await this.loadingPromise;
    }

    renderTripOptions(selectedId) {
      const select = this.host.querySelector('[data-af-trip]');
      select.innerHTML = this.trips.length ? this.trips.map(trip => `<option value="${this.escape(trip.id)}" ${trip.id === selectedId ? 'selected' : ''}>${this.escape(trip.client_name || 'לקוח')} · ${this.escape(trip.destination || 'ללא יעד')}</option>`).join('') : '<option value="">אין חופשות להצגה</option>';
    }

    hasDraftChanges() {
      return !!this.draft && (!!this.host.querySelector('[data-af-reply]')?.value.trim() || !!this.editor?.isDirty());
    }

    showTrip(trip) {
      if (this.destroyed || !trip || this.saving) return Promise.resolve();
      if (this.draft && this.hasDraftChanges() && !window.confirm('לעבור לחופשה אחרת? המענה והשינויים בבקשה טרם נשמרו.')) {
        this.renderTripOptions(this.trip?.id);
        return Promise.resolve();
      }
      this.loadingPromise = this.loadTripFeedback(trip);
      return this.loadingPromise;
    }

    async loadTripFeedback(trip) {
      this.clearDraft();
      this.trip = trip;
      this.feedback = null;
      this.renderTripOptions(trip.id);
      const token = ++this.generation;
      this.loadingTripId = trip.id;
      this.lastLoadSucceeded = false;
      this.setMessage('טוען דיווחים ובקשות…');
      this.host.querySelector('[data-af-content]').innerHTML = '';
      try {
        if (!this.service || typeof this.service.agent !== 'function') throw Object.assign(new Error('הדיווחים עדיין לא חוברו לשמירה'), {code: 'unavailable'});
        const feedback = await this.service.agent(trip.id);
        if (this.destroyed || token !== this.generation) return;
        this.feedback = this.normalizeFeedback(feedback);
        this.lastLoadSucceeded = true;
        this.setMessage('');
        this.renderContent();
      } catch (error) {
        if (this.destroyed || token !== this.generation) return;
        this.setMessage(error?.code === 'unavailable' ? 'הדיווחים עדיין לא חוברו לשמירה. לאחר חיבור השירות ניתן לרענן את המסך.' : error?.message || 'לא ניתן לטעון את הדיווחים כרגע.', true);
      } finally {
        if (token === this.generation) this.loadingTripId = null;
      }
    }

    normalizeFeedback(value) {
      return {
        version: value?.version || 1,
        reports: Array.isArray(value?.reports) ? value.reports : [],
        day_summaries: Array.isArray(value?.day_summaries) ? value.day_summaries : [],
        trip_review: value?.trip_review || null,
        requests: Array.isArray(value?.requests) ? value.requests : []
      };
    }

    setMessage(message, isError = false) {
      const element = this.host.querySelector('[data-af-message]');
      element.textContent = message;
      element.classList.toggle('af-error', isError);
      element.hidden = !message;
    }

    rating(value) {
      return Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 5 ? `${value} / 5` : 'לא דורג';
    }

    date(value) {
      if (!value) return '';
      const parsed = new Date(value);
      return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString('he-IL', {day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit'}) : '';
    }

    definition(label, value, className = '') {
      return `<div class="${className}"><dt>${label}</dt><dd>${this.escape(value || '—')}</dd></div>`;
    }

    renderContent() {
      if (!this.feedback || !this.trip) return;
      const decoded = this.model.decode(this.trip.itinerary);
      const currentDays = decoded.kind === 'structured' ? decoded.days : [];
      const daysById = new Map(currentDays.map(day => [day.id, day]));
      // Historical reports keep their original day even when an agent moves an
      // activity or removes a whole day from the current official itinerary.
      for (const snapshot of [...this.feedback.day_summaries, ...this.feedback.reports]) {
        if (typeof snapshot.day_id !== 'string' || !snapshot.day_id || daysById.has(snapshot.day_id)) continue;
        daysById.set(snapshot.day_id, {
          id: snapshot.day_id, label: snapshot.day_label || 'יום מהמסלול הקודם',
          date: snapshot.day_date || '', activities: [], archived: true
        });
      }
      this.days = [...daysById.values()];
      if (!this.days.some(day => day.id === this.selectedDayId)) this.selectedDayId = this.days[0]?.id || '';
      const day = this.days.find(item => item.id === this.selectedDayId);
      const dayReports = this.feedback.reports.filter(report => report.day_id === day?.id);
      const reports = new Map(dayReports.map(report => [report.activity_id, report]));
      const dayActivities = day ? this.model.orderedActivities(day.activities) : [];
      const currentActivityIds = new Set(dayActivities.map(activity => activity.activity_id));
      const archivedReports = dayReports.filter(report => !currentActivityIds.has(report.activity_id));
      const counts = {done: 0, skipped: 0, deferred: 0, unreported: 0};
      const visibleReports = [...dayActivities.map(activity => reports.get(activity.activity_id)), ...archivedReports];
      visibleReports.forEach(report => {
        const status = report?.status;
        counts[Object.hasOwn(counts, status) ? status : 'unreported'] += 1;
      });
      const summary = this.feedback.day_summaries.find(item => item.day_id === day?.id);
      const review = this.feedback.trip_review;
      const sortedRequests = [...this.feedback.requests].sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || String(b.created_at || '').localeCompare(String(a.created_at || '')));
      this.host.querySelector('[data-af-content]').innerHTML = `<div class="af-toolbar">${this.days.length ? `<label for="${this.prefix}-day">דוח לפי יום<select id="${this.prefix}-day" data-af-day>${this.days.map(item => `<option value="${this.escape(item.id)}" ${item.id === this.selectedDayId ? 'selected' : ''}>${this.escape(item.label || 'יום ללא שם')}${item.date ? ` · ${this.escape(item.date)}` : ''}${item.archived ? ' · מהמסלול הקודם' : ''}</option>`).join('')}</select></label>` : ''}<button type="button" data-af-action="edit-trip">עריכת המסלול למחר</button></div>
        <section class="af-section"><h4>דוח יומי${day ? ` · ${this.escape(day.label)}` : ''}</h4>
          ${day?.archived ? '<p class="af-note">היום הזה אינו במסלול הנוכחי. הדיווחים והסיכום שהתקבלו עבורו נשמרים לעיון.</p>' : ''}
          ${this.days.length ? `<div class="af-counts">${Object.entries(counts).map(([status, count]) => `<div><strong>${count}</strong><span>${statuses[status]}</span></div>`).join('')}</div><p class="af-note">מצב הפעילות מבוסס על דיווח הלקוח בלבד. חלוף השעה אינו מסמן פעילות כבוצעה.</p>
            <div class="af-activities">${dayActivities.length ? dayActivities.map(activity => this.activityMarkup(activity, reports.get(activity.activity_id))).join('') : !archivedReports.length ? '<p class="af-empty">אין פעילויות או דיווחים ביום הזה.</p>' : ''}</div>` : '<p class="af-empty">אין ימים או דיווחי פעילות להצגה עדיין.</p>'}
          ${archivedReports.length ? `<details class="af-archived" open><summary>דיווחים על פעילויות שכבר אינן מתוכננות ביום הזה (${archivedReports.length})</summary>${archivedReports.map(report => this.activityMarkup({activity_id: report.activity_id, title: report.activity_title || 'פעילות קודמת', time: report.activity_time || ''}, report)).join('')}</details>` : ''}
          ${decoded.kind !== 'structured' ? '<p class="af-note">המסלול הנוכחי אינו מובנה. ניתן לעיין בדיווחים ובמשוב שנשמרו, ולערוך את המסלול לאחר המרה מבוקרת בעורך.</p>' : ''}
        </section>
        <section class="af-section"><h4>סיכום היום והעדפות למחר</h4>${summary ? `<dl class="af-details">${this.definition('דירוג היום', this.rating(summary.rating))}${this.definition('משוב כללי', summary.comment, 'af-wide')}${this.definition('העדפות למחר', summary.tomorrow_preferences, 'af-wide')}</dl>` : '<p class="af-empty">הלקוח עדיין לא שלח סיכום ליום הזה.</p>'}</section>
        <section class="af-section"><h4>דירוג החופשה והשירות</h4>${review ? `<dl class="af-details">${this.definition('דירוג החופשה', this.rating(review.vacation_rating))}${this.definition('דירוג השירות', this.rating(review.service_rating))}${this.definition('משוב', review.comment, 'af-wide')}</dl>` : '<p class="af-empty">עדיין לא נשלח משוב על החופשה.</p>'}</section>
        <section class="af-section"><div class="af-section-heading"><h4>בקשות לשינוי המסלול</h4><span>${this.feedback.requests.filter(request => request.status === 'pending').length} ממתינות לטיפול</span></div>
          <p class="af-note">אישור בקשה מתבצע יחד עם שמירת שינוי במסלול. הצעת חלופה או דחייה אינן משנות הזמנות.</p>
          ${sortedRequests.length ? sortedRequests.map(request => this.requestMarkup(request)).join('') : '<p class="af-empty">אין בקשות לשינוי המסלול.</p>'}
        </section>`;
    }

    activityMarkup(activity, report) {
      const status = report && Object.hasOwn(statuses, report.status) ? report.status : 'unreported';
      return `<article class="af-activity" data-af-activity="${this.escape(activity.activity_id)}"><header><bdi class="af-time">${this.escape(activity.time || '—')}</bdi><strong>${this.escape(activity.title || 'פעילות ללא שם')}</strong><span class="af-status af-status-${status}">${statuses[status]}</span></header>
        ${report ? `<dl class="af-details">${this.definition('דירוג הפעילות', this.rating(report.rating))}${this.definition('עיכוב שדווח', report.delay_minutes != null ? `${report.delay_minutes} דקות` : 'לא דווח')}${report.reason ? this.definition(status === 'skipped' ? 'סיבת הדילוג' : 'סיבה', report.reason, 'af-wide') : ''}${report.comment ? this.definition('משוב', report.comment, 'af-wide') : ''}</dl>` : '<p class="af-note">לא התקבל דיווח על פעילות זו.</p>'}</article>`;
    }

    requestMarkup(request) {
      const activity = this.days.flatMap(day => day.activities).find(item => item.activity_id === request.activity_id);
      const day = this.days.find(item => item.id === request.day_id);
      const status = Object.hasOwn(requestStatuses, request.status) ? request.status : 'pending';
      return `<article class="af-request" data-af-request="${this.escape(request.id)}"><header><strong>${this.escape(request.activity_title || activity?.title || 'פעילות קודמת')}</strong><span class="af-request-status af-request-${status}">${requestStatuses[status]}</span></header><p class="af-note">${this.escape(request.day_label || day?.label || '')}${request.created_at ? ` · ${this.escape(this.date(request.created_at))}` : ''}</p><p class="af-request-text">${this.escape(request.request_text || '')}</p>
        ${request.agent_reply ? `<div class="af-saved-reply"><strong>מענה הסוכן</strong><p>${this.escape(request.agent_reply)}</p></div>` : ''}
        ${status === 'pending' ? `<div class="af-request-actions"><button type="button" data-af-action="respond-alternative" data-request-id="${this.escape(request.id)}">הצעת חלופה</button><button type="button" data-af-action="respond-rejected" data-request-id="${this.escape(request.id)}">דחייה עם הסבר</button><button type="button" class="af-primary" data-af-action="respond-approved" data-request-id="${this.escape(request.id)}">עריכת המסלול וביצוע השינוי</button></div>` : ''}</article>`;
    }

    startResponse(requestId, mode) {
      if (this.saving) return;
      const request = this.feedback?.requests.find(item => item.id === requestId && item.status === 'pending');
      if (!request || !this.trip) return;
      if (this.draft && this.hasDraftChanges() && !window.confirm('לפתוח מענה חדש? הטיוטה הנוכחית טרם נשמרה.')) return;
      this.draft = {requestId, mode, expectedUpdatedAt: this.trip.updated_at, originalItinerary: clone(this.trip.itinerary)};
      this.editor = null;
      const response = this.host.querySelector('[data-af-response]');
      const labels = {alternative: 'הצעת חלופה', rejected: 'דחיית הבקשה', approved: 'עריכת המסלול ואישור הבקשה'};
      response.innerHTML = `<section class="af-response"><div class="af-section-heading"><h4 data-af-response-mode>${labels[mode]}</h4><button type="button" data-af-action="cancel-response">ביטול המענה</button></div><p class="af-request-text">${this.escape(request.request_text || '')}</p>
        <fieldset data-af-response-fields><legend class="af-sr-only">${labels[mode]}</legend><label for="${this.prefix}-reply">${mode === 'alternative' ? 'החלופה המוצעת ללקוח' : mode === 'rejected' ? 'הסבר ללקוח' : 'הסבר על השינוי שבוצע'}<textarea id="${this.prefix}-reply" data-af-reply rows="3" maxlength="4000"></textarea></label>
        ${mode === 'approved' ? '<p class="af-note">ערכו את המסלול ובדקו את הפרטים. הבקשה תאושר רק כאשר השינוי במסלול נשמר בהצלחה.</p><div data-af-approval-editor></div>' : ''}
        <button type="button" class="af-primary" data-af-action="submit-response">${mode === 'approved' ? 'שמירת המסלול ואישור הבקשה' : mode === 'alternative' ? 'שליחת החלופה' : 'דחיית הבקשה ושליחת ההסבר'}</button></fieldset>
        <p data-af-response-message role="status" aria-live="polite"></p></section>`;
      if (mode === 'approved') {
        if (typeof this.TripEditor !== 'function') {
          this.setResponseMessage('לא ניתן לטעון את עורך המסלול. יש לרענן את הדף.', true);
          response.querySelector('[data-af-action="submit-response"]').disabled = true;
        } else {
          this.editor = new this.TripEditor(response.querySelector('[data-af-approval-editor]'));
          this.editor.load(this.draft.originalItinerary);
        }
      }
      response.scrollIntoView({block: 'start', behavior: 'smooth'});
      response.querySelector('[data-af-reply]')?.focus({preventScroll: true});
    }

    setResponseMessage(message, isError = false) {
      const element = this.host.querySelector('[data-af-response-message]');
      if (!element) return;
      element.textContent = message;
      element.classList.toggle('af-error', isError);
    }

    async submitResponse() {
      if (!this.draft || this.saving) return;
      const draft = this.draft;
      const reply = this.host.querySelector('[data-af-reply]').value.trim();
      if (!reply) {
        this.setResponseMessage('יש לכתוב מענה ללקוח לפני השליחה.', true);
        this.host.querySelector('[data-af-reply]').focus();
        return;
      }
      let itinerary;
      try {
        if (draft.mode === 'approved') {
          if (!this.editor || !this.editor.isDirty()) throw new Error('יש לערוך את המסלול לפני אישור הבקשה.');
          itinerary = this.editor.getValue();
          if (JSON.stringify(itinerary) === JSON.stringify(draft.originalItinerary)) throw new Error('לא נמצא שינוי במסלול. יש לבצע את השינוי לפני אישור הבקשה.');
          if (!draft.expectedUpdatedAt) throw new Error('חסרה גרסת המסלול לשמירה בטוחה. יש לרענן את החופשה.');
        }
      } catch (error) {
        this.setResponseMessage(error.message, true);
        return;
      }
      const fields = this.host.querySelector('[data-af-response-fields]');
      this.saving = true;
      fields.disabled = true;
      this.host.querySelector('[data-af-trip]').disabled = true;
      this.setResponseMessage('שומר את המענה…');
      let result;
      try {
        if (!this.service || typeof this.service.resolveRequest !== 'function') throw Object.assign(new Error('הדיווחים עדיין לא חוברו לשמירה.'), {code: 'unavailable'});
        result = await this.service.resolveRequest({request_id: draft.requestId, status: draft.mode, reply, ...(draft.mode === 'approved' ? {itinerary, expected_updated_at: draft.expectedUpdatedAt} : {})});
      } catch (error) {
        if (this.destroyed) return;
        this.setResponseMessage(error?.code === 'conflict' ? 'המסלול או הבקשה השתנו מאז פתיחת המענה. הטיוטה נשמרת כאן; יש לבדוק את הגרסה העדכנית לפני ניסיון נוסף.' : error?.message || 'המענה לא נשמר. אפשר לנסות שוב.', true);
        return;
      } finally {
        this.saving = false;
        if (!this.destroyed) {
          fields.disabled = false;
          this.host.querySelector('[data-af-trip]').disabled = false;
        }
      }
      if (this.destroyed) return;
      const tripId = this.trip.id;
      if (result?.reports) this.feedback = this.normalizeFeedback(result);
      if (draft.mode === 'approved') {
        this.trip = {...this.trip, itinerary: clone(itinerary), updated_at: result?.trip_updated_at || this.trip.updated_at};
        this.trips = this.trips.map(trip => trip.id === tripId ? this.trip : trip);
      }
      this.clearDraft();
      let refreshFailed = false;
      const refreshGeneration = this.generation;
      if (typeof this.onTripUpdated === 'function') {
        try {
          const trips = await this.onTripUpdated();
          if (Array.isArray(trips)) {
            this.trips = trips;
            this.trip = trips.find(trip => trip.id === tripId) || this.trip;
            this.renderTripOptions(this.trip.id);
          }
        } catch (_) { refreshFailed = true; }
      }
      if (this.destroyed) return;
      if (this.generation === refreshGeneration) await this.showTrip(this.trip);
      else if (this.loadingPromise) await this.loadingPromise;
      if (this.destroyed) return;
      if (!this.lastLoadSucceeded) refreshFailed = true;
      this.setMessage(refreshFailed ? 'המענה נשמר, אך לא ניתן לרענן את כל הדיווחים והחופשות כרגע. ניתן לרענן שוב.' : 'המענה נשמר בהצלחה.', refreshFailed);
    }

    clearDraft() {
      this.draft = null;
      this.editor = null;
      this.host.querySelector('[data-af-response]').innerHTML = '';
    }

    async handleChange(event) {
      if (event.target.matches('[data-af-trip]')) {
        const trip = this.trips.find(item => item.id === event.target.value);
        if (trip) await this.showTrip(trip);
      } else if (event.target.matches('[data-af-day]')) {
        this.selectedDayId = event.target.value;
        this.renderContent();
      }
    }

    async handleClick(event) {
      const button = event.target.closest('button[data-af-action]');
      if (!button || !this.host.contains(button) || this.saving) return;
      const action = button.dataset.afAction;
      if (action === 'refresh' && this.trip) await this.showTrip(this.trip);
      else if (action === 'edit-trip' && this.trip && typeof this.onEditTrip === 'function') this.onEditTrip(this.trip.id);
      else if (action.startsWith('respond-')) this.startResponse(button.dataset.requestId, action.slice('respond-'.length));
      else if (action === 'cancel-response') {
        if (!this.hasDraftChanges() || window.confirm('לבטל את המענה? הטיוטה טרם נשמרה.')) this.clearDraft();
      } else if (action === 'submit-response') await this.submitResponse();
    }

    destroy() {
      this.destroyed = true;
      this.generation += 1;
      this.host.removeEventListener('click', this.boundClick);
      this.host.removeEventListener('change', this.boundChange);
      this.host.innerHTML = '';
      this.draft = null;
      this.editor = null;
    }
  }

  window.AgentFeedback = AgentFeedback;
})();
