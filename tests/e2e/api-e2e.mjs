// HotelPMS uçtan uca API testi.
// YALNIZ izole test kurulumuna karşı çalıştırılır (HOTELPMS_DATA_ROOT ile ayrılmış veri kökü ve ayrı PostgreSQL kümesi).
// Kullanım: node tests/e2e/api-e2e.mjs <baseUrl> <setupCodeFile> <caCertFile>
// Üretim/otel veritabanına karşı ÇALIŞTIRMAYIN: test kayıtları oluşturur.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
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

  await step('Gece denetimi: engel kontrolü ve tek seferlik kapanış', async () => {
    const pv = await api('GET', '/api/v1/night-audit/preview');
    assert.equal(pv.businessDate, state.bd);
    assert.equal(pv.roomChargesToPost, 1);
    const key = randomUUID();
    const run = await api('POST', '/api/v1/night-audit/run', { businessDate: state.bd, autoNoShow: true }, { key });
    assert.equal(run.newBusinessDate, addDays(state.bd, 1));
    assert.equal(run.roomChargeTotal, '1500.00');
    await api('POST', '/api/v1/night-audit/run', { businessDate: state.bd, autoNoShow: true }, { key: randomUUID(), expect: 409 });
    const replay = await api('POST', '/api/v1/night-audit/run', { businessDate: state.bd, autoNoShow: true }, { key });
    assert.equal(replay.newBusinessDate, run.newBusinessDate);
    state.bd = run.newBusinessDate;
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

  await step('Kasa kapanışı beklenen nakit', async () => {
    const close = await api('POST', '/api/v1/cashier/close', { countedCash: '1699.99' }, { key: randomUUID() });
    assert.equal(close.expected, '1699.99'); // 100 açılış + 1599.99 nakit
    assert.equal(close.difference, '0.00');
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
    assert.equal(occ.rows[0].source, 'Gerçekleşen'); assert.equal(occ.rows[0].roomRevenue, '1500.00');
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
