import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Plus, Search, Users } from 'lucide-react';
import { api, get, qs } from '../lib/api';
import type { GuestListItem, Paged, ReservationListItem } from '../lib/types';
import { addDays, fmtDate, fmtMoney, MEAL_LABEL, nightsBetween, STATUS_BADGE, STATUS_LABEL } from '../lib/format';
import { useAgencies, useCompanies, useRatePlans, useRoomTypes } from '../lib/queries';
import { useSession } from '../lib/session';
import { Kv, PageHead, useAction } from '../components/common';
import { Badge, DataTable, Empty, ErrorBox, Field, Modal, Money, MoneyInput, Spinner, type Column } from '../components/ui';

interface GroupListItem { id: string; groupNumber: string; name: string; companyName?: string; agencyName?: string; contactName?: string; arrival?: string; departure?: string; rooms: number; inHouse: number; cancelled: number; balance: string; createdAt: string }
interface Group { id: string; groupNumber: string; name: string; companyId?: string; companyName?: string; agencyId?: string; agencyName?: string; contactName?: string; notes?: string; createdAt: string; version: number }

export default function GroupsPage() {
  const { id } = useParams();
  return id ? <GroupDetail id={id} /> : <GroupList />;
}

function GroupList() {
  const nav = useNavigate();
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [creating, setCreating] = useState(false);
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const list = useQuery({ queryKey: ['reservations', 'groups', term], queryFn: () => get<GroupListItem[]>(`/api/v1/groups${qs({ q: term })}`) });
  const cols: Column<GroupListItem>[] = [
    { key: 'groupNumber', header: 'No', width: 90, render: g => <span className="mono">{g.groupNumber}</span> },
    { key: 'name', header: 'Grup' },
    { key: 'account', header: 'Şirket / Acente', value: g => g.companyName ?? g.agencyName ?? '' },
    { key: 'contactName', header: 'Sorumlu' },
    { key: 'arrival', header: 'Giriş', width: 100, render: g => fmtDate(g.arrival) },
    { key: 'departure', header: 'Çıkış', width: 100, render: g => fmtDate(g.departure) },
    { key: 'rooms', header: 'Oda', align: 'right', width: 70 },
    { key: 'inHouse', header: 'Konaklayan', align: 'right', width: 100 },
    { key: 'balance', header: 'Bakiye', align: 'right', width: 120, render: g => <Money value={g.balance} colored /> },
  ];
  return (
    <div className="page">
      <PageHead title="Grup Rezervasyonları" actions={can('reservation.create') && <button className="btn primary" onClick={() => setCreating(true)}><Plus /> Yeni grup</button>} />
      <div className="toolbar"><Search size={15} className="muted" /><input className="input" style={{ width: 280 }} placeholder="Grup adı, no, şirket, acente" value={q} onChange={e => setQ(e.target.value)} /><span className="count">{list.data?.length ?? 0} grup</span></div>
      {list.error ? <ErrorBox error={list.error} /> : (
        <DataTable rows={list.data ?? []} columns={cols} rowKey={g => g.id} onRowClick={g => nav(`/groups/${g.id}`)} maxHeight="calc(100vh - 250px)"
          empty={<Empty icon={<Users />} title={list.isLoading ? 'Yükleniyor…' : 'Henüz grup rezervasyonu bulunmuyor.'} />} />
      )}
      {creating && <GroupModal onClose={() => setCreating(false)} onSaved={id => nav(`/groups/${id}`)} />}
    </div>
  );
}

function GroupModal({ group, onClose, onSaved }: { group?: Group; onClose: () => void; onSaved?: (id: string) => void }) {
  const qc = useQueryClient();
  const companies = useCompanies();
  const agencies = useAgencies();
  const [f, setF] = useState({ name: group?.name ?? '', companyId: group?.companyId ?? '', agencyId: group?.agencyId ?? '', contactName: group?.contactName ?? '', notes: group?.notes ?? '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(s => ({ ...s, [k]: e.target.value }));
  const save = useAction(async (key: string) => {
    const body = { name: f.name, companyId: f.companyId || null, agencyId: f.agencyId || null, contactName: f.contactName || null, notes: f.notes || null, version: group?.version ?? null };
    let id = group?.id;
    if (group) await api('PUT', `/api/v1/groups/${group.id}`, body);
    else id = (await api<{ id: string }>('POST', '/api/v1/groups', body, { key })).id;
    await qc.invalidateQueries({ queryKey: ['reservations'] });
    return id!;
  }, { success: 'Grup kaydedildi.' });
  return (
    <Modal title={group ? `Grup · ${group.groupNumber}` : 'Yeni grup'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!f.name.trim() || save.busy} onClick={async () => { const id = await save.run(); if (id) { onClose(); onSaved?.(id as string); } }}>Kaydet</button>
    </>}>
      <div className="form-grid">
        <Field label="Grup adı" required className="span-4"><input className="input" value={f.name} onChange={set('name')} autoFocus maxLength={150} /></Field>
        <Field label="Şirket" className="span-2"><select className="input" value={f.companyId} onChange={set('companyId')}><option value="">—</option>{companies.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Acente" className="span-2"><select className="input" value={f.agencyId} onChange={set('agencyId')}><option value="">—</option>{agencies.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Grup sorumlusu" className="span-4"><input className="input" value={f.contactName} onChange={set('contactName')} maxLength={150} /></Field>
        <Field label="Notlar" className="span-4"><textarea className="input" rows={3} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function GroupDetail({ id }: { id: string }) {
  const nav = useNavigate();
  const { can } = useSession();
  const [edit, setEdit] = useState(false);
  const [adding, setAdding] = useState(false);
  const grp = useQuery({ queryKey: ['reservations', 'group', id], queryFn: () => get<Group>(`/api/v1/groups/${id}`) });
  const res = useQuery({ queryKey: ['reservations', 'group', id, 'list'], queryFn: () => get<Paged<ReservationListItem & { groupId?: string }>>(`/api/v1/reservations${qs({ groupId: id, view: 'all', pageSize: 500 })}`) });
  if (grp.isLoading) return <div className="page"><Spinner /></div>;
  if (grp.error || !grp.data) return <div className="page"><ErrorBox error={grp.error} /></div>;
  const g = grp.data;
  const rows = res.data?.items ?? [];
  const active = rows.filter(r => r.status !== 'cancelled' && r.status !== 'no_show');
  const cols: Column<ReservationListItem>[] = [
    { key: 'reservationNumber', header: 'Rez. No', width: 100, render: r => <span className="mono">{r.reservationNumber}</span> },
    { key: 'guestName', header: 'Misafir', filter: true },
    { key: 'roomNumber', header: 'Oda', width: 70 },
    { key: 'roomTypeCode', header: 'Tip', width: 70 },
    { key: 'arrival', header: 'Giriş', width: 95, render: r => fmtDate(r.arrival) },
    { key: 'departure', header: 'Çıkış', width: 95, render: r => fmtDate(r.departure) },
    { key: 'pax', header: 'Kişi', width: 60, value: r => `${r.adults}+${r.children}` },
    { key: 'nightlyRate', header: 'Gecelik', align: 'right', width: 110, render: r => <Money value={r.nightlyRate} currency={r.currency} /> },
    { key: 'balance', header: 'Bakiye', align: 'right', width: 110, render: r => <Money value={r.balance} colored /> },
    { key: 'status', header: 'Durum', width: 110, render: r => <Badge color={STATUS_BADGE[r.status]}>{STATUS_LABEL[r.status]}</Badge> },
  ];
  return (
    <div className="page">
      <PageHead title={g.name} sub={<span className="mono">{g.groupNumber}</span>} actions={<>
        <button className="btn ghost" onClick={() => nav('/groups')}><ArrowLeft /> Gruplar</button>
        {can('reservation.edit') && <button className="btn" onClick={() => setEdit(true)}><Pencil /> Düzenle</button>}
        {can('reservation.create') && <button className="btn primary" onClick={() => setAdding(true)}><Plus /> Oda ekle</button>}
      </>} />
      <div className="grid cols-3" style={{ marginBottom: 14 }}>
        <div className="card"><div className="card-body"><Kv items={[['Şirket', g.companyName], ['Acente', g.agencyName], ['Sorumlu', g.contactName]]} /></div></div>
        <div className="card"><div className="card-body"><Kv items={[['Oda', active.length], ['Konaklayan', rows.filter(r => r.status === 'checked_in').length], ['İptal / no-show', rows.length - active.length]]} /></div></div>
        <div className="card"><div className="card-body"><Kv items={[['Notlar', g.notes], ['Oluşturma', fmtDate(g.createdAt)]]} /></div></div>
      </div>
      <div className="info-box" style={{ marginBottom: 10 }}>Oda listesi gelince her rezervasyonu açıp <b>Düzenle</b> ile misafirini gerçek kişiyle değiştirin; girişten önce yapılan değişiklikte sorumlu kişi o odadan çıkarılır. Ek kişiler "Ek misafirler" sekmesinden eklenir.</div>
      {res.error ? <ErrorBox error={res.error} /> : <DataTable rows={rows} columns={cols} rowKey={r => r.id} onRowClick={r => nav(`/reservations/${r.id}`)} maxHeight="calc(100vh - 380px)" empty={<Empty title={res.isLoading ? 'Yükleniyor…' : 'Bu gruba henüz oda eklenmedi.'} />} />}
      {edit && <GroupModal group={g} onClose={() => setEdit(false)} />}
      {adding && <AddRoomsModal group={g} onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddRoomsModal({ group, onClose }: { group: Group; onClose: () => void }) {
  const qc = useQueryClient();
  const { property, can } = useSession();
  const types = useRoomTypes();
  const plans = useRatePlans();
  const bd = property?.businessDate ?? '';
  const [guest, setGuest] = useState<{ id: string; name: string } | null>(null);
  const [q, setQ] = useState('');
  const guests = useQuery({ queryKey: ['guests', 'groupPick', q], queryFn: () => get<Paged<GuestListItem>>(`/api/v1/guests${qs({ q, pageSize: 8 })}`), enabled: q.trim().length >= 2 });
  const [f, setF] = useState({ roomTypeId: '', count: '1', arrival: bd, departure: addDays(bd, 1), adults: '2', children: '0', ratePlanId: '', nightlyRate: '', mealPlan: 'BB', status: 'tentative', optionUntil: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(s => ({ ...s, [k]: e.target.value }));
  const nights = nightsBetween(f.arrival, f.departure);
  const save = useAction(async (key: string) => {
    const r = await api<{ ids: string[] }>('POST', `/api/v1/groups/${group.id}/rooms`, {
      guestId: guest!.id, roomTypeId: f.roomTypeId, count: Number(f.count), arrival: f.arrival, departure: f.departure, adults: Number(f.adults), children: Number(f.children),
      ratePlanId: f.ratePlanId || null, nightlyRate: f.nightlyRate || null, mealPlan: f.mealPlan, status: f.status, depositRequired: '0', optionUntil: f.status === 'tentative' ? f.optionUntil || null : null,
    }, { key });
    await qc.invalidateQueries({ predicate: x => ['reservations', 'rack', 'availability', 'dashboard'].includes(String(x.queryKey[0])) });
    return r;
  }, { success: r => `${r.ids.length} oda gruba eklendi.` });
  const valid = guest && f.roomTypeId && Number(f.count) >= 1 && Number(f.count) <= 200 && nights >= 1 && Number(f.adults) >= 1;
  return (
    <Modal title={`Gruba oda ekle · ${group.name}`} size="lg" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!valid || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>{f.count} oda ekle</button>
    </>}>
      <div className="form-grid">
        <Field label="Odaların başlangıç misafiri (grup sorumlusu)" required className="span-4" hint="Misafir kartı yoksa önce Misafirler ekranından ekleyin. Oda listesi gelince her rezervasyonun misafiri değiştirilir.">
          {guest ? <div className="row"><b>{guest.name}</b><button className="btn sm ghost" onClick={() => setGuest(null)}>Değiştir</button></div> : (
            <div className="stack" style={{ gap: 4 }}>
              <input className="input" placeholder="Ad, soyad, telefon (en az 2 karakter)" value={q} onChange={e => setQ(e.target.value)} autoFocus />
              {guests.data?.items.map(x => <button key={x.id} className="btn sm ghost" style={{ justifyContent: 'flex-start' }} onClick={() => setGuest({ id: x.id, name: `${x.firstName} ${x.lastName}` })}>{x.firstName} {x.lastName} {x.phone ? `· ${x.phone}` : ''}</button>)}
            </div>
          )}
        </Field>
        <Field label="Oda tipi" required className="span-2"><select className="input" value={f.roomTypeId} onChange={set('roomTypeId')}><option value="">Seçin</option>{types.data?.filter(t => t.isActive).map(t => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}</select></Field>
        <Field label="Oda sayısı" required><input className="input" type="number" min={1} max={200} value={f.count} onChange={set('count')} /></Field>
        <Field label="Durum"><select className="input" value={f.status} onChange={set('status')}><option value="tentative">Opsiyon</option><option value="confirmed">Onaylı</option></select></Field>
        <Field label="Giriş" required><input type="date" className="input" value={f.arrival} onChange={set('arrival')} /></Field>
        <Field label="Çıkış" required hint={nights > 0 ? `${nights} gece` : ''}><input type="date" className="input" value={f.departure} min={f.arrival} onChange={set('departure')} /></Field>
        <Field label="Yetişkin / oda"><input className="input" type="number" min={1} value={f.adults} onChange={set('adults')} /></Field>
        <Field label="Çocuk / oda"><input className="input" type="number" min={0} value={f.children} onChange={set('children')} /></Field>
        <Field label="Fiyat planı" className="span-2"><select className="input" value={f.ratePlanId} onChange={set('ratePlanId')}><option value="">Oda tipi varsayılan fiyatı</option>{plans.data?.filter(p => p.isActive).map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
        <Field label="Pansiyon"><select className="input" value={f.mealPlan} onChange={set('mealPlan')}>{Object.entries(MEAL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        {can('rate.override') && <Field label="Gecelik grup fiyatı"><MoneyInput value={f.nightlyRate} onChange={v => setF(s => ({ ...s, nightlyRate: v }))} placeholder="Plan fiyatı" /></Field>}
        {f.status === 'tentative' && <Field label="Opsiyon bitişi"><input type="date" className="input" value={f.optionUntil} onChange={set('optionUntil')} /></Field>}
      </div>
      {f.nightlyRate && <div className="muted" style={{ marginTop: 6 }}>Toplam: {f.count} oda × {nights} gece × {fmtMoney(f.nightlyRate)}</div>}
      <ErrorBox error={save.error} />
    </Modal>
  );
}
