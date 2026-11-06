/* Perfect Tours client presentation. Rendering never writes trip data. */
(() => {
  'use strict';

  const M = window.ItineraryModel;
  const esc = value => M.escapeHtml(value);
  const text = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value ?? '';
  };
  const words = lang => lang === 'en' ? {
    itinerary: 'Your itinerary', days: 'Trip days', day: 'Day', activities: 'activities',
    empty: 'Your itinerary will be added here.', emptyDay: 'A day to enjoy at your own pace. No activities have been added yet.',
    legacy: 'Your itinerary', legacyNote: 'The original itinerary, as prepared by your agent.',
    legacyUnavailable: 'Your itinerary will be added here. Contact your agent for details.',
    booked: 'Ticket purchased', recommended: 'Suggested time', entry: 'Required entry time', duration: 'Duration',
    minutes: 'minutes', address: 'Address', reservation: 'Booking status', directions: 'Directions', ticket: 'Ticket / document',
    contact: 'Contact your agent on WhatsApp', skip: 'A ticket has been purchased. You can choose to skip this activity. You may lose the cost of the ticket. Skipping does not cancel the booking and does not automatically entitle you to a refund.',
    late: 'Entry is scheduled for a fixed time. Arriving late may affect admission.',
    noDocs: 'Your travel documents will appear here.', invalidDoc: 'Link unavailable — contact your agent',
    unknown: 'To be arranged', none: 'No booking', pending: 'Pending', confirmed: 'Confirmed', cancelled: 'Cancelled',
    planned: 'Planned', not_booked: 'Not booked', requested: 'Requested',
    count: count => `${count} activities`, greeting: names => `${names}’s personal getaway`,
    help: 'Hello, I need help with my trip', activityHelp: (title, day, time) => `Hello, I would like to discuss ${title} (${day}${time ? `, ${time}` : ''}).`,
    durationValue: value => `${value} minutes`
  } : {
    itinerary: 'המסלול שלכם', days: 'ימי החופשה', day: 'יום', activities: 'פעילויות',
    empty: 'המסלול שלכם יופיע כאן בהמשך.', emptyDay: 'יום בקצב שלכם. עדיין לא נוספו פעילויות.',
    legacy: 'המסלול שלכם', legacyNote: 'המסלול המקורי, כפי שהוכן על ידי הסוכן שלכם.',
    legacyUnavailable: 'המסלול יתווסף בהמשך; ניתן לפנות לסוכן לפרטים.',
    booked: 'כרטיס נרכש', recommended: 'שעה מומלצת', entry: 'שעת כניסה מחייבת', duration: 'משך הפעילות',
    minutes: 'דקות', address: 'כתובת', reservation: 'סטטוס הזמנה', directions: 'ניווט למקום', ticket: 'כרטיס / מסמך',
    contact: 'פנייה לסוכן ב־WhatsApp', skip: 'לפעילות נרכש כרטיס מראש. אפשר לבחור לדלג עליה, וייתכן אובדן של עלות הכרטיס. דילוג אינו מבטל את ההזמנה ואינו מקנה החזר אוטומטי.',
    late: 'לפעילות נקבעה שעת כניסה מחייבת. איחור עלול לפגוע באפשרות הכניסה.',
    noDocs: 'מסמכי הנסיעה שלכם יופיעו כאן.', invalidDoc: 'הקישור אינו זמין — פנו לסוכן',
    unknown: 'טרם נקבע', none: 'ללא הזמנה', pending: 'ממתינה לאישור', confirmed: 'מאושרת', cancelled: 'מבוטלת',
    planned: 'מתוכננת', not_booked: 'לא הוזמן', requested: 'התבקשה הזמנה',
    count: count => `${count} פעילויות`, greeting: names => `החופשה האישית של ${names}`,
    help: 'שלום, אשמח לעזרה בקשר לחופשה שלי', activityHelp: (title, day, time) => `שלום, אשמח לשוחח על הפעילות ${title} (${day}${time ? `, ${time}` : ''}).`,
    durationValue: value => `${value} דקות`
  };

  function dateFormat(value, lang, short = false) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return '';
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.valueOf())) return '';
    return date.toLocaleDateString(lang === 'en' ? 'en-GB' : 'he-IL', {
      day: 'numeric', month: short ? 'short' : 'long', ...(short ? {} : {year: 'numeric'})
    });
  }

  function setLink(id, url, direct = false) {
    const element = document.getElementById(id);
    if (!element) return;
    const safe = direct ? url : M.safeUrl(url);
    element.hidden = !safe;
    if (safe) {
      element.href = safe;
      element.rel = 'noopener noreferrer';
      element.referrerPolicy = 'no-referrer';
    } else {
      element.removeAttribute('href');
    }
  }

  function externalLink(url, label, className = '') {
    const safe = M.safeUrl(url);
    return safe ? `<a class="${className}" href="${esc(safe)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${esc(label)}<svg class="pt-link-arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 12 12 4M4.5 4H12v7.5"/></svg></a>` : '';
  }

  function renderActivity(activity, day, index, lang, phone) {
    const w = words(lang);
    const ticket = M.paid(activity.ticket_purchased);
    const photo = M.safeUrl(activity.image_url);
    const fields = [
      activity.time && [w.recommended, activity.time, 'pt-clock'],
      activity.entry_time && [w.entry, activity.entry_time, 'pt-fixed-entry'],
      activity.duration_minutes !== '' && Number(activity.duration_minutes) > 0 && [w.duration, w.durationValue(activity.duration_minutes), ''],
      activity.address && [w.address, activity.address, 'pt-address'],
      activity.reservation_status && [w.reservation, w[activity.reservation_status] || activity.reservation_status, '']
    ].filter(Boolean);
    const message = w.activityHelp(activity.title, day.label, activity.time);
    const whatsapp = phone ? externalLink(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, w.contact, 'pt-contact') : '';
    return `<details class="pt-activity" data-activity-id="${esc(activity.activity_id || `activity-${index}`)}">
      <summary>
        <span class="pt-time" dir="ltr">${esc(activity.time || '—')}</span>
        <span class="pt-title">${esc(activity.title)}</span>
        ${ticket ? `<span class="pt-ticket" aria-label="${esc(w.booked)}" title="${esc(w.booked)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v5a2 2 0 0 0 0 4v5H4v-5a2 2 0 0 0 0-4V5Zm11 1v3m0 2v2m0 2v3"/></svg><span>${esc(w.booked)}</span></span>` : ''}
        <span class="pt-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="pt-activity-body">
        ${photo ? `<img class="pt-activity-photo" src="${esc(photo)}" alt="${esc(activity.title)}" loading="lazy" referrerpolicy="no-referrer">` : ''}
        ${activity.description ? `<p class="pt-description">${esc(activity.description)}</p>` : ''}
        ${fields.length ? `<dl class="pt-facts">${fields.map(([label, value, cls]) => `<div class="${cls}"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>` : ''}
        ${activity.entry_time ? `<p class="pt-entry-note"><span aria-hidden="true">◷</span>${esc(w.late)}</p>` : ''}
        ${ticket ? `<p class="pt-ticket-note">${esc(w.skip)}</p>` : ''}
        <div class="pt-activity-actions">${externalLink(activity.map_url, w.directions, 'pt-map')}${externalLink(activity.document_url, w.ticket, 'pt-document')}${whatsapp}</div>
      </div>
    </details>`;
  }

  // Client presentation projects only itinerary text. Unknown metadata remains
  // intact in the model/editor and is never rendered as technical JSON here.
  function clientLegacyText(input) {
    if (typeof input === 'string') return input;
    if (!Array.isArray(input)) return '';
    return input.map(row => {
      if (typeof row === 'string') return row;
      if (!row || typeof row !== 'object' || Array.isArray(row)) return '';
      return ['day', 'time', 'title', 'description']
        .filter(key => Object.prototype.hasOwnProperty.call(row, key) && typeof row[key] === 'string' && row[key].trim())
        .map(key => row[key]).join(' | ');
    }).filter(value => value.trim()).join('\n');
  }

  function renderTimeline(host, input, lang = 'he', options = {}) {
    if (!host) return;
    const w = words(lang);
    const decoded = M.decode(input);
    if (decoded.kind !== 'structured') {
      const originalText = clientLegacyText(input);
      host.innerHTML = originalText.trim()
        ? `<div class="pt-legacy"><p class="pt-legacy-note">${esc(w.legacyNote)}</p><div class="pt-legacy-text">${esc(originalText)}</div></div>`
        : `<p class="pt-empty">${esc(w.legacyUnavailable)}</p>`;
      return;
    }
    const days = decoded.days;
    if (!days.length) {
      host.innerHTML = `<p class="pt-empty">${esc(w.empty)}</p>`;
      return;
    }
    const savedDay = host.dataset.selectedDay;
    let activeIndex = Math.max(0, days.findIndex(day => day.id === savedDay));
    host.innerHTML = `<nav class="pt-day-nav" aria-label="${esc(w.days)}">${days.map((day, index) => `<button type="button" class="pt-day-button" data-day-index="${index}" aria-pressed="${index === activeIndex}"><span>${esc(day.label || `${w.day} ${index + 1}`)}</span>${day.date ? `<small>${esc(dateFormat(day.date, lang, true))}</small>` : ''}</button>`).join('')}</nav><div class="pt-day-content" aria-live="polite"></div>`;
    const content = host.querySelector('.pt-day-content');
    const show = index => {
      activeIndex = index;
      const day = days[activeIndex];
      host.dataset.selectedDay = day.id;
      host.querySelectorAll('.pt-day-button').forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
      const activities = M.orderedActivities(day.activities);
      content.innerHTML = `<div class="pt-day-heading"><h3>${esc(day.label || `${w.day} ${index + 1}`)}</h3><span>${esc(w.count(activities.length))}</span></div>${activities.length ? activities.map((activity, i) => renderActivity(activity, day, i, lang, options.phone)).join('') : `<p class="pt-empty">${esc(w.emptyDay)}</p>`}`;
      content.querySelectorAll('img').forEach(image => image.addEventListener('error', () => { image.hidden = true; }, {once: true}));
      if (options.feedback) {
        content.querySelectorAll('.pt-activity-body').forEach((host, i) => options.feedback.mountActivity(host, activities[i], day));
        options.feedback.mountDay(content, day);
      }
    };
    host.querySelectorAll('.pt-day-button').forEach(button => button.addEventListener('click', () => show(Number(button.dataset.dayIndex))));
    show(activeIndex);
  }

  function renderDocuments(host, documents, lang) {
    if (!host) return;
    const w = words(lang);
    if (typeof documents === 'string') {
      host.innerHTML = `<p class="pt-legacy-text">${esc(documents)}</p>`;
      return;
    }
    const list = Array.isArray(documents) ? documents : [];
    host.innerHTML = list.length ? list.map(doc => {
      if (!doc || typeof doc !== 'object') return `<p class="pt-document-unavailable">${esc(String(doc ?? ''))}</p>`;
      return externalLink(doc.url, doc.name || w.ticket, 'doc') || `<div class="pt-document-unavailable"><strong>${esc(doc.name || w.ticket)}</strong><small>${esc(w.invalidDoc)}</small></div>`;
    }).join('') : `<p class="pt-empty">${esc(w.noDocs)}</p>`;
  }

  function render(trip, settings = {}, lang = 'he', options = {}) {
    const w = words(lang);
    const page = document.getElementById('clientPage');
    if (!page) return;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl';
    page.querySelectorAll('[data-he][data-en]').forEach(element => { element.textContent = element.dataset[lang === 'en' ? 'en' : 'he']; });
    const names = [trip.client_name, trip.partner_name].filter(Boolean).join(lang === 'en' ? ' & ' : ' ו');
    text('clientBusinessName', settings.business_name || 'Perfect Tours');
    const logo = document.getElementById('clientLogo');
    if (logo) {
      const data = typeof settings.logo_data === 'string' ? settings.logo_data : '';
      const logoUrl = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(data)
        ? data : M.safeUrl(data);
      logo.hidden = !logoUrl;
      logo.classList.toggle('hidden', !logoUrl);
      logo.referrerPolicy = 'no-referrer';
      if (logoUrl) {
        logo.src = logoUrl;
        logo.onerror = () => { logo.hidden = true; };
      } else logo.removeAttribute('src');
    }
    text('heroTitle', trip.destination || (lang === 'en' ? 'Your getaway' : 'החופשה שלכם'));
    text('heroGreeting', names ? w.greeting(names) : '');
    text('heroDates', [dateFormat(trip.start_date, lang), dateFormat(trip.end_date, lang)].filter(Boolean).join(' — '));
    text('langBtn', lang === 'en' ? 'עברית' : 'English');
    text('welcome', trip.welcome_message || settings.default_welcome || '');
    const welcome = document.getElementById('welcome');
    if (welcome) welcome.closest('section').hidden = !welcome.textContent;
    for (const [id, value] of [['booking', trip.booking_number], ['hotel', trip.hotel_name], ['outbound', trip.outbound_flight], ['returnFlightView', trip.return_flight]]) text(id, value || '—');
    text('hotelText', trip.hotel_name || '');
    setLink('hotelLink', trip.hotel_map);
    setLink('mapQuick', trip.hotel_map);
    const hotelSection = document.getElementById('hotelSection');
    if (hotelSection) hotelSection.hidden = !trip.hotel_name && !M.safeUrl(trip.hotel_map);
    const phone = String(settings.whatsapp_phone || settings.contact_phone || '').replace(/\D/g, '');
    const callPhone = String(settings.contact_phone || '').replace(/\D/g, '');
    const whatsapp = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(w.help)}` : '';
    setLink('waQuick', whatsapp);
    setLink('contactWa', whatsapp);
    setLink('callBtn', callPhone ? `tel:${callPhone}` : '', true);
    renderTimeline(document.getElementById('timeline'), trip.itinerary, lang, {phone, feedback: options.feedback});
    renderDocuments(document.getElementById('docs'), trip.documents, lang);
    const tripFeedback = document.getElementById('tripFeedback');
    if (tripFeedback) {
      tripFeedback.replaceChildren();
      options.feedback?.mountTrip(tripFeedback);
    }

    const hero = page.querySelector('.hero');
    if (hero) {
      let image = hero.querySelector('.hero-photo');
      const decoded = M.decode(trip.itinerary);
      const photo = decoded.kind === 'structured' ? decoded.days.flatMap(day => day.activities).map(activity => M.safeUrl(activity.image_url)).find(Boolean) : '';
      if (photo) {
        if (!image) {
          image = document.createElement('img');
          image.className = 'hero-photo';
          image.alt = '';
          image.referrerPolicy = 'no-referrer';
          hero.prepend(image);
        }
        image.hidden = false;
        image.src = photo;
        image.onerror = () => { image.hidden = true; hero.classList.remove('has-photo'); };
        hero.classList.add('has-photo');
      } else {
        image?.remove();
        hero.classList.remove('has-photo');
      }
    }
  }

  window.ClientView = Object.freeze({render, renderTimeline});
})();
