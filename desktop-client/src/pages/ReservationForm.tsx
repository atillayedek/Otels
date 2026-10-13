import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Crown, Save, Search, UserPlus, X } from 'lucide-react';
import { api, get, qs } from '../lib/api';
import type { GuestListItem, Paged, RatePreview, Reservation } from '../lib/types';
import { addDays, fmtDate, fmtMoney, MEAL_LABEL, nightsBetween, SOURCE_LABEL } from '../lib/format';
import { useAgencies, useCompanies, useRatePlans, useRoomStatus, useRoomTypes } from '../lib/queries';
import { useSession } from '../lib/session';
import { PageHead, useAction } from '../components/common';
import { ErrorBox, Field, Modal, MoneyInput } from '../components/ui';
import { draftToBody, emptyGuest, GuestFields, type GuestDraft } from '../components/GuestFields';

type Mode = 'new' | 'walkin' | 'edit';

interface Draft {
  roomTypeId: string; roomId: string; arrival: string; departure: string; adults: number; children: number; ratePlanId: string; nightlyRate: string; overrideRate: boolean;
  mealPlan: string; companyId: string; agencyId: string; source: string; status: string; optionUntil: string; eta: string; etd: string; notes: string; specialRequests: string; depositRequired: string;
}

function GuestPicker({ guestId, guestName, onPick, onNew }: { guestId: string; guestName: string; onPick: (g: GuestListItem) => void; onNew: () => void }) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const res = useQuery({ queryKey: ['guests', 'pick', term], queryFn: () => get<Paged<GuestListItem>>(`/api/v1/guests${qs({ q: term, pageSize: 8 })}`), enabled: term.length >= 2 });
  if (guestId) return null;
  return (
    <div className="stack">
      <div className="row">
        <Search size={15} className="muted" />
        <input className="input" style={{ flex: 1 }} placeholder="Misafir ara: ad soyad, kimlik no, telefon (en az 2 karakter)" value={q} onChange={e => setQ(e.target.value)} autoFocus />
        <button className="btn" onClick={onNew}><UserPlus /> Yeni misafir</button>
      </div>
      {guestName && <div className="muted">Seçili: {guestName}</div>}
      {term.length >= 2 && (
        <div className="table-wrap" style={{ maxHeight: 240 }}>
          <table className="dt">
            <thead><tr><th>Ad soyad</th><th>Uyruk</th><th>Kimlik</th><th>Telefon</th><th>Konaklama</th></tr></thead>
            <tbody>
              {res.data?.items.map(g => (
                <tr key={g.id} className="clickable" onClick={() => onPick(g)}>
                  <td>{g.isVip && <Crown size={12} color="var(--warning)" />} {g.firstName} {g.lastName}{g.isBlacklisted && <span className="badge red" style={{ marginLeft: 6 }}>Kara liste</span>}</td>
                  <td>{g.nationality}</td><td className="mono">{g.identityNumber}</td><td>{g.phone}</td><td>{g.stayCount}{g.lastStay ? ` · son ${fmtDate(g.lastStay)}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {res.data && res.data.items.length === 0 && <div className="empty">Eşleşen misafir yok. <button className="btn sm" onClick={onNew}>Yeni misafir oluştur</button></div>}
        </div>
      )}
    </div>
  );
}

export function ReservationEditor({ mode, initial, onSaved }: { mode: Mode; initial?: Reservation; onSaved: (id: string) => void }) {
  const [sp] = useSearchParams();
  const { property, can } = useSession();
  const qc = useQueryClient();
  const bd = property?.businessDate ?? '';
  const types = useRoomTypes();
  const plans = useRatePlans();
  const companies = useCompanies();
  const agencies = useAgencies();
  const status = useRoomStatus();

  const [guest, setGuest] = useState<{ id: string; name: string; blacklisted?: boolean } | null>(initial ? { id: initial.guestId, name: initial.guestName } : null);
  const [newGuest, setNewGuest] = useState<GuestDraft | null>(null);
  const [d, setD] = useState<Draft>(() => initial ? {
    roomTypeId: initial.roomTypeId, roomId: initial.roomId ?? '', arrival: initial.arrival, departure: initial.departure, adults: initial.adults, children: initial.children,
    ratePlanId: initial.ratePlanId ?? '', nightlyRate: initial.nightlyRate, overrideRate: false, mealPlan: initial.mealPlan, companyId: initial.companyId ?? '', agencyId: initial.agencyId ?? '',
    source: initial.source, status: initial.status, optionUntil: initial.optionUntil ?? '', eta: initial.eta?.slice(0, 5) ?? '', etd: initial.etd?.slice(0, 5) ?? '', notes: initial.notes ?? '',
    specialRequests: initial.specialRequests ?? '', depositRequired: initial.depositRequired,
  } : {
    roomTypeId: sp.get('type') ?? '', roomId: sp.get('room') ?? '', arrival: mode === 'walkin' ? bd : (sp.get('arrival') ?? bd), departure: addDays(mode === 'walkin' ? bd : (sp.get('arrival') ?? bd), 1),
    adults: 1, children: 0, ratePlanId: '', nightlyRate: '', overrideRate: false, mealPlan: 'RO', companyId: '', agencyId: '', source: mode === 'walkin' ? 'walk_in' : 'direct',
    status: 'confirmed', optionUntil: '', eta: '', etd: '', notes: '', specialRequests: '', depositRequired: '0.00',
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
    queryKey: ['ratePrices', 'preview', d.roomTypeId, d.ratePlanId, d.arrival, d.departure],
    queryFn: () => get<RatePreview>(`/api/v1/rates/preview${qs({ roomTypeId: d.roomTypeId, ratePlanId: d.ratePlanId || null, arrival: d.arrival, departure: d.departure })}`),
    enabled: !!d.roomTypeId && nights > 0,
  });

  const plan = plans.data?.find(p => p.id === d.ratePlanId);
  useEffect(() => { if (plan) setD(s => ({ ...s, mealPlan: plan.mealPlan })); }, [plan]);

  const rooms = useMemo(() => (status.data ?? []).filter(r => r.roomTypeId === d.roomTypeId && !r.blockKind && (mode !== 'walkin' || r.foStatus === 'vacant' || r.id === d.roomId)), [status.data, d.roomTypeId, d.roomId, mode]);

  const save = useAction(async (key: string) => {
    const n = (v: string) => (v === '' ? null : v);
    const body = {
      guestId: guest?.id ?? null, newGuest: guest ? null : newGuest ? draftToBody(newGuest) : null,
      companyId: n(d.companyId), agencyId: n(d.agencyId), groupId: initial?.groupId ?? null, roomTypeId: d.roomTypeId, roomId: n(d.roomId),
      arrival: d.arrival, departure: d.departure, adults: d.adults, children: d.children, ratePlanId: n(d.ratePlanId),
      nightlyRate: d.overrideRate && d.nightlyRate ? d.nightlyRate : null, mealPlan: d.mealPlan, status: mode === 'walkin' ? 'confirmed' : d.status,
      source: d.source, market: initial?.market ?? null, segment: initial?.segment ?? null, eta: d.eta ? `${d.eta}:00` : null, etd: d.etd ? `${d.etd}:00` : null,
      notes: n(d.notes), specialRequests: n(d.specialRequests), depositRequired: d.depositRequired || '0', optionUntil: d.status === 'tentative' ? n(d.optionUntil) : null,
      version: initial?.version ?? null,
    };
    let id: string;
    if (mode === 'walkin') id = (await api<{ id: string }>('POST', '/api/v1/reservations/walk-in', { reservation: body, roomId: d.roomId }, { key })).id;
    else if (mode === 'edit') { await api('PUT', `/api/v1/reservations/${initial!.id}`, body, { key }); id = initial!.id; }
    else id = (await api<{ id: string }>('POST', '/api/v1/reservations', body, { key })).id;
    await qc.invalidateQueries({ predicate: q => ['reservations', 'reservation', 'rack', 'roomStatus', 'dashboard', 'availability'].includes(String(q.queryKey[0])) });
    return id;
  }, { success: mode === 'walkin' ? 'Walk-in giriş tamamlandı.' : mode === 'edit' ? 'Rezervasyon güncellendi.' : 'Rezervasyon oluşturuldu.' });

  const guestOk = !!guest || (!!newGuest && newGuest.firstName.trim() && newGuest.lastName.trim());
  const valid = guestOk && d.roomTypeId && nights >= 1 && d.adults >= 1 && (mode !== 'walkin' || d.roomId) && (!d.overrideRate || !!d.nightlyRate);

  return (
    <div className="split">
      <div className="stack">
        <div className="card">
          <div className="card-head"><h3>Misafir</h3>
            {guest && mode !== 'edit' && <div className="right"><button className="btn sm ghost" onClick={() => setGuest(null)}><X /> Değiştir</button></div>}
            {newGuest && <div className="right"><button className="btn sm ghost" onClick={() => setNewGuest(null)}><X /> Kayıtlı misafir seç</button></div>}
          </div>
          <div className="card-body">
            {guest ? <div className="row"><b>{guest.name}</b>{guest.blacklisted && <span className="badge red">Kara listede</span>}</div>
              : newGuest ? <>
                <GuestFields value={newGuest} onChange={setNewGuest} compact />
                {mode === 'walkin' && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Girişte kimlik bilgisi zorunludur.</div>}
              </>
              : <GuestPicker guestId="" guestName="" onPick={g => setGuest({ id: g.id, name: `${g.firstName} ${g.lastName}`, blacklisted: g.isBlacklisted })} onNew={() => setNewGuest(emptyGuest())} />}
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
            {preview.data && !d.overrideRate && (
              <div className="table-wrap" style={{ maxHeight: 220 }}>
                <table className="dt">
                  <thead><tr><th>Gece</th><th style={{ textAlign: 'right' }}>Fiyat</th></tr></thead>
                  <tbody>{preview.data.nights.map(n => <tr key={n.date}><td>{fmtDate(n.date)}</td><td className="num">{fmtMoney(n.rate)}</td></tr>)}</tbody>
                  <tfoot><tr><td>Toplam ({preview.data.nights.length} gece)</td><td className="num"><b>{fmtMoney(preview.data.total, property?.currency)}</b></td></tr></tfoot>
                </table>
              </div>
            )}
            <ErrorBox error={preview.error} />
            {can('rate.override') && <label className="check"><input type="checkbox" checked={d.overrideRate} onChange={e => set('overrideRate', e.target.checked)} /> Gecelik fiyatı elle belirle</label>}
            {d.overrideRate && <Field label="Gecelik fiyat" required><MoneyInput value={d.nightlyRate} onChange={v => set('nightlyRate', v)} /></Field>}
            {mode === 'edit' && initial && !d.overrideRate && <div className="muted" style={{ fontSize: 12 }}>Kayıtlı gecelik fiyat: {fmtMoney(initial.nightlyRate, initial.currency)}. Tarih veya plan değişirse fiyatlar yeniden hesaplanır.</div>}
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
      <ReservationEditor mode="walkin" onSaved={id => nav(`/reservations/${id}`)} />
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
