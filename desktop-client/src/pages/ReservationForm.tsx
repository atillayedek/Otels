import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, X } from 'lucide-react';
import { api, ApiError, get, newKey, qs } from '../lib/api';
import type { ExchangeRatesView, RatePreview, Reservation } from '../lib/types';
import { addDays, fmtDate, fmtMoney, fmtQty, fmtRate, MEAL_LABEL, nightsBetween, SOURCE_LABEL } from '../lib/format';
import { useAgencies, useChannels, useCompanies, useRatePlans, useRoomStatus, useRoomTypes } from '../lib/queries';
import { useSession } from '../lib/session';
import { PageHead, useAction } from '../components/common';
import { ErrorBox, Field, Modal, MoneyInput, useConfirm } from '../components/ui';
import { draftToBody, emptyGuest, GuestFields, type GuestDraft } from '../components/GuestFields';
import { GuestSearch } from '../components/GuestSearch';
import { useWinSelf, useWindows } from '../components/Windows';

type Mode = 'new' | 'walkin' | 'edit';

interface Draft {
  roomTypeId: string; roomId: string; arrival: string; departure: string; adults: number; children: number; ratePlanId: string; nightlyRate: string; overrideRate: boolean; rateCurrency: string;
  channel: string; channelRef: string;
  mealPlan: string; companyId: string; agencyId: string; source: string; status: string; optionUntil: string; eta: string; etd: string; notes: string; specialRequests: string; depositRequired: string;
  /** Kişi sayısına göre fiyat (Tek/Çift/Üç/Dört): açıksa yetişkin sayısına göre gecelik fiyat otomatik seçilir. */
  useOcc: boolean; sgl: string; dbl: string; trp: string; quad: string;
}

/** Yetişkin sayısına karşılık gelen kişi fiyatı (4 ve üstü dört kişilik). */
const occRate = (d: Pick<Draft, 'sgl' | 'dbl' | 'trp' | 'quad'>, adults: number) => (adults <= 1 ? d.sgl : adults === 2 ? d.dbl : adults === 3 ? d.trp : d.quad);
const OCC_LABEL = (adults: number) => (adults <= 1 ? 'tek kişilik' : adults === 2 ? 'çift kişilik' : adults === 3 ? 'üç kişilik' : 'dört kişilik');

export function ReservationEditor({ mode, initial, onSaved, params }: { mode: Mode; initial?: Reservation; onSaved: (id: string) => void; params?: Record<string, string> }) {
  const [sp] = useSearchParams();
  // Pencerede açılınca ilk değerler (oda, tip, tarih) adres yerine pencere parametrelerinden gelir.
  const param = (k: string) => params?.[k] ?? sp.get(k);
  const { property, can } = useSession();
  const qc = useQueryClient();
  const bd = property?.businessDate ?? '';
  const types = useRoomTypes();
  const plans = useRatePlans();
  const companies = useCompanies();
  const agencies = useAgencies();
  const channels = useChannels();
  const status = useRoomStatus();
  const confirm = useConfirm();

  const [guest, setGuest] = useState<{ id: string; name: string; blacklisted?: boolean } | null>(initial ? { id: initial.guestId, name: initial.guestName } : null);
  const [newGuest, setNewGuest] = useState<GuestDraft | null>(null);
  const [d, setD] = useState<Draft>(() => initial ? {
    roomTypeId: initial.roomTypeId, roomId: initial.roomId ?? '', arrival: initial.arrival, departure: initial.departure, adults: initial.adults, children: initial.children,
    ratePlanId: initial.ratePlanId ?? '', nightlyRate: initial.rateCurrency ? initial.fxNightlyRate ?? '' : initial.nightlyRate, overrideRate: false, rateCurrency: initial.rateCurrency ?? '', channel: initial.channel ?? '', channelRef: initial.channelRef ?? '', mealPlan: initial.mealPlan, companyId: initial.companyId ?? '', agencyId: initial.agencyId ?? '',
    source: initial.source, status: initial.status, optionUntil: initial.optionUntil ?? '', eta: initial.eta?.slice(0, 5) ?? '', etd: initial.etd?.slice(0, 5) ?? '', notes: initial.notes ?? '',
    specialRequests: initial.specialRequests ?? '', depositRequired: initial.depositRequired,
    useOcc: [initial.rateSgl, initial.rateDbl, initial.rateTrp, initial.rateQuad].some(v => v != null),
    sgl: initial.rateSgl ?? '', dbl: initial.rateDbl ?? '', trp: initial.rateTrp ?? '', quad: initial.rateQuad ?? '',
  } : {
    roomTypeId: param('type') ?? '', roomId: param('room') ?? '', arrival: mode === 'walkin' ? bd : (param('arrival') ?? bd), departure: addDays(mode === 'walkin' ? bd : (param('arrival') ?? bd), 1),
    adults: 1, children: 0, ratePlanId: '', nightlyRate: '', overrideRate: false, rateCurrency: '', channel: '', channelRef: '', mealPlan: 'RO', companyId: '', agencyId: '', source: mode === 'walkin' ? 'walk_in' : 'direct',
    status: 'confirmed', optionUntil: '', eta: '', etd: '', notes: '', specialRequests: '', depositRequired: '0.00',
    useOcc: false, sgl: '', dbl: '', trp: '', quad: '',
  });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(s => ({ ...s, [k]: v }));
  const nights = d.arrival && d.departure ? nightsBetween(d.arrival, d.departure) : 0;

  // Odası seçilmişse oda tipini odaya göre belirle.
  useEffect(() => {
    if (!d.roomId || !status.data) return;
    const room = status.data.find(r => r.id === d.roomId);
    if (room && room.roomTypeId !== d.roomTypeId) setD(s => ({ ...s, roomTypeId: room.roomTypeId }));
  }, [d.roomId, d.roomTypeId, status.data]);

  const preview = useQuery({
    queryKey: ['ratePrices', 'preview', d.roomTypeId, d.ratePlanId, d.arrival, d.departure, guest?.id],
    queryFn: () => get<RatePreview>(`/api/v1/rates/preview${qs({ roomTypeId: d.roomTypeId, ratePlanId: d.ratePlanId || null, arrival: d.arrival, departure: d.departure, guestId: guest?.id ?? null })}`),
    enabled: !!d.roomTypeId && nights > 0,
  });

  const plan = plans.data?.find(p => p.id === d.ratePlanId);
  useEffect(() => { if (plan) setD(s => ({ ...s, mealPlan: plan.mealPlan, rateCurrency: plan.currency ?? '' })); }, [plan]);
  // Dövizli fiyat: kurlar (yetki yoksa döviz seçeneği gösterilmez).
  const fx = useQuery({ queryKey: ['exchangeRates'], queryFn: () => get<ExchangeRatesView>('/api/v1/exchange-rates'), enabled: can('folio.view'), retry: false });
  const foreign = !!d.rateCurrency;
  const priceCur = d.rateCurrency || property?.currency;
  const fxRate = foreign ? fx.data?.rates.find(r => r.currency === d.rateCurrency)?.rate : undefined;
  // Döviz seçildi ama plan bu dövizde değilse fiyat elle girilmelidir.
  const needsManual = foreign && (plan?.currency ?? '') !== d.rateCurrency;

  // Kişi sayısı fiyatı: yetişkin sayısı değişince gecelik fiyat buna göre seçilir; "elle belirle" işaretliyse elle girilen fiyat geçerlidir.
  const occ = d.useOcc ? occRate(d, d.adults) : '';
  const hadOcc = !!initial && [initial.rateSgl, initial.rateDbl, initial.rateTrp, initial.rateQuad].some(v => v != null);

  const rooms = useMemo(() => (status.data ?? []).filter(r => r.roomTypeId === d.roomTypeId && !r.blockKind && (mode !== 'walkin' || r.foStatus === 'vacant' || r.id === d.roomId)), [status.data, d.roomTypeId, d.roomId, mode]);

  const save = useAction(async (key: string) => {
    const n = (v: string) => (v === '' ? null : v);
    const body = {
      guestId: guest?.id ?? null, newGuest: guest ? null : newGuest ? draftToBody(newGuest) : null,
      companyId: n(d.companyId), agencyId: n(d.agencyId), groupId: initial?.groupId ?? null, roomTypeId: d.roomTypeId, roomId: n(d.roomId),
      arrival: d.arrival, departure: d.departure, adults: d.adults, children: d.children, ratePlanId: n(d.ratePlanId),
      nightlyRate: (d.overrideRate || (needsManual && !occ)) && d.nightlyRate ? d.nightlyRate : null, rateCurrency: d.rateCurrency || null, channel: d.channel || null, channelRef: d.channel && d.channelRef.trim() ? d.channelRef.trim() : null, mealPlan: d.mealPlan, status: mode === 'walkin' ? 'confirmed' : d.status,
      source: d.source, market: initial?.market ?? null, segment: initial?.segment ?? null, eta: d.eta ? `${d.eta}:00` : null, etd: d.etd ? `${d.etd}:00` : null,
      notes: n(d.notes), specialRequests: n(d.specialRequests), depositRequired: d.depositRequired || '0', optionUntil: d.status === 'tentative' ? n(d.optionUntil) : null,
      version: initial?.version ?? null,
      // Tablo kapatılırsa boş gönderilir (kayıtlı tablo silinir); hiç kullanılmadıysa gönderilmez.
      occupancy: d.useOcc ? { single: n(d.sgl), double: n(d.dbl), triple: n(d.trp), quad: n(d.quad) } : hadOcc ? { single: null, double: null, triple: null, quad: null } : null,
    };
    const send = async (b: typeof body & { allowOverbook?: boolean }, k: string): Promise<string> => {
      if (mode === 'walkin') return (await api<{ id: string }>('POST', '/api/v1/reservations/walk-in', { reservation: b, roomId: d.roomId }, { key: k })).id;
      if (mode === 'edit') { await api('PUT', `/api/v1/reservations/${initial!.id}`, b, { key: k }); return initial!.id; }
      return (await api<{ id: string }>('POST', '/api/v1/reservations', b, { key: k })).id;
    };
    let id: string;
    try { id = await send(body, key); }
    catch (e) {
      // Müsaitlik yoksa: yalnız yetkili kullanıcıya açık onayla overbooking sorulur, onaylanırsa yeni anahtarla tekrar gönderilir.
      if (!(e instanceof ApiError && e.code === 'no_availability' && can('reservation.overbook'))) throw e;
      const ok = await confirm({ title: 'Müsaitlik yok', message: <>{e.message}<br /><br />Bu oda tipinde seçilen tarihlerde boş oda kalmadı. Yine de kaydederseniz <b>overbooking</b> oluşur ve işlem denetim kaydına yazılır.</>, confirmText: 'Overbooking yap', danger: true });
      if (!ok) throw e;
      id = await send({ ...body, allowOverbook: true }, newKey());
    }
    await qc.invalidateQueries({ predicate: q => ['reservations', 'reservation', 'rack', 'roomStatus', 'dashboard', 'availability'].includes(String(q.queryKey[0])) });
    return id;
  }, { success: mode === 'walkin' ? 'Walk-in giriş tamamlandı.' : mode === 'edit' ? 'Rezervasyon güncellendi.' : 'Rezervasyon oluşturuldu.' });

  const guestOk = !!guest || (!!newGuest && newGuest.firstName.trim() && newGuest.lastName.trim());
  const valid = guestOk && d.roomTypeId && nights >= 1 && d.adults >= 1 && (mode !== 'walkin' || d.roomId) && (!(d.overrideRate || needsManual) || !!d.nightlyRate || (!d.overrideRate && !!occ));

  return (
    <div className="split">
      <div className="stack">
        <div className="card">
          <div className="card-head"><h3>Misafir</h3>
            {guest && (mode !== 'edit' || initial?.status === 'tentative' || initial?.status === 'confirmed') && <div className="right"><button className="btn sm ghost" onClick={() => setGuest(null)}><X /> Değiştir</button></div>}
            {newGuest && <div className="right"><button className="btn sm ghost" onClick={() => setNewGuest(null)}><X /> Kayıtlı misafir seç</button></div>}
          </div>
          <div className="card-body">
            {guest ? <div className="row"><b>{guest.name}</b>{guest.blacklisted && <span className="badge red">Kara listede</span>}</div>
              : newGuest ? <>
                <GuestFields value={newGuest} onChange={setNewGuest} compact />
                {mode === 'walkin' && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Girişte kimlik bilgisi zorunludur.</div>}
              </>
              : <GuestSearch onPick={g => setGuest({ id: g.id, name: `${g.firstName} ${g.lastName}`, blacklisted: g.isBlacklisted })} onNew={seed => setNewGuest({ ...emptyGuest(), ...seed })} />}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Konaklama</h3></div>
          <div className="card-body form-grid">
            <Field label="Giriş" required><input type="date" className="input" value={d.arrival} disabled={mode === 'walkin' || initial?.status === 'checked_in'} onChange={e => set('arrival', e.target.value)} /></Field>
            <Field label="Çıkış" required hint={nights > 0 ? `${nights} gece` : 'Çıkış girişten sonra olmalı'}><input type="date" className="input" value={d.departure} min={d.arrival} onChange={e => set('departure', e.target.value)} /></Field>
            <Field label="Yetişkin" required><input type="number" min={1} max={20} className="input" value={d.adults} onChange={e => set('adults', Number(e.target.value))} /></Field>
            <Field label="Çocuk"><input type="number" min={0} max={20} className="input" value={d.children} onChange={e => set('children', Number(e.target.value))} /></Field>
            <Field label="Oda tipi" required className="span-2">
              <select className="input" value={d.roomTypeId} disabled={initial?.status === 'checked_in'} onChange={e => setD(s => ({ ...s, roomTypeId: e.target.value, roomId: '' }))}>
                <option value="">Seçin</option>{types.data?.filter(t => t.isActive).map(t => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
              </select>
            </Field>
            <Field label={mode === 'walkin' ? 'Oda' : 'Oda (isteğe bağlı)'} required={mode === 'walkin'} className="span-2">
              <select className="input" value={d.roomId} disabled={initial?.status === 'checked_in'} onChange={e => set('roomId', e.target.value)}>
                <option value="">{mode === 'walkin' ? 'Seçin' : 'Oda atanmadı'}</option>
                {rooms.map(r => <option key={r.id} value={r.id}>{r.number}{r.foStatus === 'occupied' ? ' (dolu)' : ''}</option>)}
              </select>
            </Field>
            <Field label="Tahmini geliş saati"><input type="time" className="input" value={d.eta} onChange={e => set('eta', e.target.value)} /></Field>
            <Field label="Tahmini çıkış saati"><input type="time" className="input" value={d.etd} onChange={e => set('etd', e.target.value)} /></Field>
            {mode !== 'walkin' && <Field label="Durum"><select className="input" value={d.status} disabled={mode === 'edit' && !['tentative', 'confirmed'].includes(d.status)} onChange={e => set('status', e.target.value)}>
              <option value="confirmed">Onaylı</option><option value="tentative">Opsiyon</option>
              {mode === 'edit' && !['tentative', 'confirmed'].includes(d.status) && <option value={d.status}>{d.status}</option>}
            </select></Field>}
            {d.status === 'tentative' && <Field label="Opsiyon bitişi"><input type="date" className="input" value={d.optionUntil} onChange={e => set('optionUntil', e.target.value)} /></Field>}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Hesap ve notlar</h3></div>
          <div className="card-body form-grid">
            <Field label="Şirket" className="span-2"><select className="input" value={d.companyId} onChange={e => set('companyId', e.target.value)}><option value="">—</option>{companies.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Acente" className="span-2"><select className="input" value={d.agencyId} onChange={e => set('agencyId', e.target.value)}><option value="">—</option>{agencies.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Satış kanalı" hint="Booking.com, Expedia, HotelRunner vb. üzerinden gelen rezervasyon"><select className="input" value={d.channel}
              onChange={e => setD(s => ({ ...s, channel: e.target.value, channelRef: e.target.value ? s.channelRef : '', source: e.target.value && e.target.value !== 'website' ? 'ota' : e.target.value === 'website' ? 'web' : s.source === 'ota' ? 'direct' : s.source }))}>
              <option value="">Doğrudan / acente</option>{channels.data?.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
            {d.channel && <Field label="Kanal rezervasyon no" hint="Aynı numara ikinci kez girilemez"><input className="input mono" value={d.channelRef} onChange={e => set('channelRef', e.target.value)} maxLength={60} /></Field>}
            <Field label="Kaynak"><select className="input" value={d.source} onChange={e => set('source', e.target.value)}>{Object.entries(SOURCE_LABEL).filter(([k]) => k !== 'migration' || d.source === 'migration').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="İstenen depozito"><MoneyInput value={d.depositRequired} onChange={v => set('depositRequired', v)} /></Field>
            <Field label="Özel istekler" className="span-2"><input className="input" value={d.specialRequests} onChange={e => set('specialRequests', e.target.value)} maxLength={1000} /></Field>
            <Field label="Notlar" className="span-4"><textarea className="input" rows={2} value={d.notes} onChange={e => set('notes', e.target.value)} maxLength={4000} /></Field>
          </div>
        </div>
      </div>

      <div className="stack" style={{ position: 'sticky', top: 0 }}>
        <div className="card">
          <div className="card-head"><h3>Fiyat</h3></div>
          <div className="card-body stack">
            <Field label="Fiyat planı"><select className="input" value={d.ratePlanId} onChange={e => set('ratePlanId', e.target.value)}><option value="">Oda tipi varsayılan fiyatı</option>{plans.data?.filter(p => p.isActive).map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
            <Field label="Pansiyon"><select className="input" value={d.mealPlan} onChange={e => set('mealPlan', e.target.value)}>{Object.entries(MEAL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            {(fx.data?.currencies.length ?? 0) > 0 && (
              <Field label="Fiyat para birimi" hint={plan?.currency ? 'Fiyat planının para birimi' : foreign ? (fxRate ? `Bugünkü kur ${fmtRate(fxRate)} · oda ücreti her gece o günün kuruyla çevrilir` : 'Bu döviz için kur girilmemiş') : undefined}>
                <select className="input" value={d.rateCurrency} disabled={!!plan?.currency} onChange={e => setD(s => ({ ...s, rateCurrency: e.target.value, nightlyRate: '' }))}>
                  <option value="">{property?.currency}</option>{fx.data!.currencies.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
            )}
            {preview.data && !d.overrideRate && !needsManual && Number(preview.data.discountPct) > 0 && (
              <div className="info-box">Misafir kartındaki %{fmtQty(preview.data.discountPct)} konaklama indirimi gecelik fiyatlara uygulandı.</div>
            )}
            {preview.data && !d.overrideRate && !needsManual && !occ && (
              <div className="table-wrap" style={{ maxHeight: 220 }}>
                <table className="dt">
                  <thead><tr><th>Gece</th><th style={{ textAlign: 'right' }}>Fiyat</th></tr></thead>
                  <tbody>{preview.data.nights.map(n => <tr key={n.date}><td>{fmtDate(n.date)}</td><td className="num">{fmtMoney(n.rate)}</td></tr>)}</tbody>
                  <tfoot><tr><td>Toplam ({preview.data.nights.length} gece)</td><td className="num"><b>{fmtMoney(preview.data.total, preview.data.currency ?? property?.currency)}</b></td></tr></tfoot>
                </table>
              </div>
            )}
            <ErrorBox error={preview.error} />
            {can('rate.override') && <div className="occ-box">
              <label className="check"><input type="checkbox" checked={d.useOcc} onChange={e => set('useOcc', e.target.checked)} /> Kişi sayısına göre fiyat (tek / çift / üç / dört kişilik)</label>
              {d.useOcc && <>
                <div className="occ-grid">
                  <Field label="Tek (Sng)"><MoneyInput value={d.sgl} onChange={v => set('sgl', v)} /></Field>
                  <Field label="Çift (Dbl)"><MoneyInput value={d.dbl} onChange={v => set('dbl', v)} /></Field>
                  <Field label="Üç (Trp)"><MoneyInput value={d.trp} onChange={v => set('trp', v)} /></Field>
                  <Field label="Dört (Quad)"><MoneyInput value={d.quad} onChange={v => set('quad', v)} /></Field>
                </div>
                <div className={occ && !d.overrideRate ? 'info-box' : 'muted'} style={{ fontSize: 12 }}>
                  {d.overrideRate ? 'Gecelik fiyat elle belirlendi; kişi tablosu bu kayıtta kullanılmaz.'
                    : occ ? <>{d.adults} yetişkin: <b>{OCC_LABEL(d.adults)}</b> fiyat uygulanır · <b>{fmtMoney(occ, priceCur)}</b> / gece. Kişi sayısı değişirse (ek misafir eklenince de) fiyat kendiliğinden ayarlanır.</>
                    : <>{OCC_LABEL(d.adults)} fiyat boş; fiyat planı uygulanır.</>}
                </div>
              </>}
            </div>}
            {can('rate.override') && (!needsManual || d.useOcc) && <label className="check"><input type="checkbox" checked={d.overrideRate} onChange={e => set('overrideRate', e.target.checked)} /> Gecelik fiyatı elle belirle</label>}
            {(d.overrideRate || (needsManual && !occ)) && <Field label={`Gecelik fiyat (${priceCur})`} required hint={needsManual && !can('rate.override') ? 'Dövizli elle fiyat için fiyat aşımı yetkisi gerekir; aynı dövizde fiyat planı seçebilirsiniz.' : undefined}>
              <MoneyInput value={d.nightlyRate} onChange={v => set('nightlyRate', v)} /></Field>}
            {foreign && fxRate && d.nightlyRate && (d.overrideRate || needsManual) && <div className="muted" style={{ fontSize: 12 }}>≈ {fmtMoney((Number(d.nightlyRate) * Number(fxRate)).toFixed(2), property?.currency)} / gece (bugünkü kurla)</div>}
            {mode === 'edit' && initial && !d.overrideRate && <div className="muted" style={{ fontSize: 12 }}>Kayıtlı gecelik fiyat: {initial.rateCurrency ? `${fmtMoney(initial.fxNightlyRate, initial.rateCurrency)} (≈ ${fmtMoney(initial.nightlyRate, initial.currency)})` : fmtMoney(initial.nightlyRate, initial.currency)}. Tarih veya plan değişirse fiyatlar yeniden hesaplanır.</div>}
          </div>
        </div>
        <ErrorBox error={save.error} />
        <button className="btn primary" style={{ height: 40 }} disabled={!valid || save.busy} onClick={async () => { const id = await save.run(); if (id) onSaved(id); }}>
          <Save /> {save.busy ? 'Kaydediliyor…' : mode === 'walkin' ? 'Walk-in girişi yap' : mode === 'edit' ? 'Değişiklikleri kaydet' : 'Rezervasyonu oluştur'}
        </button>
      </div>
    </div>
  );
}

export function ReservationNewPage() {
  const nav = useNavigate();
  return (
    <div className="page">
      <PageHead title="Yeni Rezervasyon" />
      <ReservationEditor mode="new" onSaved={id => nav(`/reservations/${id}`)} />
    </div>
  );
}

export function WalkInPage() {
  const nav = useNavigate();
  const { property } = useSession();
  return (
    <div className="page">
      <PageHead title="Walk-in" sub={`Rezervasyonsuz gelen misafir · giriş tarihi ${fmtDate(property?.businessDate)}`} />
      <ReservationEditor mode="walkin" onSaved={id => nav(`/reservations/${id}?kbs=1`)} />
    </div>
  );
}

/** Yeni rezervasyon / walk-in penceresi (Oda Rack üzerinde açılır). Kaydedince bu pencere kapanır, konaklama penceresi açılır. */
export function ReservationNewWindow({ mode, params }: { mode: 'new' | 'walkin'; params?: Record<string, string> }) {
  const win = useWinSelf();
  const windows = useWindows();
  const nav = useNavigate();
  const { property } = useSession();
  return (
    <div className="page">
      {mode === 'walkin' && <div className="muted" style={{ marginBottom: 10 }}>Rezervasyonsuz gelen misafir · giriş tarihi {fmtDate(property?.businessDate)}</div>}
      <ReservationEditor mode={mode} params={params} onSaved={id => {
        if (windows) { win?.close(); windows.open({ kind: 'reservation', id, kbs: mode === 'walkin' }); }
        else nav(`/reservations/${id}${mode === 'walkin' ? '?kbs=1' : ''}`);
      }} />
    </div>
  );
}

export function ReservationEditModal({ reservation, onClose }: { reservation: Reservation; onClose: () => void }) {
  return (
    <Modal title={`Rezervasyonu düzenle · ${reservation.reservationNumber}`} size="xl" onClose={onClose}>
      <ReservationEditor mode="edit" initial={reservation} onSaved={onClose} />
    </Modal>
  );
}
