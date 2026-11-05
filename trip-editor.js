/* Structured itinerary editor. All persistence remains in the application save flow. */
(() => {
  'use strict';

  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  let instanceCount = 0;

  class TripEditor {
    constructor(host) {
      if (!host || !window.ItineraryModel) throw new Error('לא ניתן לטעון את עורך המסלול.');
      this.host = host;
      this.model = window.ItineraryModel;
      this.prefix = `itinerary-editor-${++instanceCount}`;
      this.host.classList.add('itinerary-editor');
      this.host.addEventListener('input', event => this.updateField(event));
      this.host.addEventListener('change', event => {
        if (event.target.matches('[data-move-to]')) this.moveToDay(event.target);
      });
      this.host.addEventListener('toggle', event => {
        if (!event.target.matches('[data-activity-id]')) return;
        const id = event.target.dataset.activityId;
        if (event.target.open) this.openActivities.add(id);
        else this.openActivities.delete(id);
      }, true);
      this.host.addEventListener('click', event => this.handleAction(event));
      this.load([]);
    }

    load(value) {
      const decoded = this.model.decode(value);
      this.original = clone(value);
      this.days = clone(decoded.days);
      this.kind = decoded.kind;
      this.dirty = false;
      this.converted = false;
      this.importText = '';
      this.importPreview = null;
      this.openActivities = new Set();
      this.render();
    }

    reset() { this.load([]); }
    isDirty() { return this.dirty; }

    getValue() {
      // Editing customer metadata must never rewrite an itinerary, even a legacy value.
      if (!this.dirty) return clone(this.original);
      this.validate();
      return this.model.encode(clone(this.days));
    }

    fail(message, selector) {
      const field = selector && this.host.querySelector(selector);
      if (field) {
        const details = field.closest('details');
        if (details) details.open = true;
        field.focus();
      }
      throw new Error(message);
    }

    validate() {
      const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
      this.days.forEach((day, di) => {
        if (!String(day.label || '').trim()) {
          this.fail('יש למלא שם לכל יום במסלול.', `[data-day-index="${di}"][data-field="label"]`);
        }
        if (day.date) {
          const parsed = new Date(`${day.date}T12:00:00Z`);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day.date) {
            this.fail(`התאריך של ${day.label} אינו תקין.`, `[data-day-index="${di}"][data-field="date"]`);
          }
        }
        day.activities.forEach((activity, ai) => {
          const fieldSelector = key => `[data-day-index="${di}"][data-activity-index="${ai}"][data-field="${key}"]`;
          if (!String(activity.title || '').trim()) this.fail(`יש למלא שם לפעילות ב${day.label}.`, fieldSelector('title'));
          for (const key of ['time', 'entry_time']) {
            if (activity[key] && !timePattern.test(String(activity[key]))) {
              this.fail(`יש להזין שעה תקינה בפעילות "${activity.title}".`, fieldSelector(key));
            }
          }
          const duration = activity.duration_minutes;
          if (duration !== '' && duration != null && (!Number.isInteger(Number(duration)) || Number(duration) < 0)) {
            this.fail(`משך הפעילות "${activity.title}" צריך להיות מספר דקות שלם שאינו שלילי.`, fieldSelector('duration_minutes'));
          }
          for (const key of ['image_url', 'map_url', 'document_url']) {
            if (activity[key] && !this.model.safeUrl(activity[key])) {
              this.fail(`יש להזין קישור HTTP או HTTPS תקין בפעילות "${activity.title}".`, fieldSelector(key));
            }
          }
        });
      });
    }

    escape(value) { return this.model.escapeHtml(value); }

    button(action, text, extra = '') {
      return `<button type="button" data-action="${action}" ${extra}>${text}</button>`;
    }

    field(label, key, value, di, ai, options = {}) {
      const id = `${this.prefix}-${di}-${ai ?? 'day'}-${key}`;
      const attrs = `id="${id}" data-day-index="${di}" ${ai == null ? '' : `data-activity-index="${ai}"`} data-field="${key}"`;
      const type = options.type || 'text';
      let input;
      if (options.textarea) {
        input = `<textarea ${attrs} rows="3">${this.escape(value ?? '')}</textarea>`;
      } else if (options.select) {
        const entries = [...options.select];
        if (value && !entries.some(([key]) => key === value)) entries.push([value, value]);
        input = `<select ${attrs}>${entries.map(([key, title]) => `<option value="${this.escape(key)}" ${String(value || '') === key ? 'selected' : ''}>${this.escape(title)}</option>`).join('')}</select>`;
      } else {
        input = `<input ${attrs} type="${type}" value="${this.escape(value ?? '')}" ${options.ltr ? 'dir="ltr"' : ''} ${options.inputmode ? `inputmode="${options.inputmode}"` : ''} ${type === 'number' ? 'min="0" step="1"' : ''}>`;
      }
      return `<label class="${options.wide ? 'editor-wide' : ''}" for="${id}">${label}${input}${options.hint ? `<span class="editor-hint">${options.hint}</span>` : ''}</label>`;
    }

    activityMarkup(activity, di, ai) {
      const title = activity.title || 'פעילות חדשה';
      return `<details class="editor-activity" data-activity-panel="${di}-${ai}" data-activity-id="${this.escape(activity.activity_id)}" ${this.openActivities.has(activity.activity_id) ? 'open' : ''}>
        <summary><span class="editor-activity-number">${ai + 1}</span><span data-activity-title="${di}-${ai}">${this.escape(title)}</span><span class="editor-activity-time" dir="ltr" data-activity-time="${di}-${ai}">${this.escape(activity.time || '')}</span><span aria-hidden="true">⌄</span></summary>
        <div class="editor-activity-body">
          <div class="editor-fields">
            ${this.field('שם הפעילות', 'title', activity.title, di, ai, {wide: true})}
            ${this.field('שעה מומלצת', 'time', activity.time, di, ai, {type: 'time', ltr: true})}
            ${this.field('משך בדקות', 'duration_minutes', activity.duration_minutes, di, ai, {type: 'number', ltr: true})}
            ${this.field('תיאור', 'description', activity.description, di, ai, {textarea: true, wide: true})}
            ${this.field('כתובת', 'address', activity.address, di, ai, {wide: true})}
            ${this.field('קישור לתמונה', 'image_url', activity.image_url, di, ai, {ltr: true, inputmode: 'url', wide: true})}
            ${this.field('קישור לניווט', 'map_url', activity.map_url, di, ai, {ltr: true, inputmode: 'url', wide: true})}
            ${this.field('קישור לכרטיס או למסמך', 'document_url', activity.document_url, di, ai, {ltr: true, inputmode: 'url', wide: true})}
          </div>
          <fieldset class="editor-booking"><legend>כרטיס והזמנה</legend>
            <label class="editor-checkbox"><input type="checkbox" data-day-index="${di}" data-activity-index="${ai}" data-field="ticket_purchased" ${this.model.paid(activity.ticket_purchased) ? 'checked' : ''}> נרכש כרטיס מראש</label>
            <div class="editor-fields">
              ${this.field('שעת כניסה מחייבת', 'entry_time', activity.entry_time, di, ai, {type: 'time', ltr: true, hint: 'למלא רק כשיש שעת כניסה מחייבת.'})}
              ${this.field('סטטוס ההזמנה', 'reservation_status', activity.reservation_status, di, ai, {select: [['', 'לא צוין'], ['not_booked', 'לא הוזמן'], ['pending', 'ממתין לאישור'], ['confirmed', 'מאושר'], ['cancelled', 'בוטל']]})}
            </div>
            <p class="editor-hint">רכישת כרטיס, שעת כניסה וסטטוס ההזמנה הם פרטים נפרדים. דיווח הלקוח אינו מבטל הזמנה.</p>
          </fieldset>
          <div class="editor-activity-tools">
            <div class="editor-buttons">
              ${this.button('move-activity-up', '↑ למעלה', `data-day-index="${di}" data-activity-index="${ai}" ${ai === 0 ? 'disabled' : ''} aria-label="העבר את ${this.escape(title)} למעלה"`)}
              ${this.button('move-activity-down', '↓ למטה', `data-day-index="${di}" data-activity-index="${ai}" ${ai === this.days[di].activities.length - 1 ? 'disabled' : ''} aria-label="העבר את ${this.escape(title)} למטה"`)}
            </div>
            ${this.days.length > 1 ? `<label class="editor-move-label">העברה ליום אחר<select data-move-to data-day-index="${di}" data-activity-index="${ai}"><option value="">בחירת יום</option>${this.days.map((day, index) => index === di ? '' : `<option value="${index}">${this.escape(day.label)}</option>`).join('')}</select></label>` : ''}
            ${this.button('remove-activity', 'מחיקת פעילות', `class="editor-danger" data-day-index="${di}" data-activity-index="${ai}"`)}
          </div>
        </div>
      </details>`;
    }

    dayMarkup(day, di) {
      return `<section class="editor-day" data-day-panel="${di}" aria-label="${this.escape(day.label)}">
        <div class="editor-day-heading"><h4>${this.escape(day.label || `יום ${di + 1}`)}</h4><span>${day.activities.length} פעילויות</span></div>
        <div class="editor-fields editor-day-fields">
          ${this.field('שם היום', 'label', day.label, di)}
          ${this.field('תאריך היום', 'date', day.date, di, null, {type: 'date', ltr: true})}
        </div>
        <div class="editor-buttons editor-day-tools">
          ${this.button('move-day-up', '↑ יום קודם', `data-day-index="${di}" ${di === 0 ? 'disabled' : ''}`)}
          ${this.button('move-day-down', '↓ יום הבא', `data-day-index="${di}" ${di === this.days.length - 1 ? 'disabled' : ''}`)}
          ${this.button('remove-day', 'מחיקת יום', `class="editor-danger" data-day-index="${di}"`)}
        </div>
        ${day.activities.length ? day.activities.map((activity, ai) => this.activityMarkup(activity, di, ai)).join('') : '<p class="editor-empty">עדיין אין פעילויות ביום הזה.</p>'}
        ${this.button('add-activity', '＋ הוספת פעילות', `class="editor-add-activity" data-day-index="${di}"`)}
      </section>`;
    }

    originalMarkup() {
      const content = this.model.legacyText(this.original);
      return `<details class="editor-original"><summary>המסלול המקורי — עיון וגיבוי</summary><pre>${this.escape(content)}</pre><p class="editor-hint">ניתן להוריד את המקור לפני שמירת ההמרה. המקור מוצג כאן כל עוד החופשה פתוחה לעריכה.</p>${this.button('download-original', 'הורדת המקור כקובץ JSON')}</details>`;
    }

    importMarkup() {
      const preview = this.importPreview;
      return `<details class="editor-import" ${preview ? 'open' : ''}><summary>המרה מבוקרת למסלול מובנה</summary>
        <p>המקור אינו משתנה אוטומטית. העתיקו או סדרו את הפרטים בפורמט הבא, בדקו את התצוגה המקדימה ורק אז החילו את ההמרה.</p>
        <p class="editor-hint">כל שורה מכילה שבעה שדות מופרדים ב־|. שדות אופציונליים נשארים ריקים.</p>
        <code>יום | שעה | שם פעילות | תיאור | כרטיס | קישור לתמונה | קישור לניווט</code>
        <label for="${this.prefix}-import">טקסט להמרה<textarea id="${this.prefix}-import" data-import-text rows="6" placeholder="יום 1 | 09:00 | סיור בעיר | מפגש בכניסה | | |">${this.escape(this.importText)}</textarea></label>
        ${this.button('preview-import', 'בדיקת תצוגה מקדימה')}
        ${preview ? `<div class="editor-import-preview" role="status">${preview.errors.length ? `<p class="editor-error">לא ניתן להחיל את ההמרה:</p><ul>${preview.errors.map(error => `<li>${this.escape(error)}</li>`).join('')}</ul>` : `<h4>תצוגה מקדימה — טרם נשמרה</h4>${preview.days.map(day => `<div class="editor-preview-day"><strong>${this.escape(day.label)}</strong><ul>${day.activities.map(activity => `<li><bdi>${this.escape(activity.time || 'ללא שעה')}</bdi> · ${this.escape(activity.title)}${activity.description ? `<p>${this.escape(activity.description)}</p>` : ''}</li>`).join('')}</ul></div>`).join('')}${this.button('apply-import', 'החלת ההמרה בעורך', 'class="editor-primary"')}<p class="editor-hint">השינוי יישמר ב־Supabase רק בלחיצה על שמירת החופשה.</p>`}</div>` : ''}
      </details>`;
    }

    render(focusSelector) {
      this.host.innerHTML = `<div class="editor-header"><div><h3>ימים ופעילויות</h3><p>בונים את המסלול כאן ושומרים יחד עם פרטי החופשה.</p></div>${this.kind === 'structured' ? this.button('add-day', '＋ הוספת יום', 'class="editor-primary"') : ''}</div>
        ${this.kind === 'structured' ? `<p class="editor-hint">בתצוגת הלקוח הפעילויות ממוינות לפי השעה המומלצת. לשינוי זמן הפעילות יש לעדכן גם את השעה; סדר ידני קובע בין פעילויות באותה שעה.</p>${this.days.length ? this.days.map((day, di) => this.dayMarkup(day, di)).join('') : '<div class="editor-empty">הוסיפו יום ראשון כדי להתחיל לבנות את המסלול.</div>'}${this.converted ? `<div class="editor-notice">ההמרה הוחלה בעורך בלבד. יש לבדוק את כל הפרטים לפני שמירת החופשה.${this.button('restore-original', 'ביטול ההמרה וחזרה למקור')}</div>${this.originalMarkup()}` : ''}` : `<div class="editor-notice"><strong>המסלול נשמר בפורמט ישן או לא מוכר.</strong><p>ניתן לשמור שינויים בפרטי החופשה בלי לשנות אותו. כדי לערוך ימים ופעילויות יש לבצע המרה מבוקרת.</p></div>${this.originalMarkup()}${this.importMarkup()}`}`;
      if (focusSelector) this.host.querySelector(focusSelector)?.focus();
    }

    updateField(event) {
      const input = event.target;
      if (input.matches('[data-import-text]')) {
        this.importText = input.value;
        // A preview must correspond to the current text, never to a previous draft.
        if (this.importPreview) {
          this.importPreview = null;
          this.host.querySelector('.editor-import-preview')?.remove();
        }
        return;
      }
      if (!input.matches('[data-field]')) return;
      const di = Number(input.dataset.dayIndex);
      const ai = input.dataset.activityIndex;
      const key = input.dataset.field;
      const day = this.days[di];
      if (!day) return;
      const target = ai === undefined ? day : day.activities[Number(ai)];
      if (!target) return;
      target[key] = input.type === 'checkbox' ? input.checked : key === 'duration_minutes' && input.value !== '' ? Number(input.value) : input.value;
      this.dirty = true;
      if (ai !== undefined) {
        if (key === 'title') this.host.querySelector(`[data-activity-title="${di}-${ai}"]`).textContent = input.value || 'פעילות חדשה';
        if (key === 'time') this.host.querySelector(`[data-activity-time="${di}-${ai}"]`).textContent = input.value;
      }
      if (ai === undefined && key === 'label') this.host.querySelector(`[data-day-panel="${di}"] h4`).textContent = input.value || `יום ${di + 1}`;
    }

    moveToDay(select) {
      if (select.value === '') return;
      const di = Number(select.dataset.dayIndex);
      const ai = Number(select.dataset.activityIndex);
      const destination = Number(select.value);
      if (!this.days[destination] || destination === di) return;
      const [activity] = this.days[di].activities.splice(ai, 1);
      this.days[destination].activities.push(activity);
      this.dirty = true;
      this.render();
    }

    downloadOriginal() {
      const blob = new Blob([JSON.stringify(this.original, null, 2)], {type: 'application/json;charset=utf-8'});
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'perfect-tours-original-itinerary.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    handleAction(event) {
      const button = event.target.closest('button[data-action]');
      if (!button || !this.host.contains(button)) return;
      const action = button.dataset.action;
      const di = Number(button.dataset.dayIndex);
      const ai = Number(button.dataset.activityIndex);
      const day = this.days[di];
      if (action === 'download-original') return this.downloadOriginal();
      if (action === 'preview-import') {
        this.importPreview = this.model.previewImport(this.importText);
        this.render();
        return;
      }
      if (action === 'apply-import') {
        if (!this.importPreview || this.importPreview.errors.length || !this.importPreview.days.length) return;
        this.days = clone(this.importPreview.days);
        this.kind = 'structured';
        this.converted = true;
        this.dirty = true;
        this.render();
        return;
      }
      if (action === 'restore-original') {
        if (window.confirm('לבטל את כל השינויים במסלול ולהחזיר את המקור?')) this.load(this.original);
        return;
      }
      switch (action) {
        case 'add-day':
          this.days.push({id: this.model.createId(), label: `יום ${this.days.length + 1}`, date: '', activities: []});
          break;
        case 'remove-day':
          if (!day || (day.activities.length && !window.confirm(`למחוק את ${day.label} ואת כל הפעילויות שבו?`))) return;
          this.days.splice(di, 1);
          break;
        case 'move-day-up':
        case 'move-day-down': {
          const next = di + (action === 'move-day-up' ? -1 : 1);
          if (!day || !this.days[next]) return;
          [this.days[di], this.days[next]] = [this.days[next], this.days[di]];
          break;
        }
        case 'add-activity':
          if (!day) return;
          day.activities.push({activity_id: this.model.createId(), time: '', title: '', description: '', ticket_purchased: false});
          this.openActivities.add(day.activities[day.activities.length - 1].activity_id);
          break;
        case 'remove-activity':
          if (!day || !window.confirm(`למחוק את הפעילות "${day.activities[ai]?.title || 'ללא שם'}"?`)) return;
          day.activities.splice(ai, 1);
          break;
        case 'move-activity-up':
        case 'move-activity-down': {
          const next = ai + (action === 'move-activity-up' ? -1 : 1);
          if (!day?.activities[ai] || !day.activities[next]) return;
          [day.activities[ai], day.activities[next]] = [day.activities[next], day.activities[ai]];
          break;
        }
        default: return;
      }
      this.dirty = true;
      this.render(action === 'add-day' ? `[data-day-index="${this.days.length - 1}"][data-field="label"]` : action === 'add-activity' ? `[data-day-index="${di}"][data-activity-index="${day.activities.length - 1}"][data-field="title"]` : undefined);
    }
  }

  window.TripEditor = TripEditor;
})();
