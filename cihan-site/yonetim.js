/* Web yönetim: oturum HttpOnly çerezde (JavaScript okuyamaz); her istekte X-Cihan başlığı gönderilir (başka siteden istek reddedilir). */
(() => {
  'use strict';
  const API = (window.CIHAN_API_BASE || '').replace(/\/$/, '') + '/api/public/v1/admin';
  const $ = s => document.querySelector(s);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k === 'class') el.className = v; else el.setAttribute(k, v); }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }
  async function call(method, path, body) {
    let res;
    try {
      res = await fetch(API + path, { method, credentials: 'include', headers: { 'X-Cihan': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch { throw new Error('Otel sunucusuna ulaşılamıyor.'); }
    if (res.status === 204) return null;
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* JSON değil */ }
    if (res.ok) return data;
    // Yanıt PMS'ten gelmiyorsa (JSON değil: site henüz otel sunucusuna bağlanmamış veya sunucu kapalı)
    if (!data) { const e = new Error('Otel sunucusuna ulaşılamıyor. Web sitesi otel sunucusuna henüz bağlanmadı veya sunucu kapalı.'); e.status = 0; throw e; }
    const e = new Error(res.status === 429 ? 'Çok fazla deneme. Bir dakika sonra tekrar deneyin.' : data?.message || 'İşlem tamamlanamadı.');
    e.status = res.status;
    throw e;
  }
  const money = (v, c) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: c || 'TRY', maximumFractionDigits: 0 }).format(Number(v));
  const day = d => new Date(d + 'T00:00:00').toLocaleDateString('tr-TR');
  let me = null;

  function showLogin() { me = null; $('#login-box').hidden = false; $('#panel').hidden = true; $('#logout').hidden = true; $('#who').textContent = ''; }

  async function showPanel(m) {
    me = m;
    $('#login-box').hidden = true; $('#panel').hidden = false; $('#logout').hidden = false; $('#who').textContent = m.fullName;
    await load();
  }

  async function load() {
    const box = $('#list');
    box.replaceChildren(h('p', { class: 'muted' }, '…'));
    try {
      const rows = await call('GET', '/pending');
      if (!rows.length) { box.replaceChildren(h('p', { class: 'note ok' }, 'Onay bekleyen talep yok.')); return; }
      box.replaceChildren(h('div', { class: 'offers' }, rows.map(p => h('div', { class: 'card', style: 'margin-top:0' },
        h('div', { class: 'row' }, h('span', { class: 'code', style: 'font-size:17px' }, p.bookingCode), h('span', { class: 'status pending' }, 'Onay Bekliyor'), h('span', { class: 'muted' }, p.reservationNumber)),
        h('dl', { class: 'kv' },
          h('dt', null, 'Misafir'), h('dd', null, p.guestName),
          h('dt', null, 'İletişim'), h('dd', null, [p.phone, p.email].filter(Boolean).join(' · ')),
          h('dt', null, 'Konaklama'), h('dd', null, `${day(p.arrival)} – ${day(p.departure)} · ${p.roomTypeCode} · ${p.adults}+${p.children} kişi`),
          h('dt', null, 'Tutar'), h('dd', null, money(p.totalRate, p.currency)),
          p.specialRequests && [h('dt', null, 'Özel istek'), h('dd', null, p.specialRequests)]),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-g', type: 'button', disabled: !me.canApprove || null, onclick: async e => {
            if (!confirm(`${p.bookingCode} onaylansın mı?`)) return;
            e.target.disabled = true;
            try { await call('POST', `/pending/${p.id}/approve`, { version: p.version }); await load(); } catch (err) { alert(err.message); e.target.disabled = false; if (err.status === 401) showLogin(); }
          } }, 'Onayla'),
          h('button', { class: 'btn btn-line', type: 'button', disabled: !me.canReject || null, onclick: async () => {
            const reason = prompt('Ret gerekçesi (PMS\'te kalır, misafire gösterilmez):');
            if (!reason || !reason.trim()) return;
            try { await call('POST', `/pending/${p.id}/reject`, { reason: reason.trim(), version: p.version }); await load(); } catch (err) { alert(err.message); if (err.status === 401) showLogin(); }
          } }, 'Reddet'))))));
    } catch (err) {
      if (err.status === 401) { showLogin(); return; }
      box.replaceChildren(h('p', { class: 'note err' }, err.message));
    }
  }

  $('#login').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, msg = $('#login-msg'), btn = f.querySelector('button');
    btn.disabled = true; msg.replaceChildren();
    try {
      const m = await call('POST', '/login', { username: f.username.value.trim(), password: f.password.value, code: f.code.value.replace(/\s/g, '') });
      f.reset();
      await showPanel(m);
    } catch (err) { msg.replaceChildren(h('p', { class: 'note err' }, err.message)); f.code.value = ''; f.code.focus(); }
    finally { btn.disabled = false; }
  });
  $('#logout').addEventListener('click', async () => { try { await call('POST', '/logout'); } catch { /* yok say */ } showLogin(); });

  call('GET', '/me').then(showPanel).catch(showLogin);
})();
