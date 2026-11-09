/* Cihan Otel web sitesi. Veriler otelin PMS'inden (/api/public/v1) okunur; sayfaya hiçbir metin HTML olarak basılmaz. */
(() => {
  'use strict';
  const API = (window.CIHAN_API_BASE || '').replace(/\/$/, '');
  const $ = s => document.querySelector(s);

  const T = {
    tr: {
      skip: 'İçeriğe geç', 'nav.rooms': 'Odalar', 'nav.gallery': 'Galeri', 'nav.lookup': 'Rezervasyonum', 'nav.contact': 'İletişim', 'nav.book': 'Rezervasyon',
      'hero.kicker': 'Doğrudan otelden rezervasyon',
      'hero.lead': 'Tarihlerinizi seçin, müsait odaları ve gerçek fiyatları görün. Talebiniz otel tarafından onaylandığında takip kodunuzla durumunu buradan izleyebilirsiniz.',
      'f.arrival': 'Giriş', 'f.departure': 'Çıkış', 'f.adults': 'Yetişkin', 'f.children': 'Çocuk', 'f.search': 'Müsaitlik', 'f.code': 'Takip kodu',
      'f.contact': 'E-posta veya telefon', 'f.query': 'Sorgula', 'book.title': 'Müsait odalar', 'about.title': 'Otelimiz', 'rooms.title': 'Odalar',
      'gallery.title': 'Galeri', 'lookup.title': 'Rezervasyonumu sorgula',
      'lookup.sub': 'Takip kodunuzu ve rezervasyonda verdiğiniz e-posta adresini veya telefon numarasını girin.',
      'contact.title': 'İletişim', 'contact.empty': 'İletişim bilgileri kısa süre içinde eklenecektir.',
      'doc.terms': 'Rezervasyon ve iptal koşulları', staff: 'Personel girişi', 'doc.privacy': 'KVKK aydınlatma metni', 'doc.none': 'Bu metin otel tarafından henüz eklenmedi.',
      phone: 'Telefon', email: 'E-posta', address: 'Adres', map: 'Yol tarifi', whatsapp: 'WhatsApp', checkin: 'Giriş saati', checkout: 'Çıkış saati',
      roomsFallback: 'Odalarımızdan', nights: n => `${n} gece`, persons: (a, c) => `${a} yetişkin${c ? `, ${c} çocuk` : ''}`, cap: (a, c) => `En fazla ${a} yetişkin${c ? ` + ${c} çocuk` : ''}`,
      total: 'Toplam', perNight: 'gecelik ortalama', choose: 'Bu odayı seç', full: 'Bu tarihlerde müsait değil', noRooms: 'Seçtiğiniz kişi sayısına uygun oda bulunamadı.',
      offline: 'Online rezervasyon şu anda kullanılamıyor. Lütfen otelle telefon veya WhatsApp üzerinden iletişime geçin.',
      closed: 'Online rezervasyon şu an kapalı. Lütfen otelle iletişime geçin.',
      firstName: 'Ad', lastName: 'Soyad', mail: 'E-posta', tel: 'Telefon', special: 'Özel isteğiniz (isteğe bağlı)',
      acceptTerms: 'Rezervasyon ve iptal koşullarını okudum, kabul ediyorum.', acceptKvkk: 'KVKK aydınlatma metnini okudum.',
      send: 'Rezervasyon talebini gönder', back: 'Geri', sending: 'Gönderiliyor…',
      sent: 'Talebiniz otele iletildi. Durumu “Onay Bekliyor”; otel onayladığında burada “Onaylandı” görürsünüz.',
      keep: 'Bu kodu saklayın. Rezervasyonunuzu sorgulamak için kod ile birlikte e-posta adresiniz veya telefonunuz gerekir.',
      selected: 'Seçilen oda', status: 'Durum', stay: 'Konaklama', room: 'Oda', guests: 'Kişi',
      st: { pending: 'Onay Bekliyor', approved: 'Onaylandı', rejected: 'Reddedildi', withdrawn: 'Talep Geri Çekildi', cancelled: 'İptal Edildi', checked_in: 'Konaklıyor', checked_out: 'Çıkış Yapıldı', no_show: 'Gelinmedi' },
      withdraw: 'Talebimi geri çek', withdrawAsk: 'Rezervasyon talebiniz geri çekilecek. Emin misiniz?',
      approvedMsg: 'Rezervasyonunuz otel tarafından onaylanmıştır. İptal veya değişiklik işlemleri için lütfen Cihan Otel ile iletişime geçiniz.',
      call: 'Oteli ara', waBtn: 'WhatsApp ile yaz', reqTitle: 'Otelden talep', reqKind: 'Talep', reqMsg: 'Açıklama', reqSend: 'Talebi gönder',
      reqSent: 'Talebiniz otele iletildi. Talep otomatik onay anlamına gelmez; otel sizinle iletişime geçecektir.',
      kinds: { early_checkin: 'Erken giriş', late_checkout: 'Geç çıkış', extra_bed: 'Ek yatak', invoice: 'Fatura', special: 'Özel istek' },
      waText: code => code ? `Merhaba Cihan Otel, ${code} numaralı rezervasyonum hakkında bilgi almak istiyorum.` : 'Merhaba Cihan Otel, bilgi almak istiyorum.',
      err: 'İşlem tamamlanamadı. Lütfen biraz sonra tekrar deneyin.', busy: 'Çok fazla deneme yapıldı. Bir dakika sonra tekrar deneyin.',
      dateErr: 'Çıkış tarihi giriş tarihinden sonra olmalıdır.',
    },
    en: {
      skip: 'Skip to content', 'nav.rooms': 'Rooms', 'nav.gallery': 'Gallery', 'nav.lookup': 'My booking', 'nav.contact': 'Contact', 'nav.book': 'Book',
      'hero.kicker': 'Book directly with the hotel',
      'hero.lead': 'Choose your dates to see available rooms and real prices. Once the hotel confirms your request, you can follow it here with your booking code.',
      'f.arrival': 'Check-in', 'f.departure': 'Check-out', 'f.adults': 'Adults', 'f.children': 'Children', 'f.search': 'Availability', 'f.code': 'Booking code',
      'f.contact': 'E-mail or phone', 'f.query': 'Look up', 'book.title': 'Available rooms', 'about.title': 'The hotel', 'rooms.title': 'Rooms',
      'gallery.title': 'Gallery', 'lookup.title': 'Find my booking',
      'lookup.sub': 'Enter your booking code and the e-mail address or phone number you used when booking.',
      'contact.title': 'Contact', 'contact.empty': 'Contact details will be added shortly.',
      'doc.terms': 'Booking and cancellation terms', staff: 'Staff login', 'doc.privacy': 'Privacy notice (KVKK)', 'doc.none': 'This text has not been added by the hotel yet.',
      phone: 'Phone', email: 'E-mail', address: 'Address', map: 'Directions', whatsapp: 'WhatsApp', checkin: 'Check-in time', checkout: 'Check-out time',
      roomsFallback: 'Our rooms', nights: n => `${n} night${n > 1 ? 's' : ''}`, persons: (a, c) => `${a} adult${a > 1 ? 's' : ''}${c ? `, ${c} child${c > 1 ? 'ren' : ''}` : ''}`,
      cap: (a, c) => `Up to ${a} adults${c ? ` + ${c} children` : ''}`,
      total: 'Total', perNight: 'average per night', choose: 'Select this room', full: 'Not available for these dates', noRooms: 'No room fits the selected number of guests.',
      offline: 'Online booking is not available at the moment. Please contact the hotel by phone or WhatsApp.',
      closed: 'Online booking is currently closed. Please contact the hotel.',
      firstName: 'First name', lastName: 'Last name', mail: 'E-mail', tel: 'Phone', special: 'Special request (optional)',
      acceptTerms: 'I have read and accept the booking and cancellation terms.', acceptKvkk: 'I have read the privacy notice (KVKK).',
      send: 'Send booking request', back: 'Back', sending: 'Sending…',
      sent: 'Your request has been sent to the hotel. Its status is “Awaiting confirmation”; once the hotel confirms, you will see “Confirmed” here.',
      keep: 'Keep this code. To look up your booking you need the code together with your e-mail address or phone number.',
      selected: 'Selected room', status: 'Status', stay: 'Stay', room: 'Room', guests: 'Guests',
      st: { pending: 'Awaiting confirmation', approved: 'Confirmed', rejected: 'Declined', withdrawn: 'Withdrawn', cancelled: 'Cancelled', checked_in: 'In house', checked_out: 'Checked out', no_show: 'No-show' },
      withdraw: 'Withdraw my request', withdrawAsk: 'Your booking request will be withdrawn. Are you sure?',
      approvedMsg: 'Your booking has been confirmed by the hotel. For cancellations or changes please contact Cihan Otel.',
      call: 'Call the hotel', waBtn: 'Message on WhatsApp', reqTitle: 'Request to the hotel', reqKind: 'Request', reqMsg: 'Details', reqSend: 'Send request',
      reqSent: 'Your request has been sent. It is not an automatic confirmation; the hotel will get back to you.',
      kinds: { early_checkin: 'Early check-in', late_checkout: 'Late check-out', extra_bed: 'Extra bed', invoice: 'Invoice', special: 'Special request' },
      waText: code => code ? `Hello Cihan Otel, I would like information about my booking ${code}.` : 'Hello Cihan Otel, I would like some information.',
      err: 'Something went wrong. Please try again shortly.', busy: 'Too many attempts. Please try again in a minute.',
      dateErr: 'Check-out must be after check-in.',
    },
  };

  let lang = 'tr';
  try { lang = localStorage.getItem('cihan-lang') === 'en' ? 'en' : 'tr'; } catch { /* depolama kapalı */ }
  const t = k => T[lang][k];
  const tx = obj => (obj && (obj[lang] || obj.tr || obj.en)) || '';
  const money = (v, cur) => new Intl.NumberFormat(lang === 'tr' ? 'tr-TR' : 'en-GB', { style: 'currency', currency: cur || 'TRY', maximumFractionDigits: 0 }).format(Number(v));
  const date = d => new Date(d + 'T00:00:00').toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const iso = d => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

  /** Güvenli DOM üretimi: metinler her zaman textContent olarak eklenir. */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }

  async function call(method, path, body, key) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (key) headers['Idempotency-Key'] = key;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    let res;
    try { res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal, credentials: 'omit' }); }
    catch { throw Object.assign(new Error(t('offline')), { offline: true }); }
    finally { clearTimeout(timer); }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* JSON değil: sunucu yok veya ara sunucu sayfası */ }
    if (res.ok && data) return data;
    if (res.status === 429) throw new Error(t('busy'));
    if (res.status === 503 && data?.code === 'online_closed') throw Object.assign(new Error(t('closed')), { offline: true });
    if (!data || res.status === 404 && !data.code || res.status >= 500) throw Object.assign(new Error(t('offline')), { offline: res.status !== 404 || !data });
    // Sunucu mesajları Türkçedir; İngilizce sayfada genel mesaj gösterilir.
    throw new Error(lang === 'tr' && data.message ? data.message : t('err'));
  }

  let info = null;
  const waLink = code => info?.whatsapp ? `https://wa.me/${info.whatsapp}?text=${encodeURIComponent(t('waText')(code))}` : null;
  const telLink = () => info?.phone ? `tel:${info.phone.replace(/[^\d+]/g, '')}` : null;

  // ---- statik metinler ve dil
  function applyLang() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-t]').forEach(el => { const v = t(el.dataset.t); if (typeof v === 'string') el.textContent = v; });
    $('#lang').textContent = lang === 'tr' ? 'EN' : 'TR';
    renderInfo();
  }
  $('#lang').addEventListener('click', () => {
    lang = lang === 'tr' ? 'en' : 'tr';
    try { localStorage.setItem('cihan-lang', lang); } catch { /* yok say */ }
    applyLang();
  });
  $('#year').textContent = String(new Date().getFullYear());

  // ---- otel bilgileri, odalar, galeri, iletişim
  const STATIC_GALLERY = ['dis-gunduz', 'teras', 'giris', 'oda-1', 'oda-2', 'oda-3', 'oda-4', 'oda-5', 'dis-gece-1', 'dis-gece-2', 'dis-gece-3'];
  const ROOM_PICS = ['oda-1', 'oda-2', 'oda-3', 'oda-4'];
  const photoUrl = u => (u.startsWith('/api/') ? API + u : u);

  function lightbox(src) { $('#lb-img').src = src; $('#lightbox').showModal(); }

  function renderInfo() {
    const about = tx(info?.about);
    $('#hakkimizda').hidden = !about;
    $('#about').textContent = about;

    const rooms = $('#rooms');
    rooms.replaceChildren();
    if (info?.rooms?.length) {
      rooms.className = 'rooms';
      for (const r of info.rooms) {
        const pic = r.photos[0] ? photoUrl(r.photos[0].url) : null;
        rooms.append(h('article', { class: 'room' },
          pic && h('img', { src: pic, alt: tx(r.title), loading: 'lazy' }),
          h('div', { class: 'room-b' },
            h('h3', null, tx(r.title) || r.code),
            tx(r.description) && h('p', null, tx(r.description)),
            r.features?.length ? h('ul', { class: 'tags' }, r.features.map(f => h('li', null, f))) : null,
            h('span', { class: 'cap' }, t('cap')(r.maxAdults, r.maxChildren)))));
      }
    } else {
      // PMS'e bağlanılamadığında yalnız gerçek oda fotoğrafları gösterilir; oda tipi, fiyat veya özellik uydurulmaz.
      rooms.className = 'room-pics';
      for (const p of ROOM_PICS) rooms.append(h('img', { src: `/img/${p}.jpg`, alt: t('roomsFallback'), loading: 'lazy', onclick: () => lightbox(`/img/${p}.jpg`) }));
    }

    const gal = $('#gallery');
    gal.replaceChildren();
    const extra = (info?.photos || []).filter(p => p.place === 'gallery').map(p => photoUrl(p.url));
    for (const src of [...extra, ...STATIC_GALLERY.map(p => `/img/${p}.jpg`)])
      gal.append(h('button', { type: 'button', 'aria-label': t('gallery.title'), onclick: () => lightbox(src) }, h('img', { src, alt: '', loading: 'lazy' })));

    const c = $('#contact');
    c.replaceChildren();
    const rows = [];
    if (info?.phone) rows.push([t('phone'), h('a', { href: telLink() }, info.phone)]);
    if (info?.whatsapp) rows.push([t('whatsapp'), h('a', { href: waLink(), target: '_blank', rel: 'noopener' }, '+' + info.whatsapp)]);
    if (info?.email) rows.push([t('email'), h('a', { href: `mailto:${info.email}` }, info.email)]);
    if (info?.address) rows.push([t('address'), info.address]);
    if (info?.mapUrl) rows.push(['', h('a', { href: info.mapUrl, target: '_blank', rel: 'noopener' }, t('map'))]);
    if (info?.checkinTime) rows.push([t('checkin'), info.checkinTime], [t('checkout'), info.checkoutTime]);
    for (const [k, v] of rows) c.append(h('dt', null, k), h('dd', null, v));
    $('#contact-empty').hidden = rows.length > 0;

    const wa = $('#wa');
    wa.hidden = !info?.whatsapp;
    if (info?.whatsapp) wa.href = waLink();
  }

  async function loadInfo() {
    try { info = await call('GET', '/api/public/v1/info'); } catch { info = null; }
    if (info?.hotelName) document.title = info.hotelName;
    const s = $('#search');
    const first = info ? addDays(info.today, Math.max(info.minLeadDays, 0)) : iso(new Date());
    s.arrival.min = first; s.departure.min = addDays(first, 1);
    if (!s.arrival.value) { s.arrival.value = first; s.departure.value = addDays(first, 1); }
    applyLang();
  }

  // ---- belgeler
  document.querySelectorAll('[data-doc]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.doc;
    $('#doc-title').textContent = t(k === 'terms' ? 'doc.terms' : 'doc.privacy');
    $('#doc-body').textContent = tx(info?.[k]) || t('doc.none');
    $('#doc').showModal();
  }));
  const docLink = (k, label) => h('button', { type: 'button', class: 'link', onclick: () => { $('#doc-title').textContent = t(k === 'terms' ? 'doc.terms' : 'doc.privacy'); $('#doc-body').textContent = tx(info?.[k]) || t('doc.none'); $('#doc').showModal(); } }, label);

  // ---- rezervasyon akışı
  const band = $('#rezervasyon');
  const body = $('#book-body');
  let query = null;

  function contactButtons(code) {
    return h('div', { class: 'row' },
      telLink() && h('a', { class: 'btn btn-line', href: telLink() }, t('call')),
      waLink(code) && h('a', { class: 'btn btn-g', href: waLink(code), target: '_blank', rel: 'noopener' }, t('waBtn')));
  }

  $('#search').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    query = { arrival: f.arrival.value, departure: f.departure.value, adults: Number(f.adults.value), children: Number(f.children.value) };
    band.hidden = false;
    band.scrollIntoView({ behavior: 'smooth' });
    $('#book-sum').textContent = '';
    if (query.departure <= query.arrival) { body.replaceChildren(h('p', { class: 'note err' }, t('dateErr'))); return; }
    body.replaceChildren(h('p', { class: 'muted' }, '…'));
    try {
      const offers = await call('GET', `/api/public/v1/availability?arrival=${query.arrival}&departure=${query.departure}&adults=${query.adults}&children=${query.children}`);
      const n = (Date.parse(query.departure) - Date.parse(query.arrival)) / 864e5;
      $('#book-sum').textContent = `${date(query.arrival)} – ${date(query.departure)} · ${t('nights')(n)} · ${t('persons')(query.adults, query.children)}`;
      if (!offers.length) { body.replaceChildren(h('p', { class: 'note' }, t('noRooms'))); return; }
      body.replaceChildren(h('div', { class: 'offers' }, offers.map(o => {
        const room = info?.rooms?.find(r => r.roomTypeId === o.roomTypeId);
        const pic = room?.photos?.[0] ? photoUrl(room.photos[0].url) : null;
        return h('div', { class: 'offer' + (o.available ? '' : ' off') },
          pic ? h('img', { src: pic, alt: '' }) : h('div'),
          h('div', null, h('h3', null, tx(room?.title) || o.code), room && tx(room.description) && h('p', { class: 'muted' }, tx(room.description).slice(0, 180))),
          h('div', { class: 'price' },
            o.available ? [h('span', { class: 'muted' }, t('total')), h('b', null, money(o.total, o.currency)), h('span', { class: 'muted' }, `${money(o.average, o.currency)} ${t('perNight')}`),
              h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn btn-o', type: 'button', onclick: () => bookingForm(o, room) }, t('choose')))]
              : h('span', { class: 'muted' }, t('full'))));
      })));
    } catch (err) {
      body.replaceChildren(h('p', { class: 'note' + (err.offline ? '' : ' err') }, err.message), contactButtons());
    }
  });

  function bookingForm(o, room) {
    const key = crypto.randomUUID(); // aynı form tekrar gönderilirse ikinci rezervasyon açılmaz
    const form = h('form', { class: 'form', autocomplete: 'on' },
      h('p', { class: 'full' }, h('b', null, t('selected') + ': '), tx(room?.title) || o.code, ' · ', money(o.total, o.currency)),
      h('label', null, h('span', null, t('firstName')), h('input', { name: 'firstName', required: true, maxlength: 60, autocomplete: 'given-name' })),
      h('label', null, h('span', null, t('lastName')), h('input', { name: 'lastName', required: true, maxlength: 60, autocomplete: 'family-name' })),
      h('label', null, h('span', null, t('mail')), h('input', { name: 'email', type: 'email', required: true, maxlength: 120, autocomplete: 'email' })),
      h('label', null, h('span', null, t('tel')), h('input', { name: 'phone', type: 'tel', required: true, maxlength: 30, autocomplete: 'tel' })),
      h('label', { class: 'full' }, h('span', null, t('special')), h('textarea', { name: 'specialRequests', rows: 3, maxlength: 1000 })),
      h('div', { class: 'hp', 'aria-hidden': 'true' }, h('label', null, 'Website', h('input', { name: 'website', tabindex: '-1', autocomplete: 'off' }))),
      h('label', { class: 'check full' }, h('input', { type: 'checkbox', name: 'acceptTerms', required: true }), h('span', null, t('acceptTerms'), ' ', docLink('terms', '↗'))),
      h('label', { class: 'check full' }, h('input', { type: 'checkbox', name: 'kvkk', required: true }), h('span', null, t('acceptKvkk'), ' ', docLink('privacy', '↗'))),
      h('div', { class: 'row full' }, h('button', { class: 'btn btn-o', type: 'submit' }, t('send')), h('button', { class: 'btn btn-line', type: 'button', onclick: () => $('#search').requestSubmit() }, t('back'))),
      h('div', { class: 'full', id: 'book-msg', 'aria-live': 'polite' }));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      const btn = f.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = t('sending');
      try {
        const r = await call('POST', '/api/public/v1/bookings', {
          roomTypeId: o.roomTypeId, ...query, firstName: f.firstName.value, lastName: f.lastName.value, email: f.email.value, phone: f.phone.value,
          specialRequests: f.specialRequests.value || null, acceptTerms: f.acceptTerms.checked, kvkkConsent: f.kvkk.checked, language: lang, website: f.website.value || null,
        }, key);
        body.replaceChildren(h('div', { class: 'card' },
          h('p', { class: 'note ok' }, t('sent')),
          h('p', null, t('f.code') + ':'), h('p', { class: 'code' }, r.code),
          h('p', { class: 'muted' }, t('keep')),
          h('dl', { class: 'kv' }, h('dt', null, t('stay')), h('dd', null, `${date(r.arrival)} – ${date(r.departure)} · ${t('nights')(r.nights)}`),
            h('dt', null, t('total')), h('dd', null, money(r.total, r.currency))),
          contactButtons(r.code)));
        const l = $('#lookup');
        l.code.value = r.code; l.contact.value = f.email.value;
      } catch (err) {
        $('#book-msg').replaceChildren(h('p', { class: 'note err' }, err.message));
        btn.disabled = false; btn.textContent = t('send');
      }
    });
    body.replaceChildren(form);
    form.firstName.focus();
  }

  // ---- rezervasyon sorgulama
  const out = $('#lookup-out');
  let last = null;
  $('#lookup').addEventListener('submit', async e => {
    e.preventDefault();
    last = { code: e.target.code.value.trim().toUpperCase(), contact: e.target.contact.value.trim() };
    await show(() => call('POST', '/api/public/v1/bookings/lookup', last));
  });

  async function show(fn) {
    out.replaceChildren(h('p', { class: 'muted' }, '…'));
    try { render(await fn()); } catch (err) { out.replaceChildren(h('p', { class: 'note' + (err.offline ? '' : ' err') }, err.message), err.offline ? contactButtons() : null); }
  }

  function render(v) {
    const card = h('div', { class: 'card' },
      h('div', { class: 'row' }, h('span', { class: 'code' }, v.code), h('span', { class: 'status ' + v.status }, t('st')[v.status] || v.status)),
      h('dl', { class: 'kv' },
        h('dt', null, t('stay')), h('dd', null, `${date(v.arrival)} – ${date(v.departure)} · ${t('nights')(v.nights)}`),
        h('dt', null, t('room')), h('dd', null, tx(v.roomTitle)),
        h('dt', null, t('guests')), h('dd', null, t('persons')(v.adults, v.children)),
        h('dt', null, t('total')), h('dd', null, money(v.total, v.currency))));
    if (v.canWithdraw)
      card.append(h('button', { class: 'btn btn-line', type: 'button', onclick: async () => {
        if (!confirm(t('withdrawAsk'))) return;
        await show(() => call('POST', '/api/public/v1/bookings/withdraw', last));
      } }, t('withdraw')));
    if (v.status === 'approved') card.append(h('p', { class: 'note' }, t('approvedMsg')), contactButtons(v.code));
    if (v.canRequest) {
      const kinds = Object.entries(t('kinds'));
      const rf = h('form', { class: 'form', style: 'margin-top:16px' },
        h('p', { class: 'full' }, h('b', null, t('reqTitle'))),
        h('label', null, h('span', null, t('reqKind')), h('select', { name: 'kind' }, kinds.map(([k, l]) => h('option', { value: k }, l)))),
        h('label', { class: 'full' }, h('span', null, t('reqMsg')), h('textarea', { name: 'message', rows: 2, maxlength: 500, required: true })),
        h('div', { class: 'full' }, h('button', { class: 'btn btn-g', type: 'submit' }, t('reqSend'))),
        h('div', { class: 'full', 'aria-live': 'polite' }));
      rf.addEventListener('submit', async e => {
        e.preventDefault();
        const msg = rf.lastElementChild;
        try {
          await call('POST', '/api/public/v1/bookings/requests', { ...last, kind: rf.kind.value, message: rf.message.value });
          rf.message.value = '';
          msg.replaceChildren(h('p', { class: 'note ok' }, t('reqSent')));
        } catch (err) { msg.replaceChildren(h('p', { class: 'note err' }, err.message)); }
      });
      card.append(rf);
    }
    out.replaceChildren(card);
  }

  applyLang();
  void loadInfo();
})();
