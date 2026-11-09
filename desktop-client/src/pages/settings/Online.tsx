import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Check, Globe, ImagePlus, Trash2, X } from 'lucide-react';
import { api, del, get, newKey, post, upload } from '../../lib/api';
import { fmtDate, fmtDateTime, fmtMoney } from '../../lib/format';
import { useRatePlans, useRoomTypes } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { PageHead, useAction } from '../../components/common';
import { useOpenReservation } from '../../components/Windows';
import { Badge, Empty, ErrorBox, Field, Modal, Spinner, Tabs, useConfirm, useToast } from '../../components/ui';

type L = Record<string, string>;
interface OnlineConfig {
  isEnabled: boolean; codePrefix: string; ratePlanId: string | null; minLeadDays: number; maxAdvanceDays: number; maxNights: number; hotelName: string;
  phone: string | null; whatsapp: string | null; email: string | null; address: string | null; mapUrl: string | null; about: L; terms: L;
  checkinTime: string; checkoutTime: string; version: number;
}
interface RoomContent { roomTypeId: string; code: string; name: string; isListed: boolean; title: L; description: L; features: string[]; sortOrder: number; version: number; photoCount: number }
interface Photo { id: string; url: string; place: 'hero' | 'gallery' | 'room' | 'logo'; roomTypeId: string | null; caption: L; sortOrder: number }
interface Pending { id: string; reservationNumber: string; bookingCode: string; guestName: string; email?: string; phone?: string; roomTypeCode: string; arrival: string;
  departure: string; adults: number; children: number; totalRate: string; currency: string; createdAt: string; specialRequests?: string; version: number }

const PLACE_LABEL: Record<Photo['place'], string> = { hero: 'Ana sayfa (büyük görsel)', gallery: 'Galeri', room: 'Oda', logo: 'Logo' };

/** Online rezervasyon ve otel web sitesi içeriği. Veriler PMS'te kalır; web sitesi yalnız herkese açık uçlardan okur. */
export default function OnlineSettingsPage() {
  const { can } = useSession();
  const [tab, setTab] = useState<'pending' | 'settings' | 'rooms' | 'photos'>('pending');
  const pending = useQuery({ queryKey: ['online', 'pending'], queryFn: () => get<Pending[]>('/api/v1/online/pending') });
  return (
    <div className="page">
      <PageHead title="Online Rezervasyon" sub="Web sitesinden gelen talepler PMS'e 'onay bekliyor' (opsiyonlu) olarak düşer; onay veya ret burada ya da rezervasyon ekranında yapılır" />
      <Tabs value={tab} onChange={setTab} items={[
        { key: 'pending', label: 'Onay bekleyen talepler', count: pending.data?.length },
        ...(can('online.manage') ? [{ key: 'settings' as const, label: 'Ayarlar ve iletişim' }, { key: 'rooms' as const, label: 'Web odaları' }, { key: 'photos' as const, label: 'Fotoğraflar' }] : []),
      ]} />
      <div style={{ marginTop: 12 }}>
        {tab === 'pending' && <PendingList q={pending} />}
        {tab === 'settings' && <ConfigForm />}
        {tab === 'rooms' && <RoomsList />}
        {tab === 'photos' && <Photos />}
      </div>
    </div>
  );
}

function PendingList({ q }: { q: ReturnType<typeof useQuery<Pending[]>> }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const openRes = useOpenReservation();
  const { can } = useSession();
  const [reject, setReject] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const refresh = () => qc.invalidateQueries({ predicate: x => ['online', 'reservations', 'availability'].includes(String(x.queryKey[0])) });
  const approve = async (p: Pending) => {
    if (!await confirm({ title: 'Talebi onayla', message: `${p.bookingCode} · ${p.guestName} · ${fmtDate(p.arrival)}–${fmtDate(p.departure)} onaylanacak. Misafir web sitesinde "Onaylandı" görür ve artık internetten geri çekemez.`, confirmText: 'Onayla' })) return;
    try { await post(`/api/v1/online/pending/${p.id}/approve`, { version: p.version }, newKey()); toast.ok('Rezervasyon onaylandı.'); await refresh(); } catch (e) { toast.error(e); }
  };
  const doReject = useAction(async (key: string) => {
    await post(`/api/v1/online/pending/${reject!.id}/reject`, { reason: reason.trim(), version: reject!.version }, key);
    setReject(null); setReason(''); await refresh();
  }, { success: 'Talep reddedildi.' });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data?.length) return <Empty icon={<Globe />} title="Onay bekleyen web talebi yok" text="Web sitesinden yeni rezervasyon geldiğinde burada ve rezervasyon listesinde görünür." />;
  return (
    <div className="card"><div className="card-body tight">
      <table className="dt">
        <thead><tr><th>Takip kodu</th><th>Rez. no</th><th>Misafir</th><th>İletişim</th><th>Oda</th><th>Tarihler</th><th>Kişi</th><th style={{ textAlign: 'right' }}>Tutar</th><th>Geliş</th><th /></tr></thead>
        <tbody>{q.data.map(p => (
          <tr key={p.id}>
            <td className="mono">{p.bookingCode}</td><td><a href="#" onClick={e => { e.preventDefault(); openRes(p.id); }}>{p.reservationNumber}</a></td>
            <td>{p.guestName}{p.specialRequests && <div className="muted" style={{ fontSize: 12 }}>{p.specialRequests}</div>}</td>
            <td style={{ fontSize: 12 }}>{p.phone}<br />{p.email}</td><td>{p.roomTypeCode}</td><td>{fmtDate(p.arrival)} – {fmtDate(p.departure)}</td>
            <td>{p.adults}+{p.children}</td><td className="num">{fmtMoney(p.totalRate, p.currency)}</td><td className="muted" style={{ fontSize: 12 }}>{fmtDateTime(p.createdAt)}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              <button className="btn sm primary" disabled={!can('reservation.edit')} onClick={() => void approve(p)}><Check size={14} /> Onayla</button>{' '}
              <button className="btn sm danger" disabled={!can('reservation.cancel')} onClick={() => setReject(p)}><X size={14} /> Reddet</button>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
    {reject && (
      <Modal title={`Talebi reddet · ${reject.bookingCode}`} onClose={() => setReject(null)} footer={<><button className="btn" onClick={() => setReject(null)}>Vazgeç</button>
        <button className="btn danger" disabled={!reason.trim() || doReject.busy} onClick={() => void doReject.run()}>Reddet</button></>}>
        <Field label="Gerekçe (PMS'te kalır, misafire gösterilmez)" required><input className="input" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} autoFocus /></Field>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Misafir web sitesinde "Reddedildi" görür. Gerekirse telefon veya WhatsApp ile bilgi verin.</div>
        <ErrorBox error={doReject.error} />
      </Modal>
    )}
    </div>
  );
}

function LangText({ label, value, onChange, rows = 3, max }: { label: string; value: L; onChange: (v: L) => void; rows?: number; max: number }) {
  return (
    <div className="grid cols-2">
      {(['tr', 'en'] as const).map(l => (
        <Field key={l} label={`${label} (${l === 'tr' ? 'Türkçe' : 'İngilizce'})`}>
          <textarea className="input" rows={rows} maxLength={max} value={value[l] ?? ''} onChange={e => onChange({ ...value, [l]: e.target.value })} />
        </Field>
      ))}
    </div>
  );
}

function ConfigForm() {
  const qc = useQueryClient();
  const plans = useRatePlans();
  const cfg = useQuery({ queryKey: ['online', 'config'], queryFn: () => get<OnlineConfig>('/api/v1/online/config') });
  const [f, setF] = useState<OnlineConfig | null>(null);
  useEffect(() => { if (cfg.data) setF({ ...cfg.data, checkinTime: cfg.data.checkinTime.slice(0, 5), checkoutTime: cfg.data.checkoutTime.slice(0, 5) }); }, [cfg.data]);
  const save = useAction(async () => {
    await api('PUT', '/api/v1/online/config', { ...f, checkinTime: `${f!.checkinTime}:00`, checkoutTime: `${f!.checkoutTime}:00` });
    await qc.invalidateQueries({ queryKey: ['online'] });
  }, { success: 'Online rezervasyon ayarları kaydedildi.' });
  if (!f) return cfg.error ? <ErrorBox error={cfg.error} /> : <Spinner />;
  const set = <K extends keyof OnlineConfig>(k: K, v: OnlineConfig[K]) => setF(s => (s ? { ...s, [k]: v } : s));
  return (
    <div className="card"><div className="card-body stack">
      <label className="check"><input type="checkbox" checked={f.isEnabled} onChange={e => set('isEnabled', e.target.checked)} /> <b>Online rezervasyon açık</b> (kapalıyken web sitesi talep almaz)</label>
      <div className="form-grid">
        <Field label="Takip kodu ön eki" hint="Ör. CIHAN → CIHAN-8K4P7Q2M"><input className="input mono" value={f.codePrefix} maxLength={12} onChange={e => set('codePrefix', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} /></Field>
        <Field label="Fiyat planı" hint="Boşsa oda tipinin varsayılan fiyatı"><select className="input" value={f.ratePlanId ?? ''} onChange={e => set('ratePlanId', e.target.value || null)}>
          <option value="">Oda tipi varsayılan fiyatı</option>{plans.data?.filter(p => p.isActive).map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
        <Field label="En erken (gün sonra)"><input className="input" type="number" min={0} max={60} value={f.minLeadDays} onChange={e => set('minLeadDays', Number(e.target.value))} /></Field>
        <Field label="En fazla (gün ileri)"><input className="input" type="number" min={1} max={730} value={f.maxAdvanceDays} onChange={e => set('maxAdvanceDays', Number(e.target.value))} /></Field>
        <Field label="En fazla gece"><input className="input" type="number" min={1} max={90} value={f.maxNights} onChange={e => set('maxNights', Number(e.target.value))} /></Field>
        <Field label="Giriş saati"><input className="input" type="time" value={f.checkinTime} onChange={e => set('checkinTime', e.target.value)} /></Field>
        <Field label="Çıkış saati"><input className="input" type="time" value={f.checkoutTime} onChange={e => set('checkoutTime', e.target.value)} /></Field>
      </div>
      <h4>İletişim (web sitesinde görünür)</h4>
      <div className="form-grid">
        <Field label="Otel adı" className="span-2"><input className="input" value={f.hotelName} maxLength={120} onChange={e => set('hotelName', e.target.value)} /></Field>
        <Field label="Telefon"><input className="input" value={f.phone ?? ''} maxLength={40} onChange={e => set('phone', e.target.value || null)} /></Field>
        <Field label="WhatsApp" hint="Ülke koduyla, ör. 905321234567"><input className="input" value={f.whatsapp ?? ''} maxLength={20} onChange={e => set('whatsapp', e.target.value || null)} /></Field>
        <Field label="E-posta" className="span-2"><input className="input" value={f.email ?? ''} maxLength={120} onChange={e => set('email', e.target.value || null)} /></Field>
        <Field label="Harita bağlantısı (https://)" className="span-2"><input className="input" value={f.mapUrl ?? ''} maxLength={500} onChange={e => set('mapUrl', e.target.value || null)} /></Field>
        <Field label="Adres" className="span-4"><input className="input" value={f.address ?? ''} maxLength={400} onChange={e => set('address', e.target.value || null)} /></Field>
      </div>
      <LangText label="Otel tanıtımı" value={f.about} onChange={v => set('about', v)} rows={4} max={8000} />
      <LangText label="Rezervasyon ve iptal koşulları" value={f.terms} onChange={v => set('terms', v)} rows={6} max={20000} />
      <div className="row"><button className="btn primary" disabled={save.busy} onClick={() => void save.run()}>Kaydet</button></div>
      <ErrorBox error={save.error} />
    </div></div>
  );
}

function RoomsList() {
  const rooms = useQuery({ queryKey: ['online', 'rooms'], queryFn: () => get<RoomContent[]>('/api/v1/online/rooms') });
  const [edit, setEdit] = useState<RoomContent | null>(null);
  if (rooms.isLoading) return <Spinner />;
  return (
    <div className="card"><div className="card-body tight">
      <ErrorBox error={rooms.error} />
      <table className="dt"><thead><tr><th>Oda tipi</th><th>Web başlığı</th><th>Fotoğraf</th><th>Durum</th><th /></tr></thead>
        <tbody>{rooms.data?.map(r => <tr key={r.roomTypeId}><td>{r.code} · {r.name}</td><td>{r.title.tr ?? <span className="muted">—</span>}</td><td>{r.photoCount}</td>
          <td>{r.isListed ? <Badge color="green">Sitede satışta</Badge> : <Badge color="gray">Gösterilmiyor</Badge>}</td>
          <td><button className="btn sm" onClick={() => setEdit(r)}>Düzenle</button></td></tr>)}</tbody></table>
      {edit && <RoomModal r={edit} onClose={() => setEdit(null)} />}
    </div></div>
  );
}

function RoomModal({ r, onClose }: { r: RoomContent; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ isListed: r.isListed, title: r.title, description: r.description, features: r.features.join(', '), sortOrder: r.sortOrder });
  const save = useAction(async () => {
    await api('PUT', `/api/v1/online/rooms/${r.roomTypeId}`, { isListed: f.isListed, title: f.title, description: f.description,
      features: f.features.split(',').map(x => x.trim()).filter(Boolean), sortOrder: f.sortOrder, version: r.version || null });
    await qc.invalidateQueries({ queryKey: ['online'] });
  }, { success: 'Oda içeriği kaydedildi.' });
  return (
    <Modal title={`Web odası · ${r.code} ${r.name}`} size="lg" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button></>}>
      <div className="stack">
        <label className="check"><input type="checkbox" checked={f.isListed} onChange={e => setF(s => ({ ...s, isListed: e.target.checked }))} /> Web sitesinde göster ve online sat</label>
        <LangText label="Başlık" value={f.title} onChange={v => setF(s => ({ ...s, title: v }))} rows={1} max={120} />
        <LangText label="Açıklama" value={f.description} onChange={v => setF(s => ({ ...s, description: v }))} rows={4} max={4000} />
        <div className="form-grid">
          <Field label="Özellikler (virgülle)" className="span-3"><input className="input" value={f.features} onChange={e => setF(s => ({ ...s, features: e.target.value }))} placeholder="Klima, Wi-Fi, Minibar" /></Field>
          <Field label="Sıra"><input className="input" type="number" value={f.sortOrder} onChange={e => setF(s => ({ ...s, sortOrder: Number(e.target.value) }))} /></Field>
        </div>
        <ErrorBox error={save.error} />
      </div>
    </Modal>
  );
}

function Thumb({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['online', 'photo', id], queryFn: () => get<{ dataUrl: string }>(`/api/v1/online/photos/${id}/data`), staleTime: Infinity });
  return q.data ? <img src={q.data.dataUrl} alt="" style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 6 }} /> : <div style={{ height: 120 }} className="muted">…</div>;
}

function Photos() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const types = useRoomTypes();
  const photos = useQuery({ queryKey: ['online', 'photos'], queryFn: () => get<Photo[]>('/api/v1/online/photos') });
  const [place, setPlace] = useState<Photo['place']>('gallery');
  const [roomTypeId, setRoomTypeId] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const files = await openDialog({ multiple: true, filters: [{ name: 'Fotoğraf', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
    if (!files) return;
    setBusy(true);
    let ok = 0;
    try {
      for (const fp of Array.isArray(files) ? files : [files]) {
        await upload('/api/v1/online/photos', fp, { place, ...(place === 'room' ? { roomTypeId } : {}) });
        ok++;
      }
      toast.ok(`${ok} fotoğraf yüklendi.`);
    } catch (e) { toast.error(e); } finally { setBusy(false); await qc.invalidateQueries({ queryKey: ['online'] }); }
  };
  const remove = async (p: Photo) => {
    if (!await confirm({ title: 'Fotoğrafı sil', message: 'Fotoğraf web sitesinden kaldırılır ve dosyası silinir.', confirmText: 'Sil', danger: true })) return;
    try { await del(`/api/v1/online/photos/${p.id}`); await qc.invalidateQueries({ queryKey: ['online'] }); } catch (e) { toast.error(e); }
  };
  return (
    <div className="card"><div className="card-body stack">
      <div className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <Field label="Yer"><select className="input" value={place} onChange={e => setPlace(e.target.value as Photo['place'])}>{Object.entries(PLACE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        {place === 'room' && <Field label="Oda tipi"><select className="input" value={roomTypeId} onChange={e => setRoomTypeId(e.target.value)}><option value="">Seçin</option>{types.data?.map(t => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}</select></Field>}
        <button className="btn primary" disabled={busy || (place === 'room' && !roomTypeId)} onClick={() => void add()}><ImagePlus /> {busy ? 'Yükleniyor…' : 'Fotoğraf ekle'}</button>
        <span className="muted" style={{ fontSize: 12 }}>JPEG, PNG veya WebP; en fazla 8 MB. Net görünmesi için en az 1600 piksel genişlik önerilir.</span>
      </div>
      <ErrorBox error={photos.error} />
      {(['hero', 'logo', 'gallery', 'room'] as const).map(pl => {
        const list = (photos.data ?? []).filter(p => p.place === pl);
        if (!list.length) return null;
        return (
          <div key={pl}><h4>{PLACE_LABEL[pl]} ({list.length})</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
              {list.map(p => <div key={p.id} className="card" style={{ padding: 6 }}><Thumb id={p.id} />
                <div className="row" style={{ marginTop: 4 }}><span className="muted" style={{ fontSize: 12 }}>{pl === 'room' ? types.data?.find(t => t.id === p.roomTypeId)?.code : ''}</span><span className="spacer" />
                  <button className="btn sm ghost icon" title="Sil" onClick={() => void remove(p)}><Trash2 /></button></div></div>)}
            </div>
          </div>
        );
      })}
      {photos.data?.length === 0 && <Empty title="Henüz web fotoğrafı yok" text="Ana sayfa, galeri ve oda fotoğraflarını buradan ekleyin." />}
    </div></div>
  );
}
