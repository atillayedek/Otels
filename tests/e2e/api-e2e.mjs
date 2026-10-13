// HotelPMS uçtan uca API testi.
// YALNIZ izole test kurulumuna karşı çalıştırılır (HOTELPMS_DATA_ROOT ile ayrılmış veri kökü ve ayrı PostgreSQL kümesi).
// Kullanım: node tests/e2e/api-e2e.mjs <baseUrl> <setupCodeFile> <caCertFile>
// Üretim/otel veritabanına karşı ÇALIŞTIRMAYIN: test kayıtları oluşturur.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import assert from 'node:assert/strict';

const [base, setupCodeFile] = process.argv.slice(2);
if (!base || !setupCodeFile) { console.error('Kullanım: node api-e2e.mjs <baseUrl> <setupCodeFile> <caCertFile>'); process.exit(2); }

let token = '';
const deviceId = randomUUID();
const results = [];
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t }); console.log(`PASS ${name}`); }
  catch (e) { results.push({ name, ok: false, error: e.message }); console.log(`FAIL ${name}: ${e.message}`); throw e; }
}

async function api(method, path, body, { key, expect, raw, form } = {}) {
  const headers = { 'X-PMS-Device-Id': deviceId, 'X-PMS-Hostname': 'E2E-TEST' };
  if (key) headers['Idempotency-Key'] = key;
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (form) payload = form; else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + path, { method, headers, body: payload });
  if (raw) return res;
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (path === '/api/v1/auth/login' && res.ok) token = json.token;
  const ok = expect ? (Array.isArray(expect) ? expect.includes(res.status) : res.status === expect) : res.ok;
  if (!ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return json;
}

function tckn(seed) {
  const d = String(100000000 + (seed % 899999999)).split('').map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8], even = d[1] + d[3] + d[5] + d[7];
  d.push((((odd * 7 - even) % 10) + 10) % 10);
  d.push(d.reduce((a, b) => a + b, 0) % 10);
  return d.join('');
}
const addDays = (s, n) => { const x = new Date(s + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

const state = {};
try {
  await step('Kurulum durumu: kurulum gerekli', async () => {
    const s = await api('GET', '/api/v1/setup/status');
    assert.equal(s.setupRequired, true);
  });

  await step('Yanlış kurulum kodu reddedilir', async () => {
    await api('POST', '/api/v1/setup', { setupCode: 'YANLIS-KOD', hotelName: 'Test', timeZone: 'Europe/Istanbul', currency: 'TRY', businessDate: '2030-01-10', adminUsername: 'admin', adminFullName: 'Test Admin', adminPassword: 'TestParola123' }, { expect: 403 });
  });

  await step('İlk kurulum (test tesisi + yönetici)', async () => {
    const code = readFileSync(setupCodeFile, 'utf8').trim();
    await api('POST', '/api/v1/setup', { setupCode: code, hotelName: 'E2E Test Tesisi Çığşöü', timeZone: 'Europe/Istanbul', currency: 'TRY',
      businessDate: '2030-01-10', adminUsername: 'e2eadmin', adminFullName: 'E2E Yönetici', adminPassword: 'TestParola123' });
  });

  await step('Hatalı parola reddedilir', async () => {
    await api('POST', '/api/v1/auth/login', { username: 'e2eadmin', password: 'yanlis-parola1', deviceId }, { expect: 401 });
  });

  await step('Giriş ve yetkiler', async () => {
    const me = (await api('POST', '/api/v1/auth/login', { username: 'e2eadmin', password: 'TestParola123', deviceId, deviceName: 'E2E', deviceKind: 'client' })).user;
    assert.ok(me.permissions.includes('night_audit.execute'));
    const p = await api('GET', '/api/v1/property');
    assert.equal(p.name, 'E2E Test Tesisi Çığşöü');
    state.bd = p.businessDate;
  });

  await step('Boş sistemde sahte veri yok', async () => {
    const d = await api('GET', '/api/v1/dashboard');
    assert.equal(d.roomsTotal, 0); assert.equal(d.occupied, 0); assert.equal(d.roomRevenueToday, '0.00');
    const g = await api('GET', '/api/v1/guests');
    assert.equal(g.total, 0);
  });

  await step('Oda tipi ve odalar', async () => {
    state.std = (await api('POST', '/api/v1/room-types', { code: 'STD', name: 'Standart', maxAdults: 2, maxChildren: 1, defaultRate: '1500.00', sortOrder: 1, isActive: true })).id;
    for (const n of ['101', '102']) state['room' + n] = (await api('POST', '/api/v1/rooms', { roomTypeId: state.std, number: n, floor: '1', sortOrder: Number(n), isActive: true })).id;
    const rooms = await api('GET', '/api/v1/rooms');
    assert.equal(rooms.length, 2);
    for (const r of rooms) await api('POST', `/api/v1/rooms/${r.id}/housekeeping`, { hkStatus: 'clean', isDnd: false, version: r.version });
  });

  await step('Misafir (Türkçe karakter + TCKN) ve maskeleme', async () => {
    state.guest = (await api('POST', '/api/v1/guests', { firstName: 'Çağrı', lastName: 'Işıkoğlu', nationality: 'TR', identityType: 'tckn', identityNumber: tckn(12345678),
      phone: '0532 111 22 33', email: 'test@example.invalid', isVip: true, kvkkConsent: true, marketingConsent: false })).id;
    const prof = await api('GET', `/api/v1/guests/${state.guest}`);
    assert.equal(prof.guest.firstName, 'Çağrı'); assert.equal(prof.guest.lastName, 'Işıkoğlu');
    const list = await api('GET', '/api/v1/guests?q=' + encodeURIComponent('ışıkoğlu'));
    assert.equal(list.total, 1);
  });

  await step('Geçersiz TCKN reddedilir', async () => {
    await api('POST', '/api/v1/guests', { firstName: 'A', lastName: 'B', identityType: 'tckn', identityNumber: '12345678901', isVip: false, kvkkConsent: false, marketingConsent: false }, { expect: 422 });
  });

  await step('Rezervasyon (idempotent oluşturma)', async () => {
    const body = { guestId: state.guest, roomTypeId: state.std, arrival: state.bd, departure: addDays(state.bd, 2), adults: 2, children: 0, status: 'confirmed', depositRequired: '0' };
    const key = randomUUID();
    const a = await api('POST', '/api/v1/reservations', body, { key });
    const b = await api('POST', '/api/v1/reservations', body, { key });
    assert.equal(a.id, b.id);
    state.res = a.id;
    const r = await api('GET', `/api/v1/reservations/${state.res}`);
    assert.equal(r.totalRate, '3000.00'); assert.equal(r.nights, 2);
    await api('POST', '/api/v1/reservations', { ...body, adults: 1 }, { key, expect: 409 });
  });

  await step('Eksik idempotency anahtarı reddedilir', async () => {
    await api('POST', '/api/v1/reservations', { guestId: state.guest, roomTypeId: state.std, arrival: state.bd, departure: addDays(state.bd, 1), adults: 1, children: 0, status: 'confirmed', depositRequired: '0' }, { expect: 422 });
  });

  await step('Son oda yarışı: eşzamanlı iki rezervasyondan biri reddedilir', async () => {
    const mk = () => api('POST', '/api/v1/reservations', { guestId: state.guest, roomTypeId: state.std, arrival: state.bd, departure: addDays(state.bd, 1), adults: 1, children: 0, status: 'confirmed', depositRequired: '0' }, { key: randomUUID(), raw: true });
    const [x, y] = await Promise.all([mk(), mk()]);
    const codes = [x.status, y.status].sort();
    // Admin overbook iznine sahip; bu yüzden yarış testi overbook izni olmayan resepsiyon kullanıcısıyla aşağıda tekrar edilir.
    assert.ok(codes.every(c => c === 200 || c === 409));
    for (const r of [x, y]) if (r.status === 200) { const j = await r.json(); await api('POST', `/api/v1/reservations/${j.id}/cancel`, { reason: 'test temizliği', version: 1 }, { key: randomUUID() }); }
  });

  await step('Resepsiyon kullanıcısı (overbook yetkisi yok) ile son oda yarışı', async () => {
    await api('POST', '/api/v1/users', { username: 'e2erecep', fullName: 'E2E Resepsiyon', password: 'Resepsiyon123', roles: ['RECEPTION'] });
    const adminToken = token;
    token = '';
    await api('POST', '/api/v1/auth/login', { username: 'e2erecep', password: 'Resepsiyon123', deviceId, deviceKind: 'browser' });
    await api('GET', '/api/v1/reservations', undefined, { expect: 403 }).catch(() => {});
    await api('POST', '/api/v1/auth/change-password', { currentPassword: 'Resepsiyon123', newPassword: 'Resepsiyon456' });
    await api('POST', '/api/v1/auth/login', { username: 'e2erecep', password: 'Resepsiyon456', deviceId, deviceKind: 'browser' });
    // Tarih: bd+5..bd+6 iki odadan biri doluysa yalnız bir oda kalır.
    const d1 = addDays(state.bd, 5), d2 = addDays(state.bd, 6);
    await api('POST', '/api/v1/reservations', { guestId: state.guest, roomTypeId: state.std, arrival: d1, departure: d2, adults: 1, children: 0, status: 'confirmed', depositRequired: '0' }, { key: randomUUID() });
    const mk = () => api('POST', '/api/v1/reservations', { guestId: state.guest, roomTypeId: state.std, arrival: d1, departure: d2, adults: 1, children: 0, status: 'confirmed', depositRequired: '0' }, { key: randomUUID(), raw: true });
    const [x, y] = await Promise.all([mk(), mk()]);
    const codes = [x.status, y.status].sort();
    assert.deepEqual(codes, [200, 409], 'tam olarak biri başarılı olmalı: ' + codes);
    // Yetkisiz işlem: resepsiyon gece denetimi çalıştıramaz.
    await api('GET', '/api/v1/night-audit/preview', undefined, { expect: 403 });
    await api('POST', '/api/v1/users', { username: 'hack', fullName: 'x', password: 'Parola12345', roles: ['SUPER_ADMIN'] }, { expect: 403 });
    token = adminToken;
  });

  await step('Check-in (kimlik zorunlu, temiz oda, KBS kaydı)', async () => {
    const r = await api('GET', `/api/v1/reservations/${state.res}`);
    await api('POST', `/api/v1/reservations/${state.res}/check-in`, { roomId: state.room101, earlyCheckIn: false, version: r.version }, { key: randomUUID() });
    const after = await api('GET', `/api/v1/reservations/${state.res}`);
    assert.equal(after.status, 'checked_in'); assert.equal(after.roomNumber, '101');
    const kbs = await api('GET', '/api/v1/kbs/reports');
    assert.ok(kbs.some(k => k.status === 'blocked_configuration'));
  });

  await step('KBS bildirim formu: oda no ve misafir alanları dolu, toplu manuel işaretleme', async () => {
    const f = await api('GET', `/api/v1/kbs/reservations/${state.res}/form`);
    assert.equal(f.reservation.roomNumber, '101');
    assert.equal(f.automaticSendingAvailable, false);
    assert.ok(f.guests.length >= 1);
    const g = f.guests.find(x => x.isPrimary);
    assert.equal(g.lastName, 'Işıkoğlu');
    assert.ok(g.identityNumber && !g.identityNumber.includes('*'), 'yönetici kimlik numarasını maskesiz görür');
    assert.equal(g.reportStatus, 'blocked_configuration');
    await api('POST', `/api/v1/kbs/reservations/${state.res}/manual`, { reference: '' , reason: 'x' }, { key: randomUUID(), expect: 422 });
    const m = await api('POST', `/api/v1/kbs/reservations/${state.res}/manual`, { reference: 'KBS-REF-1', reason: 'Resmi KBS ekranından bildirildi' }, { key: randomUUID() });
    assert.equal(m.count, f.guests.length);
    const f2 = await api('GET', `/api/v1/kbs/reservations/${state.res}/form`);
    assert.ok(f2.guests.every(x => x.reportStatus === 'reported_manually' && x.manualReference === 'KBS-REF-1'));
    await api('POST', `/api/v1/kbs/reservations/${state.res}/manual`, { reference: 'KBS-REF-2', reason: 'tekrar' }, { key: randomUUID(), expect: 409 });
  });

  await step('Dolu odaya ikinci check-in engellenir', async () => {
    const id = (await api('POST', '/api/v1/reservations', { guestId: state.guest, roomTypeId: state.std, arrival: state.bd, departure: addDays(state.bd, 1), adults: 1, children: 0, status: 'confirmed', depositRequired: '0' }, { key: randomUUID() })).id;
    const r = await api('GET', `/api/v1/reservations/${id}`);
    await api('POST', `/api/v1/reservations/${id}/check-in`, { roomId: state.room101, earlyCheckIn: false, version: r.version }, { key: randomUUID(), expect: 409 });
    await api('POST', `/api/v1/reservations/${id}/cancel`, { reason: 'test', version: r.version }, { key: randomUUID() });
  });

  await step('Folyo: masraf, kasa, çift tıklama ödeme koruması', async () => {
    const folios = await api('GET', `/api/v1/folios?reservationId=${state.res}`);
    state.folio = folios[0].id;
    const code = (await api('POST', '/api/v1/finance/transaction-codes', { code: 'MINI', name: 'Minibar', category: 'minibar', vatRate: '10', isActive: true })).id;
    await api('POST', `/api/v1/folios/${state.folio}/charges`, { transactionCodeId: code, quantity: '3', unitPrice: '33.33' }, { key: randomUUID() });
    const methods = await api('GET', '/api/v1/finance/payment-methods');
    state.cash = methods.find(m => m.code === 'CASH').id;
    await api('POST', `/api/v1/folios/${state.folio}/payments`, { paymentMethodId: state.cash, amount: '50.00', isDeposit: false }, { key: randomUUID(), expect: 422 });
    await api('POST', '/api/v1/cashier/open', { openingFloat: '100.00' }, { key: randomUUID() });
    const key = randomUUID();
    const pay = { paymentMethodId: state.cash, amount: '50.00', isDeposit: false };
    const [p1, p2] = await Promise.all([api('POST', `/api/v1/folios/${state.folio}/payments`, pay, { key }), api('POST', `/api/v1/folios/${state.folio}/payments`, pay, { key })]);
    assert.equal(p1.id, p2.id);
    const f = await api('GET', `/api/v1/folios/${state.folio}`);
    assert.equal(f.lines.filter(l => l.lineType === 'payment').length, 1);
    assert.equal(f.folio.balance, '49.99'); // 99.99 - 50.00 (ondalık, kayan nokta yok)
  });

  await step('Void ve iade kuralları', async () => {
    const f = await api('GET', `/api/v1/folios/${state.folio}`);
    const pay = f.lines.find(l => l.lineType === 'payment');
    await api('POST', `/api/v1/folios/${state.folio}/refunds`, { paymentMethodId: state.cash, amount: '60.00', reason: 'fazla' }, { key: randomUUID(), expect: 422 });
    await api('POST', `/api/v1/folio-lines/${pay.id}/void`, { reason: 'yanlış giriş' }, { key: randomUUID() });
    await api('POST', `/api/v1/folio-lines/${pay.id}/void`, { reason: 'tekrar' }, { key: randomUUID(), expect: 422 });
    const after = await api('GET', `/api/v1/folios/${state.folio}`);
    assert.equal(after.folio.balance, '99.99');
  });

  await step('Konaklama vergisi ayarı ve süresi dolan opsiyon', async () => {
    const codes = await api('GET', '/api/v1/finance/transaction-codes');
    const room = codes.find(c => c.code === 'ROOM');
    assert.ok(codes.find(c => c.code === 'KV' && c.isSystem), 'KV sistem kodu');
    await api('PUT', `/api/v1/finance/transaction-codes/${room.id}`, { code: 'ROOM', name: room.name, category: 'room', defaultPrice: null, vatRate: '10', isActive: true });
    await api('PUT', `/api/v1/finance/transaction-codes/${room.id}`, { code: 'ROOM', name: room.name, category: 'misc', defaultPrice: null, vatRate: '10', isActive: true }, { expect: 422 });
    await api('PUT', '/api/v1/property/settings/tax.accommodation_rate', 25, { expect: 422 });
    await api('PUT', '/api/v1/property/settings/tax.accommodation_rate', 2);
    await api('PUT', '/api/v1/property/settings/tax.accommodation_included', true);
    state.opt = (await api('POST', '/api/v1/reservations', { guestId: state.guest, roomTypeId: state.std, arrival: addDays(state.bd, 10), departure: addDays(state.bd, 11), adults: 1, children: 0, status: 'tentative', depositRequired: '0', optionUntil: state.bd }, { key: randomUUID() })).id;
    const pv = await api('GET', '/api/v1/night-audit/preview');
    assert.ok(pv.warnings.some(w => w.code === 'expired_option' && w.reservationId === state.opt), 'opsiyon uyarısı');
  });

  await step('Gece denetimi: engel kontrolü, tek seferlik kapanış, vergi ayrıştırma, opsiyon iptali', async () => {
    const pv = await api('GET', '/api/v1/night-audit/preview');
    assert.equal(pv.businessDate, state.bd);
    assert.equal(pv.roomChargesToPost, 1);
    const key = randomUUID();
    const body = { businessDate: state.bd, autoNoShow: true, cancelExpiredOptions: true };
    const run = await api('POST', '/api/v1/night-audit/run', body, { key });
    assert.equal(run.newBusinessDate, addDays(state.bd, 1));
    assert.equal(run.roomChargeTotal, '1500.00');
    assert.equal(run.optionsCancelled, 1);
    // 1500 dahil fiyat, KDV %10, KV %2: net = 1500 / (1,02 × 1,10); KV satırı = net × 0,02 × 1,10 = 29,41; oda satırı = 1470,59
    assert.equal(run.accommodationTaxTotal, '29.41');
    const f = await api('GET', `/api/v1/folios/${state.folio}`);
    const bdLines = f.lines.filter(l => l.businessDate === state.bd && l.lineType === 'charge');
    assert.ok(bdLines.some(l => l.transactionCode === 'ROOM' && l.amount === '1470.59'), 'oda satırı');
    assert.ok(bdLines.some(l => l.transactionCode === 'KV' && l.amount === '29.41'), 'KV satırı');
    assert.equal((await api('GET', `/api/v1/reservations/${state.opt}`)).status, 'cancelled');
    await api('POST', '/api/v1/night-audit/run', body, { key: randomUUID(), expect: 409 });
    const replay = await api('POST', '/api/v1/night-audit/run', body, { key });
    assert.equal(replay.newBusinessDate, run.newBusinessDate);
    state.bd = run.newBusinessDate;
  });

  await step('Döviz: kur girişi, dövizli tahsilat, kur yoksa red, dövizli iptal', async () => {
    await api('PUT', '/api/v1/exchange-rates/EUR', { rate: '0' }, { expect: 422 });
    await api('PUT', '/api/v1/exchange-rates/TRY', { rate: '1' }, { expect: 422 });
    await api('POST', `/api/v1/folios/${state.folio}/payments`, { paymentMethodId: state.cash, amount: '0', tenderedCurrency: 'USD', tenderedAmount: '5.00', isDeposit: false }, { key: randomUUID(), expect: 422 });
    await api('PUT', '/api/v1/exchange-rates/EUR', { rate: '37.5' });
    const v = await api('GET', '/api/v1/exchange-rates');
    assert.equal(Number(v.rates.find(r => r.currency === 'EUR').rate), 37.5);
    const p = await api('POST', `/api/v1/folios/${state.folio}/payments`, { paymentMethodId: state.cash, amount: '0', tenderedCurrency: 'EUR', tenderedAmount: '10.00', isDeposit: false }, { key: randomUUID() });
    const extra = await api('POST', `/api/v1/folios/${state.folio}/payments`, { paymentMethodId: state.cash, amount: '0', tenderedCurrency: 'EUR', tenderedAmount: '4.00', isDeposit: false }, { key: randomUUID() });
    await api('POST', `/api/v1/folio-lines/${extra.id}/void`, { reason: 'yanlış döviz' }, { key: randomUUID() });
    const f = await api('GET', `/api/v1/folios/${state.folio}`);
    const line = f.lines.find(l => l.id === p.id);
    assert.equal(line.amount, '-375.00'); assert.equal(line.tenderedCurrency, 'EUR'); assert.equal(line.tenderedAmount, '-10.00');
    assert.equal(f.folio.balance, '1224.99');
  });

  await step('Bakiyeli check-out engellenir; tahsilat sonrası check-out', async () => {
    let r = await api('GET', `/api/v1/reservations/${state.res}`);
    await api('POST', `/api/v1/reservations/${state.res}/check-out`, { version: r.version, lateCheckOut: false }, { key: randomUUID(), expect: 409 });
    const f = await api('GET', `/api/v1/folios/${state.folio}`);
    await api('POST', `/api/v1/folios/${state.folio}/payments`, { paymentMethodId: state.cash, amount: f.folio.balance, isDeposit: false }, { key: randomUUID() });
    r = await api('GET', `/api/v1/reservations/${state.res}`);
    await api('POST', `/api/v1/reservations/${state.res}/check-out`, { version: r.version, lateCheckOut: false }, { key: randomUUID() });
    const rooms = await api('GET', '/api/v1/rooms');
    assert.equal(rooms.find(x => x.number === '101').hkStatus, 'dirty');
    r = await api('GET', `/api/v1/reservations/${state.res}`);
    assert.equal(r.status, 'checked_out'); assert.equal(r.departure, state.bd); assert.equal(r.balance, '0.00');
  });

  await step('Kasa kapanışı: TL ve döviz ayrı sayılır', async () => {
    await api('POST', '/api/v1/cashier/close', { countedCash: '1324.99' }, { key: randomUUID(), expect: 422 }); // EUR sayımı eksik
    const close = await api('POST', '/api/v1/cashier/close', { countedCash: '1324.99', countedForeign: { EUR: '9.00' } }, { key: randomUUID() });
    assert.equal(close.expected, '1324.99'); // 100 açılış + 1224.99 TL nakit (375 TL karşılığı 10 EUR olarak alındı)
    assert.equal(close.difference, '0.00');
    const rep = await api('GET', `/api/v1/cashier/shifts/${close.id}`);
    const eur = rep.cash.find(c => c.currency === 'EUR');
    assert.equal(eur.expected, '10.00'); assert.equal(eur.counted, '9.00'); assert.equal(eur.difference, '-1.00');
  });

  await step('Optimistic concurrency: eski sürümle güncelleme reddedilir', async () => {
    const g = (await api('GET', `/api/v1/guests/${state.guest}`)).guest;
    const upd = { ...g, notes: 'not 1', version: g.version };
    await api('PUT', `/api/v1/guests/${state.guest}`, upd);
    await api('PUT', `/api/v1/guests/${state.guest}`, { ...upd, notes: 'not 2' }, { expect: 409 });
  });

  await step('Realtime: oda durumu değişikliği WebSocket ile yayınlanır', async () => {
    const wsUrl = base.replace('https', 'wss') + '/api/v1/realtime';
    const ws = new WebSocket(wsUrl, { headers: { Authorization: 'Bearer ' + token } });
    const got = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('realtime mesajı gelmedi')), 8000);
      ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.type === 'change' && m.topic === 'rooms') { clearTimeout(t); resolve(m); } };
      ws.onerror = e => { clearTimeout(t); reject(new Error('ws hata')); };
    });
    await new Promise((res, rej) => { ws.onopen = res; setTimeout(() => rej(new Error('ws açılamadı')), 5000); });
    const rooms = await api('GET', '/api/v1/rooms');
    const r = rooms.find(x => x.number === '101');
    await api('POST', `/api/v1/rooms/${r.id}/housekeeping`, { hkStatus: 'clean', isDnd: false, version: r.version });
    await got;
    ws.close();
  });

  await step('Raporlar ve dışa aktarma (CSV/XLSX)', async () => {
    const occ = await api('GET', `/api/v1/reports/occupancy?from=${addDays(state.bd, -1)}&to=${state.bd}`);
    assert.equal(occ.rows[0].source, 'Gerçekleşen'); assert.equal(occ.rows[0].roomRevenue, '1470.59'); // konaklama vergisi oda gelirine dahil değil
    const csv = await api('GET', `/api/v1/reports/cashier/export?format=csv&from=${addDays(state.bd, -1)}&to=${state.bd}`, undefined, { raw: true });
    assert.equal(csv.status, 200); const text = await csv.text(); assert.ok(text.includes('Nakit'));
    const xlsx = await api('GET', `/api/v1/reports/inhouse/export?format=xlsx`, undefined, { raw: true });
    assert.equal(xlsx.status, 200); const buf = new Uint8Array(await xlsx.arrayBuffer()); assert.equal(buf[0], 0x50);
  });

  await step('Yedekleme', async () => {
    const b = await api('POST', '/api/v1/backups');
    const list = await api('GET', '/api/v1/backups');
    const rec = list.find(x => x.id === b.id);
    assert.equal(rec.status, 'completed'); assert.ok(Number(rec.sizeBytes) > 1000);
  });

  await step('CSV misafir aktarımı: ; ayırıcı, Windows-1254, mükerrer tespiti, rollback', async () => {
    const valid = tckn(12345678);
    const rows = [
      'ADI;SOYADI;TC NO;TELEFON;EPOSTA;UYRUK;DOĞUM TARİHİ;CİNSİYET',
      `Çağrı;Işıkoğlu;${valid};0532 111 22 33;;TÜRKİYE;01.02.1985;E`,
      `Gülşen;Öztürk;${tckn(23456789)};05321234567;gulsen@example.invalid;TR;15.03.1990;K`,
      `Gülşen;Öztürk;${tckn(23456789)};;;TR;15.03.1990;K`,
      `;Eksikad;;;;;;`,
      `Ümit;Şahin;;;bozuk-eposta;ALMANYA;31.02.1980;X`,
    ].join('\r\n');
    const enc = new TextEncoder();
    // Windows-1254 kodlaması (Türkçe ANSI): ı=FD, ş=FE, ğ=F0, İ=DD, Ş=DE, Ğ=D0
    const map = { 'ı': 0xFD, 'ş': 0xFE, 'ğ': 0xF0, 'İ': 0xDD, 'Ş': 0xDE, 'Ğ': 0xD0, 'ç': 0xE7, 'Ç': 0xC7, 'ö': 0xF6, 'Ö': 0xD6, 'ü': 0xFC, 'Ü': 0xDC };
    const bytes = [...rows].flatMap(ch => map[ch] ? [map[ch]] : [...enc.encode(ch)]);
    const form = new FormData();
    form.append('entity', 'guests');
    form.append('file', new Blob([new Uint8Array(bytes)]), 'eski-pms-misafir.csv');
    const ins = await api('POST', '/api/v1/imports/file', undefined, { form });
    assert.equal(ins.inspection.detectedSeparator, ';');
    assert.equal(ins.inspection.detectedEncoding, 'windows-1254');
    assert.ok(ins.inspection.columns.includes('DOĞUM TARİHİ'));
    const sugg = Object.fromEntries(ins.suggestions.filter(s => s.source).map(s => [s.target, s.source]));
    assert.equal(sugg.first_name, 'ADI'); assert.equal(sugg.last_name, 'SOYADI'); assert.equal(sugg.tckn, 'TC NO'); assert.equal(sugg.birth_date, 'DOĞUM TARİHİ');
    const mapping = ins.suggestions.filter(s => s.source).map(s => ({ source: s.source, target: s.target, transform: 'none' }));
    const job = await api('POST', `/api/v1/imports/${ins.job.id}/stage`, { source: { headerRow: 1 }, mapping, duplicatePolicy: 'review' });
    assert.equal(job.totalRows, 5);
    assert.equal(job.failedRows, 1);       // ad eksik
    assert.equal(job.reviewRows, 2);       // mevcut misafirle aynı TC + dosya içi tekrar
    const rowsRes = await api('GET', `/api/v1/imports/${ins.job.id}/rows?pageSize=50`);
    const umit = rowsRes.items.find(r => r.rowNo === 5);
    assert.equal(umit.status, 'valid');
    assert.ok(umit.errors.includes('E-posta'));
    await api('POST', `/api/v1/imports/${ins.job.id}/decisions`, { decision: 'skip' });
    await api('POST', `/api/v1/imports/${ins.job.id}/execute`, undefined, { expect: 202 });
    let j;
    for (let i = 0; i < 60; i++) { j = await api('GET', `/api/v1/imports/${ins.job.id}`); if (!['importing'].includes(j.status)) break; await new Promise(r => setTimeout(r, 500)); }
    assert.equal(j.status, 'completed_with_errors', JSON.stringify(j));
    assert.equal(j.importedRows, 2);
    assert.ok(j.backupId);
    const imported = await api('GET', '/api/v1/guests?q=' + encodeURIComponent('Öztürk'));
    assert.equal(imported.total, 1); assert.equal(imported.items[0].firstName, 'Gülşen');
    const umitG = await api('GET', '/api/v1/guests?q=' + encodeURIComponent('Şahin'));
    const prof = await api('GET', `/api/v1/guests/${umitG.items[0].id}`);
    assert.equal(prof.guest.nationality, 'DE');
    assert.ok(prof.guest.notes.includes('bozuk-eposta'), 'kaybolmayan orijinal değer nota eklenmeli');
    // Aktarılan misafirlerden birini değiştir: rollback onu silmemeli.
    const g = prof.guest;
    await api('PUT', `/api/v1/guests/${g.id}`, { ...g, notes: g.notes + ' (değiştirildi)', version: g.version });
    const rb = await api('POST', `/api/v1/imports/${ins.job.id}/rollback`);
    assert.equal(rb.deleted, 1); assert.equal(rb.blocked, 1);
    const after = await api('GET', '/api/v1/guests?q=' + encodeURIComponent('Öztürk'));
    assert.equal(after.total, 0);
    const still = await api('GET', '/api/v1/guests?q=' + encodeURIComponent('Şahin'));
    assert.equal(still.total, 1);
  });

  await step('Eski muhasebe: vergi no ile şirket aktarımı ve cari hareketleri (borç/alacak) + rollback', async () => {
    const upload = async (entity, name, text) => {
      const form = new FormData();
      form.append('entity', entity);
      form.append('file', new Blob([new TextEncoder().encode('\uFEFF' + text)]), name);
      return api('POST', '/api/v1/imports/file', undefined, { form });
    };
    const run = async (ins, mapping) => {
      const job = await api('POST', `/api/v1/imports/${ins.job.id}/stage`, { source: { headerRow: 1 }, mapping, duplicatePolicy: 'review' });
      await api('POST', `/api/v1/imports/${ins.job.id}/execute`, undefined, { expect: 202 });
      let j;
      for (let i = 0; i < 60; i++) { j = await api('GET', `/api/v1/imports/${ins.job.id}`); if (j.status !== 'importing') break; await new Promise(r => setTimeout(r, 500)); }
      return { staged: job, done: j };
    };
    const comp = await upload('companies', 'cariler.csv', 'CARİ KODU;ÜNVAN;VERGİ DAİRESİ;VERGİ NO\r\nC001;Örnek Turizm Ltd. Şti.;Kadıköy;1234567890\r\n');
    const cm = comp.suggestions.filter(s => s.source).map(s => ({ source: s.source, target: s.target, transform: 'none' }));
    const cr = await run(comp, cm);
    assert.equal(cr.done.status, 'completed', JSON.stringify(cr.done));
    const ledger = await upload('account_ledger', 'cari-hareket.csv',
      'VKN;TARİH;B/A;AÇIKLAMA;TUTAR;FİŞ NO\r\n1234567890;05.01.2029;B;Konaklama faturası;12.500,75;F-1\r\n1234567890;20.01.2029;A;Havale tahsilat;10.000,00;T-1\r\n9999999999;21.01.2029;B;Bilinmeyen cari;100,00;F-2\r\n');
    const sugg = Object.fromEntries(ledger.suggestions.filter(s => s.source).map(s => [s.target, s.source]));
    assert.equal(sugg.account_ref, 'VKN'); assert.equal(sugg.amount, 'TUTAR');
    const lm = [
      { source: null, target: 'account_kind', transform: 'none', constant: 'Şirket' },
      { source: 'VKN', target: 'account_ref', transform: 'none' },
      { source: 'TARİH', target: 'date', transform: 'none', format: 'dd.MM.yyyy' },
      { source: 'B/A', target: 'kind', transform: 'none' },
      { source: 'AÇIKLAMA', target: 'description', transform: 'none' },
      { source: 'TUTAR', target: 'amount', transform: 'none', format: 'tr' },
      { source: null, target: 'payment_method', transform: 'none', constant: 'BANK' },
      { source: 'FİŞ NO', target: 'reference', transform: 'none' },
    ];
    const lr = await run(ledger, lm);
    assert.equal(lr.done.importedRows, 2); assert.equal(lr.done.failedRows, 1);
    const comps = await api('GET', '/api/v1/companies?q=' + encodeURIComponent('Örnek'));
    assert.equal(comps[0].taxNumber, '1234567890');
    assert.equal(comps[0].balance, '2500.75');
    const rb = await api('POST', `/api/v1/imports/${ledger.job.id}/rollback`);
    assert.equal(rb.blocked, 0);
    const after = await api('GET', '/api/v1/companies?q=' + encodeURIComponent('Örnek'));
    assert.equal(after[0].balance, '0.00');
  });

  await step('XLSX geçersiz dosya reddedilir', async () => {
    const form = new FormData();
    form.append('entity', 'guests');
    form.append('file', new Blob([new TextEncoder().encode('bu bir excel değil')]), 'bozuk.xlsx');
    await api('POST', '/api/v1/imports/file', undefined, { form, expect: 422 });
  });

  await step('Grup rezervasyonu: toplu oda, tamamı-ya-da-hiçbiri, oda listesi misafir değişimi', async () => {
    const grp = (await api('POST', '/api/v1/groups', { name: 'E2E Grubu', contactName: 'Sorumlu' }, { key: randomUUID() })).id;
    const a = addDays(state.bd, 30), d = addDays(state.bd, 32);
    // Yalnız 2 STD oda var: 3 oda istenirse hiçbiri oluşturulmaz.
    await api('POST', `/api/v1/groups/${grp}/rooms`, { guestId: state.guest, roomTypeId: state.std, count: 3, arrival: a, departure: d, adults: 1, children: 0, status: 'tentative', depositRequired: '0' }, { key: randomUUID(), expect: 409 });
    let list = await api('GET', `/api/v1/reservations?groupId=${grp}&view=all`);
    assert.equal(list.total, 0, 'başarısız toplu eklemede oda oluşmamalı');
    const r = await api('POST', `/api/v1/groups/${grp}/rooms`, { guestId: state.guest, roomTypeId: state.std, count: 2, arrival: a, departure: d, adults: 1, children: 0, status: 'confirmed', depositRequired: '0' }, { key: randomUUID() });
    assert.equal(r.ids.length, 2);
    list = await api('GET', `/api/v1/reservations?groupId=${grp}&view=all`);
    assert.equal(list.total, 2);
    const groups = await api('GET', '/api/v1/groups');
    assert.equal(groups.find(x => x.id === grp).rooms, 2);
    // Oda listesi: ilk odanın misafiri gerçek kişiyle değişir, sorumlu kişi odadan çıkar.
    const other = (await api('POST', '/api/v1/guests', { firstName: 'Oda', lastName: 'Listesi', nationality: 'DE', identityType: 'passport', identityNumber: 'C01X00T47', isVip: false, kvkkConsent: true, marketingConsent: false })).id;
    const res = await api('GET', `/api/v1/reservations/${r.ids[0]}`);
    await api('PUT', `/api/v1/reservations/${res.id}`, { guestId: other, newGuest: null, companyId: null, agencyId: null, groupId: grp, roomTypeId: res.roomTypeId, roomId: null, arrival: res.arrival, departure: res.departure, adults: 1, children: 0, ratePlanId: null, nightlyRate: null, mealPlan: res.mealPlan, status: 'confirmed', source: res.source, market: null, segment: null, eta: null, etd: null, notes: res.notes, specialRequests: null, depositRequired: '0', optionUntil: null, version: res.version }, { key: randomUUID() });
    const sharers = await api('GET', `/api/v1/reservations/${res.id}/guests`);
    assert.deepEqual(sharers.map(s => s.id), [other]);
    // Overbooking yalnız açık onayla: yönetici bile onaysız aşım yapamaz.
    const ob = { guestId: state.guest, roomTypeId: state.std, arrival: a, departure: d, adults: 1, children: 0, status: 'confirmed', depositRequired: '0' };
    await api('POST', '/api/v1/reservations', ob, { key: randomUUID(), expect: 409 });
    const over = (await api('POST', '/api/v1/reservations', { ...ob, allowOverbook: true }, { key: randomUUID() })).id;
    r.ids.push(over);
    for (const id of r.ids) { const x = await api('GET', `/api/v1/reservations/${id}`); await api('POST', `/api/v1/reservations/${id}/cancel`, { reason: 'test temizliği', version: x.version }, { key: randomUUID() }); }
  });

  await step('Belgeler: PNG yükleme, listeleme, indirme; sahte uzantı reddedilir', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const form = new FormData();
    form.append('entityType', 'guest'); form.append('entityId', state.guest); form.append('category', 'identity');
    form.append('file', new Blob([png], { type: 'image/png' }), 'kimlik.png');
    await api('POST', '/api/v1/documents', undefined, { form });
    const docs = await api('GET', `/api/v1/documents?entityType=guest&entityId=${state.guest}`);
    assert.equal(docs.length, 1); assert.equal(docs[0].mimeType, 'image/png');
    const c = await api('GET', `/api/v1/documents/${docs[0].id}/content`, undefined, { raw: true });
    assert.equal(c.status, 200);
    assert.equal(Buffer.from(await c.arrayBuffer()).length, png.length);
    const bad = new FormData();
    bad.append('entityType', 'guest'); bad.append('entityId', state.guest);
    bad.append('file', new Blob([Buffer.from('bu bir resim değil')], { type: 'image/png' }), 'sahte.png');
    await api('POST', '/api/v1/documents', undefined, { form: bad, expect: 422 });
  });

  await step('Rol yetkileri: resepsiyon ve kat görevlisi günlük işlerini yapabilir, yetkisiz işler reddedilir', async () => {
    const adminToken = token;
    const rooms = await api('GET', '/api/v1/rooms');
    const room = rooms.find(r => r.number === '102');
    // Resepsiyon
    token = '';
    await api('POST', '/api/v1/auth/login', { username: 'e2erecep', password: 'Resepsiyon456', deviceId, deviceKind: 'browser' });
    await api('POST', `/api/v1/rooms/${room.id}/housekeeping`, { hkStatus: 'dirty', isDnd: false, version: room.version });
    const r2 = (await api('GET', '/api/v1/rooms')).find(r => r.id === room.id);
    await api('POST', `/api/v1/rooms/${room.id}/housekeeping`, { hkStatus: 'inspected', isDnd: false, version: r2.version }, { expect: 403 });
    await api('POST', '/api/v1/maintenance/tickets', { roomId: room.id, issue: 'Musluk damlatıyor', priority: 'normal', blockRoom: false });
    await api('POST', '/api/v1/maintenance/tickets', { roomId: room.id, issue: 'Klima', priority: 'high', blockRoom: true, blockFrom: addDays(state.bd, 20), blockTo: addDays(state.bd, 21), blockKind: 'out_of_order' }, { expect: 403 });
    await api('GET', '/api/v1/kbs/reports');
    await api('PUT', '/api/v1/property/settings/night_audit.auto_no_show', true, { expect: 403 });
    // Kat görevlisi
    token = adminToken;
    await api('POST', '/api/v1/users', { username: 'e2ehk', fullName: 'E2E Kat Görevlisi', password: 'KatGorev123', roles: ['HOUSEKEEPING'] });
    token = '';
    await api('POST', '/api/v1/auth/login', { username: 'e2ehk', password: 'KatGorev123', deviceId, deviceKind: 'browser' });
    await api('POST', '/api/v1/auth/change-password', { currentPassword: 'KatGorev123', newPassword: 'KatGorev456' });
    await api('POST', '/api/v1/auth/login', { username: 'e2ehk', password: 'KatGorev456', deviceId, deviceKind: 'browser' });
    const r3 = (await api('GET', '/api/v1/rooms')).find(r => r.id === room.id);
    await api('POST', `/api/v1/rooms/${room.id}/housekeeping`, { hkStatus: 'clean', isDnd: false, version: r3.version });
    await api('POST', '/api/v1/maintenance/tickets', { roomId: room.id, issue: 'Ampul yanmıyor', priority: 'low', blockRoom: false });
    await api('GET', '/api/v1/reservations', undefined, { expect: 403 });
    await api('GET', '/api/v1/folios', undefined, { expect: 403 });
    token = adminToken;
  });

  await step('Stok: depo, kart, tedarikçi, sipariş, mal kabul, çıkış, transfer, sayım, iptal, ortalama maliyet', async () => {
    const k = () => ({ key: randomUUID() });
    state.w1 = (await api('POST', '/api/v1/stock/warehouses', { code: 'ANA', name: 'Ana Depo', isActive: true })).id;
    state.w2 = (await api('POST', '/api/v1/stock/warehouses', { code: 'BAR', name: 'Bar Deposu', isActive: true })).id;
    await api('POST', '/api/v1/stock/warehouses', { code: 'ANA', name: 'Tekrar', isActive: true }, { expect: 409 });
    state.item = (await api('POST', '/api/v1/stock/items', { code: 'KOLA-33', name: 'Kola 33 cl', unit: 'adet', category: 'İçecek', minQty: '24', vatRate: '20', isActive: true })).id;
    const sup = (await api('POST', '/api/v1/stock/suppliers', { name: 'E2E Tedarikçi Çığ', taxNumber: '1234567890', isActive: true })).id;
    await api('POST', '/api/v1/stock/suppliers', { name: 'Geçersiz', taxNumber: '12AB', isActive: true }, { expect: 422 });
    const po = await api('POST', '/api/v1/purchase-orders', { supplierId: sup, warehouseId: state.w1, lines: [{ itemId: state.item, quantity: '48', unitCost: '10.00', vatRate: '20' }] }, k());
    let d = await api('GET', `/api/v1/purchase-orders/${po.id}`);
    assert.equal(d.order.status, 'draft'); assert.equal(d.order.total, '576.00');
    const recv = qty => ({ warehouseId: state.w1, supplierId: sup, purchaseOrderId: po.id, invoiceNo: 'A-1', lines: [{ itemId: state.item, quantity: qty, unitCost: '10.0000', purchaseOrderLineId: d.lines[0].id }] });
    await api('POST', '/api/v1/stock/receipts', recv('24'), { ...k(), expect: 422 }); // taslak siparişe mal kabul yapılamaz
    await api('POST', `/api/v1/purchase-orders/${po.id}/send`, { version: d.order.version }, k());
    const r1 = await api('POST', '/api/v1/stock/receipts', recv('24'), k());
    d = await api('GET', `/api/v1/purchase-orders/${po.id}`);
    assert.equal(d.order.status, 'partially_received'); assert.equal(Number(d.lines[0].receivedQty), 24);
    await api('POST', '/api/v1/stock/receipts', { warehouseId: state.w1, supplierId: sup, lines: [{ itemId: state.item, quantity: '24', unitCost: '12' }] }, k());
    const bal = async w => (await api('GET', `/api/v1/stock/balances?warehouseId=${w}`)).find(x => x.itemId === state.item);
    let b = await bal(state.w1);
    assert.equal(Number(b.quantity), 48); assert.equal(Number(b.avgCost), 11); // (24×10 + 24×12) / 48
    await api('POST', '/api/v1/stock/issues', { warehouseId: state.w1, department: 'Kat hizmetleri', lines: [{ itemId: state.item, quantity: '100' }] }, { ...k(), expect: 422 });
    await api('POST', '/api/v1/stock/issues', { warehouseId: state.w1, department: 'Kat hizmetleri', lines: [{ itemId: state.item, quantity: '6' }] }, k());
    await api('POST', '/api/v1/stock/transfers', { warehouseId: state.w1, targetWarehouseId: state.w2, lines: [{ itemId: state.item, quantity: '12' }] }, k());
    const cnt = await api('POST', '/api/v1/stock/counts', { warehouseId: state.w2, lines: [{ itemId: state.item, countedQuantity: '11' }] }, k());
    assert.equal(cnt.adjusted, 1);
    await api('POST', '/api/v1/stock/counts', { warehouseId: state.w2, lines: [{ itemId: state.item, countedQuantity: '11' }] }, { ...k(), expect: 422 }); // fark yok
    await api('POST', `/api/v1/stock/documents/${r1.id}/cancel`, { reason: 'Hatalı fatura' }, k());
    await api('POST', `/api/v1/stock/documents/${r1.id}/cancel`, { reason: 'tekrar' }, { ...k(), expect: 422 });
    d = await api('GET', `/api/v1/purchase-orders/${po.id}`);
    assert.equal(d.order.status, 'ordered'); assert.equal(Number(d.lines[0].receivedQty), 0);
    b = await bal(state.w1);
    assert.equal(Number(b.quantity), 6); // 48 − 6 − 12 − 24
    assert.equal(Number((await bal(state.w2)).quantity), 11);
    const mv = await api('GET', `/api/v1/stock/items/${state.item}/movements`);
    assert.ok(mv.some(m => m.isReversal), 'iptal ters hareketi');
    const low = await api('GET', '/api/v1/stock/balances?lowOnly=true');
    assert.ok(low.some(x => x.itemId === state.item), 'asgari stok altı listede');
    const rep = await api('GET', `/api/v1/reports/stock_movements?from=${state.bd}&to=${state.bd}`);
    assert.ok(rep.rows.length >= 6);
  });

  await step('Restoran: menü, reçete, adisyon, iptal, indirim, odaya aktarma, ödeme, ikram, stok tüketimi, kasa', async () => {
    const k = () => ({ key: randomUUID() });
    state.dlx = (await api('POST', '/api/v1/room-types', { code: 'DLX', name: 'Deluxe', maxAdults: 2, maxChildren: 1, defaultRate: '2500.00', sortOrder: 2, isActive: true })).id;
    for (const n of ['201', '202', '203']) state['room' + n] = (await api('POST', '/api/v1/rooms', { roomTypeId: state.dlx, number: n, floor: '2', sortOrder: Number(n), isActive: true })).id;
    for (const r of (await api('GET', '/api/v1/rooms')).filter(x => x.roomTypeId === state.dlx))
      await api('POST', `/api/v1/rooms/${r.id}/housekeeping`, { hkStatus: 'clean', isDnd: false, version: r.version });
    state.inhouse = (await api('POST', '/api/v1/reservations', { guestId: state.guest, roomTypeId: state.dlx, arrival: state.bd, departure: addDays(state.bd, 2), adults: 1, children: 0, status: 'confirmed', depositRequired: '0' }, k())).id;
    const rv = await api('GET', `/api/v1/reservations/${state.inhouse}`);
    await api('POST', `/api/v1/reservations/${state.inhouse}/check-in`, { roomId: state.room201, earlyCheckIn: false, version: rv.version }, k());

    const fb = (await api('POST', '/api/v1/finance/transaction-codes', { code: 'REST', name: 'Restoran', category: 'food_beverage', vatRate: '10', isActive: true })).id;
    const roomCode = (await api('GET', '/api/v1/finance/transaction-codes')).find(c => c.code === 'ROOM').id;
    await api('POST', '/api/v1/pos/outlets', { code: 'X', name: 'Hatalı', transactionCodeId: roomCode, sortOrder: 1, isActive: true }, { expect: 422 });
    state.outlet = (await api('POST', '/api/v1/pos/outlets', { code: 'REST', name: 'Restoran', transactionCodeId: fb, warehouseId: state.w2, sortOrder: 1, isActive: true })).id;
    const kola = (await api('POST', '/api/v1/pos/products', { code: 'KOLA', name: 'Kola', category: 'İçecekler', price: '60.00', vatRate: '20', sortOrder: 1, isActive: true, outletIds: [] })).id;
    const corba = (await api('POST', '/api/v1/pos/products', { code: 'MERCIMEK', name: 'Mercimek Çorbası', category: 'Çorbalar', price: '150.00', vatRate: '10', sortOrder: 1, isActive: true, outletIds: [state.outlet] })).id;
    await api('PUT', `/api/v1/pos/products/${kola}/recipe`, { lines: [{ stockItemId: state.item, quantity: '1' }] });
    const menu = await api('GET', `/api/v1/pos/products?outletId=${state.outlet}`);
    assert.equal(menu.length, 2); assert.equal(menu.find(m => m.id === kola).recipeItems, 1);

    // 1) Odaya aktarma: 2 kola + 1 çorba = 270; 20 indirim → 250; KDV gruplarına oransal dağıtım
    let c = await api('POST', '/api/v1/pos/checks', { outletId: state.outlet, tableLabel: '5', covers: 2 }, k());
    const cid = c.check.id;
    await api('POST', `/api/v1/pos/checks/${cid}/lines`, { productId: kola, quantity: '2' }, k());
    c = await api('POST', `/api/v1/pos/checks/${cid}/lines`, { productId: corba, quantity: '1' }, k());
    const extra = await api('POST', `/api/v1/pos/checks/${cid}/lines`, { productId: corba, quantity: '1', note: 'yanlış' }, k());
    const wrong = extra.lines.find(l => l.note === 'yanlış');
    c = await api('POST', `/api/v1/pos/check-lines/${wrong.id}/void`, { reason: 'Yanlış tuşlama' }, k());
    assert.equal(c.check.subtotal, '270.00');
    await api('POST', `/api/v1/pos/checks/${cid}/discount`, { amount: '300.00', reason: 'fazla', version: c.check.version }, { ...k(), expect: 422 });
    c = await api('POST', `/api/v1/pos/checks/${cid}/discount`, { amount: '20.00', reason: 'Sadakat', version: c.check.version }, k());
    assert.equal(c.check.total, '250.00');
    c = await api('POST', `/api/v1/pos/checks/${cid}/close`, { settlement: 'room', reservationId: state.inhouse, version: c.check.version }, k());
    assert.equal(c.check.status, 'closed'); assert.equal(c.check.roomNumber, '201');
    const folios = await api('GET', `/api/v1/folios?reservationId=${state.inhouse}`);
    const fd = await api('GET', `/api/v1/folios/${folios[0].id}`);
    const posLines = fd.lines.filter(l => l.reference === `ADS-${c.check.checkNo}`);
    assert.deepEqual(posLines.map(l => l.amount).sort(), ['111.11', '138.89']);
    const barQty = async () => Number((await api('GET', `/api/v1/stock/balances?warehouseId=${state.w2}`)).find(x => x.itemId === state.item).quantity);
    assert.equal(await barQty(), 9); // 11 − 2 kola (reçete)

    // 2) Ödemeyle kapanış: nakit TL + EUR; kasa vardiyası gerekir
    let c2 = await api('POST', '/api/v1/pos/checks', { outletId: state.outlet, tableLabel: 'Bar', covers: 1 }, k());
    c2 = await api('POST', `/api/v1/pos/checks/${c2.check.id}/lines`, { productId: corba, quantity: '2' }, k());
    const pay = [{ paymentMethodId: state.cash, amount: '262.50' }, { paymentMethodId: state.cash, amount: '0', tenderedCurrency: 'EUR', tenderedAmount: '1.00' }];
    await api('POST', `/api/v1/pos/checks/${c2.check.id}/close`, { settlement: 'payment', payments: pay, version: c2.check.version }, { ...k(), expect: 422 }); // vardiya yok
    await api('POST', '/api/v1/cashier/open', { openingFloat: '0' }, k());
    await api('POST', `/api/v1/pos/checks/${c2.check.id}/close`, { settlement: 'payment', payments: [pay[0]], version: c2.check.version }, { ...k(), expect: 422 }); // eksik ödeme
    c2 = await api('POST', `/api/v1/pos/checks/${c2.check.id}/close`, { settlement: 'payment', payments: pay, version: c2.check.version }, k());
    assert.equal(c2.check.paid, '300.00'); assert.equal(c2.payments.length, 2);
    const shift = await api('GET', '/api/v1/cashier/current');
    let sr = await api('GET', `/api/v1/cashier/shifts/${shift.id}`);
    assert.equal(sr.cash.find(x => x.currency === 'TRY').expected, '262.50');
    assert.equal(sr.cash.find(x => x.currency === 'EUR').expected, '1.00');

    // 3) İkram: önce tamamına indirim gerekir
    let c3 = await api('POST', '/api/v1/pos/checks', { outletId: state.outlet, covers: 1 }, k());
    c3 = await api('POST', `/api/v1/pos/checks/${c3.check.id}/lines`, { productId: kola, quantity: '1' }, k());
    await api('POST', `/api/v1/pos/checks/${c3.check.id}/close`, { settlement: 'complimentary', version: c3.check.version }, { ...k(), expect: 422 });
    c3 = await api('POST', `/api/v1/pos/checks/${c3.check.id}/discount`, { amount: '60.00', reason: 'Müdür ikramı', version: c3.check.version }, k());
    c3 = await api('POST', `/api/v1/pos/checks/${c3.check.id}/close`, { settlement: 'complimentary', version: c3.check.version }, k());
    assert.equal(c3.check.total, '0.00');
    assert.equal(await barQty(), 8);

    // 4) Kapanmış adisyonların iptali: folyo satırları iptal, ödeme ters kaydı, stok geri
    c = await api('GET', `/api/v1/pos/checks/${cid}`);
    await api('POST', `/api/v1/pos/checks/${cid}/cancel`, { reason: 'Misafir itiraz etti', version: c.check.version }, k());
    const fd2 = await api('GET', `/api/v1/folios/${folios[0].id}`);
    assert.ok(fd2.lines.filter(l => l.reference === `ADS-${c.check.checkNo}`).every(l => l.isVoided));
    assert.equal(await barQty(), 10);
    c2 = await api('GET', `/api/v1/pos/checks/${c2.check.id}`);
    await api('POST', `/api/v1/pos/checks/${c2.check.id}/cancel`, { reason: 'Yanlış masa', version: c2.check.version }, k());
    sr = await api('GET', `/api/v1/cashier/shifts/${shift.id}`);
    assert.equal(sr.cash.find(x => x.currency === 'TRY').expected, '0.00');

    // 5) Açık adisyon gece denetiminde uyarı; boş adisyonu açan kapatabilir
    const c4 = await api('POST', '/api/v1/pos/checks', { outletId: state.outlet, covers: 1 }, k());
    const pv = await api('GET', '/api/v1/night-audit/preview');
    assert.ok(pv.warnings.some(w => w.code === 'open_pos_check'));
    await api('POST', `/api/v1/pos/checks/${c4.check.id}/cancel`, { reason: 'Boş', version: c4.check.version }, k());

    // 6) Restoran personeli: adisyon açar, kendi yanlış satırını iptal eder; indirim ve başkasının satırını iptal edemez
    await api('POST', '/api/v1/users', { username: 'e2egarson', fullName: 'E2E Garson', password: 'Garson12345', roles: ['RESTAURANT'] });
    const adminToken = token;
    const other = await api('POST', '/api/v1/pos/checks', { outletId: state.outlet, covers: 1 }, k());
    const otherLine = (await api('POST', `/api/v1/pos/checks/${other.check.id}/lines`, { productId: kola, quantity: '1' }, k())).lines[0];
    token = '';
    await api('POST', '/api/v1/auth/login', { username: 'e2egarson', password: 'Garson12345', deviceId, deviceKind: 'browser' });
    await api('POST', '/api/v1/auth/change-password', { currentPassword: 'Garson12345', newPassword: 'Garson67890' });
    await api('POST', '/api/v1/auth/login', { username: 'e2egarson', password: 'Garson67890', deviceId, deviceKind: 'browser' });
    let g = await api('POST', '/api/v1/pos/checks', { outletId: state.outlet, tableLabel: '7', covers: 2 }, k());
    g = await api('POST', `/api/v1/pos/checks/${g.check.id}/lines`, { productId: kola, quantity: '1' }, k());
    g = await api('POST', `/api/v1/pos/check-lines/${g.lines[0].id}/void`, { reason: 'Yanlış ürün' }, k());
    assert.ok(g.lines[0].isVoid);
    await api('POST', `/api/v1/pos/check-lines/${otherLine.id}/void`, { reason: 'x' }, { ...k(), expect: 403 });
    await api('POST', `/api/v1/pos/checks/${g.check.id}/discount`, { amount: '0', version: g.check.version }, { ...k(), expect: 403 });
    await api('POST', '/api/v1/pos/products', { code: 'X', name: 'x', category: 'x', price: '1', vatRate: '0', sortOrder: 0, isActive: true }, { expect: 403 });
    await api('GET', '/api/v1/reservations', undefined, { expect: 403 });
    const rooms = await api('GET', '/api/v1/pos/in-house');
    assert.ok(rooms.some(r => r.roomNumber === '201'));
    token = adminToken;
    await api('POST', `/api/v1/pos/checks/${other.check.id}/cancel`, { reason: 'Test', version: (await api('GET', `/api/v1/pos/checks/${other.check.id}`)).check.version }, k());
    await api('POST', `/api/v1/pos/checks/${g.check.id}/cancel`, { reason: 'Test', version: (await api('GET', `/api/v1/pos/checks/${g.check.id}`)).check.version }, k());
    const sales = await api('GET', `/api/v1/reports/pos_sales?from=${state.bd}&to=${state.bd}`);
    assert.equal(sales.rows.length, 1); assert.equal(sales.rows[0].complimentary, '60.00');
  });

  await step('Acente kontenjanı: envanter sınırı, diğer satışlara kapalı kontenjan, acente kullanımı, çakışma', async () => {
    const k = () => ({ key: randomUUID() });
    const ag = (await api('POST', '/api/v1/agencies', { name: 'E2E Acente', isCityLedger: false, isActive: true })).id;
    const d1 = addDays(state.bd, 3), d2 = addDays(state.bd, 4), d3 = addDays(state.bd, 6);
    const base = { agencyId: ag, roomTypeId: state.dlx, dateFrom: d1, dateTo: d3, releaseDays: 1, isActive: true };
    await api('POST', '/api/v1/allotments', { ...base, rooms: 4 }, { ...k(), expect: 409 }); // 3 oda var
    const al = await api('POST', '/api/v1/allotments', { ...base, rooms: 2 }, k());
    await api('POST', '/api/v1/allotments', { ...base, rooms: 1 }, { ...k(), expect: 409 }); // çakışan aktif kontenjan
    let av = await api('GET', `/api/v1/availability?from=${d1}&to=${d2}&roomTypeId=${state.dlx}`);
    assert.equal(av[0].held, 2); assert.equal(av[0].available, 1);
    av = await api('GET', `/api/v1/availability?from=${d1}&to=${d2}&roomTypeId=${state.dlx}&agencyId=${ag}`);
    assert.equal(av[0].held, 0); assert.equal(av[0].available, 3);
    const res = extra => ({ guestId: state.guest, roomTypeId: state.dlx, arrival: d1, departure: d2, adults: 1, children: 0, status: 'confirmed', depositRequired: '0', ...extra });
    await api('POST', '/api/v1/reservations', res({}), k());                                   // doğrudan satış: son serbest oda
    await api('POST', '/api/v1/reservations', res({}), { ...k(), expect: 409 });               // kalan 2 oda kontenjanda
    await api('POST', '/api/v1/reservations', res({ agencyId: ag }), k());                     // acente kendi kontenjanını kullanır
    await api('POST', '/api/v1/reservations', res({ agencyId: ag }), k());
    await api('POST', '/api/v1/reservations', res({ agencyId: ag }), { ...k(), expect: 409 }); // oda kalmadı
    const usage = await api('GET', `/api/v1/allotments/${al.id}/usage`);
    assert.equal(usage[0].used, 2); assert.equal(usage[0].remaining, 0);
    assert.equal(usage[1].used, 0); assert.equal(usage[1].remaining, 2);
    const list = await api('GET', `/api/v1/allotments?agencyId=${ag}`);
    assert.equal(list[0].usedRoomNights, 2); assert.equal(list[0].totalRoomNights, 6);
    const rep = await api('GET', `/api/v1/reports/allotment_usage?from=${d1}&to=${d3}`);
    assert.equal(rep.rows.length, 3);
  });

  await step('Mutfak yazıcısı: deneme fişi, sipariş gönderimi, iptal fişi, ulaşılamayan yazıcı', async () => {
    const k = () => ({ key: randomUUID() });
    const received = [];
    const srv = net.createServer(s => { const chunks = []; s.on('data', d => chunks.push(d)); s.on('end', () => received.push(Buffer.concat(chunks))); });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const waitFor = async n => { for (let i = 0; i < 50 && received.length < n; i++) await new Promise(r => setTimeout(r, 50)); assert.equal(received.length, n); };
    try {
      await api('POST', '/api/v1/pos/printers', { name: 'Mutfak', host: 'bad host!', port: 9100, codePage: 'PC857', lineWidth: 42, isActive: true }, { expect: 422 });
      const pr = (await api('POST', '/api/v1/pos/printers', { name: 'Mutfak', host: '127.0.0.1', port: srv.address().port, codePage: 'PC857', lineWidth: 42, isActive: true })).id;
      await api('POST', `/api/v1/pos/printers/${pr}/test`, {});
      await waitFor(1);
      assert.ok(received[0].includes(Buffer.from([0x1b, 0x74, 13])), 'PC857 kod sayfası komutu');
      assert.ok(received[0].includes(Buffer.from([0x1d, 0x56, 66, 0])), 'kesme komutu');

      const products = await api('GET', `/api/v1/pos/products?outletId=${state.outlet}`);
      const corba = products.find(x => x.code === 'MERCIMEK'), kola = products.find(x => x.code === 'KOLA');
      await api('PUT', `/api/v1/pos/products/${corba.id}`, { code: corba.code, name: corba.name, category: corba.category, price: corba.price, vatRate: corba.vatRate,
        sortOrder: corba.sortOrder, isActive: true, outletIds: corba.outletIds, version: corba.version, printerId: pr });
      let c = await api('POST', '/api/v1/pos/checks', { outletId: state.outlet, tableLabel: '12', covers: 3 }, k());
      const id = c.check.id;
      await api('POST', `/api/v1/pos/checks/${id}/lines`, { productId: corba.id, quantity: '2', note: 'Acısız' }, k());
      await api('POST', `/api/v1/pos/checks/${id}/lines`, { productId: kola.id, quantity: '1' }, k());
      let s = await api('POST', `/api/v1/pos/checks/${id}/send`, {});
      assert.deepEqual(s.sent, ['Mutfak']); assert.equal(s.lines, 1); assert.equal(s.failed.length, 0);
      await waitFor(2);
      assert.ok(received[1].includes(Buffer.from('Mercimek')) && received[1].includes(Buffer.from('MASA 12')) && received[1].includes(Buffer.from('Ac')), 'sipariş fişi içeriği');
      assert.ok(!received[1].includes(Buffer.from('Kola')), 'yazıcısız ürün fişe girmez');
      s = await api('POST', `/api/v1/pos/checks/${id}/send`, {});
      assert.equal(s.lines, 0);
      const line = s.detail.lines.find(l => l.productId === corba.id);
      assert.ok(line.sentAt && line.printable);
      await api('POST', `/api/v1/pos/check-lines/${line.id}/void`, { reason: 'Misafir vazgeçti' }, k());
      s = await api('POST', `/api/v1/pos/checks/${id}/send`, {});
      assert.equal(s.lines, 1);
      await waitFor(3);
      assert.ok(received[2].includes(Buffer.from('PTAL')), 'iptal fişi');

      // Ulaşılamayan yazıcı: satır gönderilmemiş kalır, hata bildirilir
      const closed = net.createServer(); await new Promise(r => closed.listen(0, '127.0.0.1', r)); const deadPort = closed.address().port; await new Promise(r => closed.close(r));
      const bar = (await api('POST', '/api/v1/pos/printers', { name: 'Bar', host: '127.0.0.1', port: deadPort, codePage: 'ASCII', lineWidth: 32, isActive: true })).id;
      await api('PUT', `/api/v1/pos/products/${kola.id}`, { code: kola.code, name: kola.name, category: kola.category, price: kola.price, vatRate: kola.vatRate,
        sortOrder: kola.sortOrder, isActive: true, outletIds: kola.outletIds, version: kola.version, printerId: bar });
      await api('POST', `/api/v1/pos/checks/${id}/lines`, { productId: kola.id, quantity: '1' }, k());
      s = await api('POST', `/api/v1/pos/checks/${id}/send`, {});
      assert.equal(s.failed.length, 1); assert.equal(s.failed[0].printer, 'Bar');
      assert.ok(s.detail.lines.filter(l => l.productId === kola.id && !l.isVoid).some(l => !l.sentAt), 'gönderilemeyen satır bekler');
      c = await api('GET', `/api/v1/pos/checks/${id}`);
      await api('POST', `/api/v1/pos/checks/${id}/cancel`, { reason: 'Test', version: c.check.version }, k());
    } finally { srv.close(); }
  });

  await step('Dövizli fiyat: EUR fiyat planı, elle EUR fiyat, kur yoksa red, gece denetiminde günün kuruyla oda ücreti', async () => {
    const k = () => ({ key: randomUUID() });
    const plan = (await api('POST', '/api/v1/rate-plans', { code: 'ACENTE-EUR', name: 'Acente EUR', mealPlan: 'BB', isActive: true, currency: 'EUR' })).id;
    const plans = await api('GET', '/api/v1/rate-plans');
    assert.equal(plans.find(x => x.id === plan).currency, 'EUR');
    const body = extra => ({ guestId: state.guest, roomTypeId: state.dlx, arrival: state.bd, departure: addDays(state.bd, 2), adults: 1, children: 0, status: 'confirmed', depositRequired: '0', ...extra });
    await api('POST', '/api/v1/reservations', body({ rateCurrency: 'USD', nightlyRate: '90.00' }), { ...k(), expect: 422 }); // USD kuru yok
    await api('POST', '/api/v1/reservations', body({ rateCurrency: 'EUR' }), { ...k(), expect: 422 });                     // EUR fiyat yok
    await api('POST', '/api/v1/reservations', body({ ratePlanId: plan }), { ...k(), expect: 422 });                          // planda fiyat tanımlı değil
    const id = (await api('POST', '/api/v1/reservations', body({ rateCurrency: 'EUR', nightlyRate: '100.00' }), k())).id;
    let r = await api('GET', `/api/v1/reservations/${id}`);
    assert.equal(r.rateCurrency, 'EUR'); assert.equal(r.fxNightlyRate, '100.00'); assert.equal(r.nightlyRate, '3750.00'); // 100 × 37,5 (tahmini)
    await api('POST', `/api/v1/reservations/${id}/check-in`, { roomId: state.room202, earlyCheckIn: false, version: r.version }, k());
    const pv = await api('GET', '/api/v1/night-audit/preview?autoNoShow=true');
    assert.ok(!pv.blockers.some(b => b.code === 'exchange_rate_missing'));
    const run = await api('POST', '/api/v1/night-audit/run', { businessDate: state.bd, autoNoShow: true }, k());
    const folios = await api('GET', `/api/v1/folios?reservationId=${id}`);
    const lines = (await api('GET', `/api/v1/folios/${folios[0].id}`)).lines.filter(l => l.lineType === 'charge' && l.businessDate === state.bd);
    const sum = f => lines.reduce((s, l) => s + Number(f(l)), 0).toFixed(2);
    assert.equal(sum(l => l.amount), '3750.00');           // 100 EUR × 37,5 (KV dahil, iki satır)
    assert.equal(sum(l => l.tenderedAmount), '100.00');    // döviz tutarı satırlara bölünür
    assert.ok(lines.every(l => l.tenderedCurrency === 'EUR' && Number(l.exchangeRate) === 37.5));
    state.bd = run.newBusinessDate;
    // Yeni günde EUR kuru 3 güne kadar geçerli; daha eski kurla rezervasyon reddedilir
    await api('POST', '/api/v1/reservations', body({ arrival: state.bd, departure: addDays(state.bd, 1), rateCurrency: 'EUR', nightlyRate: '80.00' }), k());
  });

  await step('Audit kaydı silinemez/değiştirilemez (uygulama yetkisiyle)', async () => {
    const logs = await api('GET', '/api/v1/audit-logs?pageSize=5');
    assert.ok(logs.length > 0);
  });
} catch {
  // ayrıntı yukarıda
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} adım geçti`);
process.exit(failed.length ? 1 : 0);
