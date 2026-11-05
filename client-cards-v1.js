
/* Perfect Tours — Client activity cards */
(() => {
  'use strict';

  const oldRender = window.renderClient;
  if (typeof oldRender !== 'function') return;

  const esc = s => String(s ?? '').replace(
    /[&<>"']/g,
    c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;',
      '"':'&quot;', "'":'&#39;'
    }[c])
  );

  const safeUrl = s => {
    try {
      const u = new URL(String(s));
      return ['https:', 'http:'].includes(u.protocol)
        ? u.href : '';
    } catch { return ''; }
  };

  const paid = s => s === true ||
    /^(כן|כרטיס|נרכש|true|yes|paid|1)$/i
      .test(String(s ?? '').trim());

  const oldParse = window.parseLines;
  const oldStringify = window.stringify;

  if (typeof oldParse === 'function' &&
      typeof oldStringify === 'function') {

    window.parseLines = (text, type) => {
      const rows = oldParse(text, type);
      if (type === 'docs') return rows;

      const lines = String(text ?? '')
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean);

      return rows.map((r, i) => {
        const c = lines[i].split('|')
          .map(s => s.trim());

        r.ticket_purchased = paid(c[4]);
        r.image_url = safeUrl(c[5]);
        r.map_url = safeUrl(c[6]);
        return r;
      });
    };

    window.stringify = (items, type) => {
      if (type === 'docs')
        return oldStringify(items, type);

      return (items ?? []).map(r => {
        const a = [
          r.day ?? '',
          r.time ?? '',
          r.title ?? '',
          r.description ?? ''
        ];

        if (r.ticket_purchased ||
            r.image_url || r.map_url) {
          a.push(
            r.ticket_purchased ? 'כרטיס' : '',
            r.image_url ?? '',
            r.map_url ?? ''
          );

          while (a.length > 5 && !a[a.length - 1])
            a.pop();
        }

        return a.join(' | ');
      }).join('\n');
    };
  }

  const style = document.createElement('style');

  style.textContent = `
    #timeline .pt-day {
      margin:20px 0 8px;
      font-size:17px;
      font-weight:800;
      color:#0b4268;
    }
    #timeline .pt-card {
      background:white;
      border:1px solid #e8e2d8;
      border-radius:16px;
      margin:9px 0;
      overflow:hidden;
    }
    #timeline .pt-card[open] {
      border-color:#d9c7a8;
      box-shadow:0 8px 22px #00000012;
    }
    #timeline .pt-card summary {
      list-style:none;
      display:flex;
      align-items:center;
      gap:12px;
      min-height:64px;
      padding:14px;
      cursor:pointer;
    }
    #timeline .pt-card summary::-webkit-details-marker {
      display:none;
    }
    #timeline .pt-hour {
      min-width:52px;
      font-weight:bold;
      color:#75684d;
      white-space:nowrap;
    }
    #timeline .pt-name {
      flex:1;
      font-weight:800;
      color:#26323a;
    }
    #timeline .pt-ticket {
      display:block;
      font-size:12px;
      color:#955b29;
      margin-top:5px;
    }
    #timeline .pt-more {
      font-size:19px;
      color:#937b55;
    }
    #timeline .pt-details {
      border-top:1px solid #efe9dd;
      padding:14px;
      color:#43525b;
    }
    #timeline .pt-photo {
      display:block;
      width:100%;
      max-height:250px;
      object-fit:cover;
      border-radius:11px;
      margin-bottom:12px;
    }
    #timeline .pt-desc {
      white-space:pre-wrap;
      line-height:1.65;
    }
    #timeline .pt-alert {
      background:#fff7e9;
      border-radius:10px;
      padding:10px;
      color:#77512d;
      font-size:13px;
    }
    #timeline .pt-actions {
      display:flex;
      gap:8px;
      flex-wrap:wrap;
      margin-top:12px;
    }
    #timeline .pt-actions a {
      padding:10px 12px;
      border:1px solid #ddd1bd;
      border-radius:10px;
      color:#59482d;
      text-decoration:none;
      font-weight:700;
      font-size:13px;
    }
  `;

  document.head.appendChild(style);

  function draw() {
    const timeline = document.getElementById('timeline');
    const trip = window.clientTrip;
    if (!timeline || !trip) return;

    const he = document.documentElement.lang !== 'en';
    const rows = Array.isArray(trip.itinerary)
      ? trip.itinerary : [];

    const open = new Set(
      [...timeline.querySelectorAll('details[open][data-i]')]
        .map(e => e.dataset.i)
    );

    const whatsapp = (
      document.getElementById('waQuick')?.href || ''
    ).match(/^https:\/\/wa\.me\/(\d+)/)?.[1];

    let day = null;
    let html = '';

    rows.forEach((r, i) => {
      const d = String(r.day ?? '');

      if (d && d !== day && r.title) {
        html += `<h3 class="pt-day">${esc(d)}</h3>`;
        day = d;
      }

      const title = String(r.title || r.day || '');
      const ticket = paid(r.ticket_purchased);
      const photo = safeUrl(r.image_url);
      const map = safeUrl(r.map_url);

      const msg = he
        ? `שלום, נשמח לבקש שינוי בפעילות ${title} (${d}, ${r.time ?? ''})`
        : `Hello, we'd like to change ${title} (${d}, ${r.time ?? ''})`;

      const contact = whatsapp
        ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(msg)}`
        : '';

      html += `
        <details class="pt-card" data-i="${i}"
          ${open.has(String(i)) ? 'open' : ''}>
          <summary>
            <span class="pt-hour">${esc(r.time)}</span>
            <span class="pt-name">
              ${esc(title)}
              ${ticket ? `
                <span class="pt-ticket">
                  🎟 ${he
                    ? 'כרטיס נרכש · שעת כניסה חשובה'
                    : 'Ticket booked · Check entry time'}
                </span>` : ''}
            </span>
            <span class="pt-more">⌄</span>
          </summary>

          <div class="pt-details">
            ${photo ? `
              <img class="pt-photo"
                loading="lazy"
                src="${esc(photo)}" alt="">` : ''}

            <p class="pt-desc">${esc(r.description)}</p>

            ${ticket ? `
              <p class="pt-alert">
                ${he
                  ? 'לפעילות זו נרכש כרטיס. מומלץ להקפיד על שעת הכניסה; דילוג אינו מבטל הזמנה.'
                  : 'This activity has a booked ticket. Please check the entry time; skipping does not cancel the booking.'}
              </p>` : ''}

            <div class="pt-actions">
              ${map ? `
                <a href="${esc(map)}" target="_blank"
                   rel="noopener noreferrer">
                  📍 ${he ? 'ניווט' : 'Directions'}
                </a>` : ''}

              ${contact ? `
                <a href="${esc(contact)}" target="_blank"
                   rel="noopener noreferrer">
                  💬 ${he ? 'בקשת שינוי' : 'Request change'}
                </a>` : ''}
            </div>
          </div>
        </details>`;
    });

    timeline.innerHTML = html || (
      he ? 'התוכנית תעודכן בהמשך.'
         : 'The itinerary will appear here soon.'
    );
  }

  window.renderClient = function(...args) {
    const result = oldRender.apply(this, args);
    draw();
    return result;
  };

  if (window.clientTrip) draw();

  const hint = document.querySelector('#itinerary + .hint');
  if (hint) {
    hint.textContent =
      'כל שורה: יום | שעה | כותרת | תיאור | כרטיס (אם נרכש) | קישור לתמונה | קישור לניווט';
  }
})();
