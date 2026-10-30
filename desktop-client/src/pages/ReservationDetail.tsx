import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlarmClock, AlertTriangle, ArrowLeft, BedDouble, CalendarClock, Crown, FileText, History, IdCard, LogIn, LogOut, MoreHorizontal, NotebookPen, Pencil,
  ShieldCheck, Trash2, UserMinus, UserPlus, UserX, X, XCircle,
} from 'lucide-react';
import { api, del, get, newKey, post } from '../lib/api';
import type { AuditRow, Reservation, Sharer } from '../lib/types';
import { fmtDate, fmtDateTime, fmtMoney, MEAL_LABEL, SOURCE_LABEL, STATUS_BADGE, STATUS_LABEL } from '../lib/format';
import { CHANNEL_NAME } from '../lib/product';
import { useSession } from '../lib/session';
import { Kv, useAction } from '../components/common';
import { Badge, Empty, ErrorBox, Field, Modal, Spinner, Tabs, useConfirm, useContextMenu, useToast } from '../components/ui';
import { CancelModal, CheckInModal, CheckOutModal, ExtendModal, MoveModal } from '../components/ReservationActions';
import { FolioPanel } from '../components/FolioPanel';
import { DocumentsPanel } from '../components/Documents';
import { ReservationEditModal } from './ReservationForm';
import { KbsPromptModal } from '../components/KbsForm';
import { KvkkPrintButton } from '../components/KvkkForm';
import { ConfirmationButton } from '../components/ReservationConfirmation';
import { ReservationTraces } from '../components/Traces';
import { GuestSearch } from '../components/GuestSearch';
import { draftToBody, emptyGuest, GuestFields, type GuestDraft } from '../components/GuestFields';
import { useWinSelf, useWindows } from '../components/Windows';
import { FolioDetailView } from './FolioDetail';

type Dlg = 'edit' | 'checkin' | 'checkout' | 'move' | 'cancel' | 'extend' | 'sharer' | 'wakeup' | null;
type Extra = 'rates' | 'traces' | 'history' | 'docs';
const DIALOGS = ['edit', 'checkin', 'checkout', 'move', 'cancel', 'extend', 'sharer', 'wakeup'];

/** Sayfa olarak açılış (/reservations/:id). Rack ve listelerden ise pencere olarak açılır (ReservationView). */
export default function ReservationDetailPage() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const [initial] = useState(() => sp.get('do') ?? undefined);
  const [kbs] = useState(() => sp.get('kbs') === '1');
  useEffect(() => { if (sp.has('do') || sp.has('kbs')) setSp({}, { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="page"><FolioDetailView key={id} id={id!} initialAction={initial} kbs={kbs} /></div>;
}

/**
 * Konaklama / folyo ekranı: üstte oda, misafir, tarih, kişi, fiyat ve bakiye; altında işlem düğmeleri;
 * ortada folyo, sağda odadaki misafirler ve notlar. Ayrıntılar (gecelik fiyatlar, hatırlatma, geçmiş, belgeler) "Diğer" menüsündedir.
 * initialAction: Rack menüsünden doğrudan açılacak işlem (checkin|checkout|move|extend|wakeup|edit|cancel|sharer|charge|payment|trace).
 */
export function ReservationView({ id, initialAction, kbs }: { id: string; initialAction?: string; kbs?: boolean }) {
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const win = useWinSelf();
  const windows = useWindows();
  const menu = useContextMenu();
  const { can, property } = useSession();
  const [extra, setExtra] = useState<Extra | null>(initialAction === 'trace' ? 'traces' : null);
  const [dlg, setDlg] = useState<Dlg>(DIALOGS.includes(initialAction ?? '') ? initialAction as Dlg : null);
  const [kbsOpen, setKbsOpen] = useState(!!kbs);
  // Aynı pencere başka bir işlemle yeniden açılırsa (ör. Rack'ten "Tahsilat") o işlem açılır.
  useEffect(() => { if (DIALOGS.includes(initialAction ?? '')) setDlg(initialAction as Dlg); if (initialAction === 'trace') setExtra('traces'); }, [initialAction]);
  const res = useQuery({ queryKey: ['reservation', id], queryFn: () => get<Reservation>(`/api/v1/reservations/${id}`) });
  const sharers = useQuery({ queryKey: ['reservation', id, 'guests'], queryFn: () => get<Sharer[]>(`/api/v1/reservations/${id}/guests`) });
  const rates = useQuery({ queryKey: ['reservation', id, 'rates'], queryFn: () => get<{ date: string; rate: string }[]>(`/api/v1/reservations/${id}/rates`), enabled: extra === 'rates' });
  const history = useQuery({ queryKey: ['reservation', id, 'history'], queryFn: () => get<AuditRow[]>(`/api/v1/reservations/${id}/history`), enabled: extra === 'history' });
  const r = res.data;
  useEffect(() => { if (r && win) win.setTitle(`${r.roomNumber ? `Oda ${r.roomNumber} · ` : ''}${r.guestName} · ${STATUS_LABEL[r.status] ?? r.status}`); }, [r, win]);

  if (res.isLoading) return <div className="page"><Spinner /></div>;
  if (res.error || !r) return <div className="page"><ErrorBox error={res.error} /></div>;
  const bd = property?.businessDate ?? '';
  const pre = r.status === 'tentative' || r.status === 'confirmed';
  const inHouse = r.status === 'checked_in';
  const openGuest = (gid: string) => (windows ? windows.open({ kind: 'guest', id: gid }) : nav(`/guests/${gid}`));

  const noShow = async () => {
    if (!await confirm({ title: 'No-show', message: `${r.guestName} için rezervasyon no-show olarak işaretlenecek.`, confirmText: 'No-show yap', danger: true })) return;
    try { await post(`/api/v1/reservations/${r.id}/no-show`, { version: r.version }, newKey()); toast.ok('No-show olarak işaretlendi.'); await qc.invalidateQueries({ queryKey: ['reservation'] }); } catch (e) { toast.error(e); }
  };
  const removeSharer = async (s: Sharer) => {
    if (!await confirm({ title: 'Ek misafiri çıkar', message: `${s.name} bu konaklamadan çıkarılacak. Misafir kartı silinmez.`, confirmText: 'Çıkar' })) return;
    try { await del(`/api/v1/reservations/${r.id}/guests/${s.id}`); await qc.invalidateQueries({ predicate: q => ['reservation', 'roomStatus', 'rack'].includes(String(q.queryKey[0])) }); } catch (e) { toast.error(e); }
  };
  const more = (e: React.MouseEvent) => menu.open(e, [
    { label: 'Misafir kartı', icon: <IdCard size={14} />, onClick: () => openGuest(r.guestId) },
    ...(pre && r.arrival <= bd && can('reservation.cancel') ? [{ label: 'No-show yap', icon: <UserX size={14} />, onClick: () => void noShow() }] : []),
    ...(pre && can('reservation.cancel') ? [{ label: 'Rezervasyonu iptal et', icon: <XCircle size={14} />, danger: true, onClick: () => setDlg('cancel') }] : []),
    { separator: true, label: '' },
    { label: 'Gecelik fiyatlar', icon: <CalendarClock size={14} />, onClick: () => setExtra('rates') },
    ...(can('trace.manage') ? [{ label: 'Hatırlatmalar', icon: <NotebookPen size={14} />, onClick: () => setExtra('traces') }] : []),
    { label: 'İşlem geçmişi', icon: <History size={14} />, onClick: () => setExtra('history') },
    { label: 'Belgeler', icon: <FileText size={14} />, onClick: () => setExtra('docs') },
  ]);
  const priceCur = r.rateCurrency ?? r.currency;
  const occ = ([['Tek', r.rateSgl], ['Çift', r.rateDbl], ['Üç', r.rateTrp], ['Dört', r.rateQuad]] as [string, string | undefined][]).filter(([, v]) => v != null) as [string, string][];
  const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '');
  const notes: [string, string][] = [
    ['Fiyat planı', r.ratePlanCode ?? 'Varsayılan'],
    ...(occ.length ? [['Kişi fiyatları', occ.map(([k, v]) => `${k} ${fmtMoney(v, priceCur)}`).join(' · ')] as [string, string]] : []),
    ['Toplam', r.rateCurrency ? `≈ ${fmtMoney(r.totalRate, r.currency)}` : fmtMoney(r.totalRate, r.currency)],
    ...(Number(r.depositRequired) > 0 ? [['Depozito', fmtMoney(r.depositRequired, r.currency)] as [string, string]] : []),
    ['Kaynak', SOURCE_LABEL[r.source] ?? r.source],
    ...(r.specialRequests ? [['Özel istek', r.specialRequests] as [string, string]] : []),
    ...(r.notes ? [['Not', r.notes] as [string, string]] : []),
    ...(r.optionUntil ? [['Opsiyon bitişi', fmtDate(r.optionUntil)] as [string, string]] : []),
    ['Oluşturma', `${fmtDateTime(r.createdAt)}${r.createdBy ? ` · ${r.createdBy}` : ''}`],
    ...(r.cancelledAt ? [['İptal', `${fmtDateTime(r.cancelledAt)} · ${r.cancelReason ?? ''}`] as [string, string]] : []),
  ];

  return (
    <div className={`page res-view ${win ? 'in-win' : ''}`}>
      <div className="rv-head">
        <div className={`rv-room ${inHouse ? 'in' : pre ? 'pre' : ''}`}>{r.roomNumber ?? '—'}<small>{r.roomTypeCode}</small></div>
        <div className="rv-main">
          <div className="rv-name">
            {r.guestIsVip && <Crown size={17} color="var(--warning)" />}
            <button className="link" onClick={() => openGuest(r.guestId)} title="Misafir kartını aç">{r.guestName}</button>
            <Badge color={STATUS_BADGE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
            {r.guestIsBlacklisted && <Badge color="red">Kara listede</Badge>}
            {!win && <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => nav(-1)}><ArrowLeft /> Geri</button>}
          </div>
          <div className="rv-facts">
            <span className="mono">{r.reservationNumber}</span>
            <span><b>{fmtDate(r.arrival)}</b>{r.checkedInAt ? ` ${time(r.checkedInAt)}` : r.eta ? ` ${r.eta.slice(0, 5)}` : ''} → <b>{fmtDate(r.departure)}</b>{r.etd ? ` ${r.etd.slice(0, 5)}` : ''} · {r.nights} gece</span>
            <span>{r.adults} yetişkin{r.children ? `, ${r.children} çocuk` : ''}</span>
            <span>{MEAL_LABEL[r.mealPlan] ?? r.mealPlan}</span>
            {(r.companyName || r.agencyName) && <span>{r.companyName ?? r.agencyName}</span>}
            {r.channel && <span>{CHANNEL_NAME[r.channel] ?? r.channel}{r.channelRef ? ` · ${r.channelRef}` : ''}</span>}
          </div>
        </div>
        <div className="rv-money">
          <div><span>Gecelik</span><b>{r.rateCurrency ? fmtMoney(r.fxNightlyRate, r.rateCurrency) : fmtMoney(r.nightlyRate, r.currency)}</b></div>
          <div><span>Bakiye</span><b className={Number(r.balance) > 0 ? 'due' : ''}>{fmtMoney(r.balance, r.currency)}</b></div>
        </div>
      </div>

      {r.guestAlertNote && <div className="warn-box row" style={{ marginBottom: 8, gap: 8 }}><AlertTriangle size={16} /> <b>Misafir uyarısı:</b> {r.guestAlertNote}</div>}

      <div className="rv-actions">
        {pre && can('checkin.execute') && r.arrival <= bd && <button className="btn primary" onClick={() => setDlg('checkin')}><LogIn /> Giriş yap</button>}
        {inHouse && can('checkout.execute') && <button className="btn primary" onClick={() => setDlg('checkout')}><LogOut /> Çıkış yap</button>}
        {(pre || inHouse) && can('reservation.edit') && <button className="btn" onClick={() => setDlg('edit')}><Pencil /> Düzenle / fiyat</button>}
        {inHouse && can('room.change') && <button className="btn" onClick={() => setDlg('move')}><BedDouble /> Oda değiştir</button>}
        {(pre || inHouse) && can('reservation.edit') && <button className="btn" onClick={() => setDlg('extend')}><CalendarClock /> Uzat / kısalt</button>}
        {inHouse && can('reservation.edit') && <button className="btn" onClick={() => setDlg('wakeup')}><AlarmClock /> Uyandırma</button>}
        {(pre || inHouse) && <ConfirmationButton r={r} />}
        {(pre || inHouse) && <KvkkPrintButton reservationId={r.id} primary={{ name: r.guestName, room: r.roomNumber, reservationNumber: r.reservationNumber, arrival: r.arrival, departure: r.departure }} />}
        {inHouse && can('kbs.manage') && <button className="btn" onClick={() => setKbsOpen(true)}><ShieldCheck /> Kimlik bildirimi</button>}
        <button className="btn" onClick={more}><MoreHorizontal /> Diğer</button>
      </div>

      <div className="rv-body">
        <div className="card rv-folio"><div className="card-body">
          {can('folio.view')
            ? <FolioPanel reservation={r} initialDialog={initialAction === 'charge' || initialAction === 'payment' ? initialAction : undefined} />
            : <Empty title="Folyo görüntüleme yetkiniz yok" />}
        </div></div>
        <aside className="rv-side">
          <div className="card">
            <div className="card-head"><h3>Odadaki misafirler</h3>
              {can('reservation.edit') && (pre || inHouse) && <div className="right"><button className="btn sm" onClick={() => setDlg('sharer')}><UserPlus /> Ekle</button></div>}
            </div>
            <div className="card-body tight">
              {sharers.isLoading ? <Spinner /> : (
                <ul className="rv-guests">
                  {sharers.data?.map(s => (
                    <li key={s.id}>
                      <button className="link" onClick={() => openGuest(s.id)}>{s.name}</button>
                      <span className="muted">{s.nationality}</span>
                      <span className="spacer" />
                      {s.hasIdentity ? <Badge color="green">Kimlik var</Badge> : <Badge color="orange">Kimlik eksik</Badge>}
                      {s.isPrimary ? <Badge color="gray">Ana</Badge> : can('reservation.edit') && (pre || inHouse) &&
                        <button className="btn sm ghost icon" title="Konaklamadan çıkar" onClick={() => void removeSharer(s)}><UserMinus /></button>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h3>Fiyat ve notlar</h3></div>
            <div className="card-body"><Kv items={notes} /></div>
          </div>
        </aside>
      </div>

      {extra && (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="card-head">
            <Tabs value={extra} onChange={setExtra} items={[{ key: 'rates', label: 'Gecelik fiyatlar' }, ...(can('trace.manage') ? [{ key: 'traces' as const, label: 'Hatırlatmalar' }] : []), { key: 'history', label: 'İşlem geçmişi' }, { key: 'docs', label: 'Belgeler' }]} />
            <div className="right"><button className="btn sm ghost icon" title="Kapat" onClick={() => setExtra(null)}><X /></button></div>
          </div>
          <div className="card-body">
            {extra === 'traces' && <ReservationTraces reservationId={r.id} arrival={r.arrival} departure={r.departure} open={pre || inHouse} />}
            {extra === 'docs' && <DocumentsPanel entityType="reservation" entityId={r.id} canEdit={can('reservation.edit')} />}
            {extra === 'rates' && (rates.isLoading ? <Spinner /> : (
              <table className="dt"><thead><tr><th>Gece</th><th style={{ textAlign: 'right' }}>Fiyat</th></tr></thead>
                <tbody>{rates.data?.map(x => <tr key={x.date}><td>{fmtDate(x.date)}</td><td className="num">{fmtMoney(x.rate, r.currency)}</td></tr>)}</tbody></table>
            ))}
            {extra === 'history' && (history.isLoading ? <Spinner /> : history.data?.length === 0 ? <Empty title="Kayıt yok" /> : (
              <table className="dt"><thead><tr><th>Zaman</th><th>Kullanıcı</th><th>İşlem</th><th>Gerekçe</th></tr></thead>
                <tbody>{history.data?.map((h, i) => <tr key={i}><td>{fmtDateTime(h.at)}</td><td>{h.username}</td><td>{h.action}</td><td>{h.reason}</td></tr>)}</tbody></table>
            ))}
          </div>
        </div>
      )}

      {menu.node}
      {kbsOpen && can('kbs.manage') && inHouse && <KbsPromptModal reservationId={r.id} onClose={() => setKbsOpen(false)} />}
      {dlg === 'edit' && <ReservationEditModal reservation={r} onClose={() => setDlg(null)} />}
      {dlg === 'checkin' && <CheckInModal reservation={r} onClose={() => setDlg(null)} />}
      {dlg === 'checkout' && <CheckOutModal reservation={r} onClose={() => setDlg(null)} />}
      {dlg === 'move' && <MoveModal reservation={r} onClose={() => setDlg(null)} />}
      {dlg === 'cancel' && <CancelModal reservation={r} onClose={() => setDlg(null)} />}
      {dlg === 'extend' && <ExtendModal reservation={r} onClose={() => setDlg(null)} />}
      {dlg === 'sharer' && <SharerModal reservationId={r.id} onClose={() => setDlg(null)} />}
      {dlg === 'wakeup' && <WakeupModal reservation={r} onClose={() => setDlg(null)} />}
      {r.status === 'cancelled' && <div className="info-box" style={{ marginTop: 12 }}><Trash2 size={13} /> Bu rezervasyon iptal edilmiştir; kayıt ve folyo geçmişi saklanır.</div>}
    </div>
  );
}

/** Konaklamaya misafir ekleme: kayıtlı misafir ad/soyad ile aranır veya burada yeni misafir kartı açılıp doğrudan eklenir. */
export function SharerModal({ reservationId, onClose }: { reservationId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const [draft, setDraft] = useState<GuestDraft | null>(null);
  const refresh = () => qc.invalidateQueries({ predicate: q => ['reservation', 'roomStatus', 'rack', 'guests'].includes(String(q.queryKey[0])) });
  const add = useAction(async (key: string, guestId: string) => {
    await api('POST', `/api/v1/reservations/${reservationId}/guests`, { guestId }, { key });
    await refresh();
  }, { success: 'Misafir konaklamaya eklendi.' });
  const create = useAction(async (key: string) => {
    const g = await api<{ id: string }>('POST', '/api/v1/guests', draftToBody(draft!), { key });
    await api('POST', `/api/v1/reservations/${reservationId}/guests`, { guestId: g.id }, { key: newKey() });
    await refresh();
  }, { success: 'Yeni misafir kaydedildi ve konaklamaya eklendi.' });
  return (
    <Modal title={draft ? 'Yeni misafir kartı · konaklamaya ekle' : 'Konaklamaya misafir ekle'} size="lg" onClose={onClose} footer={draft ? <>
      <button className="btn" onClick={() => setDraft(null)}>Kayıtlı misafir ara</button>
      <span className="spacer" />
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={create.busy || !draft.firstName.trim() || !draft.lastName.trim()} onClick={async () => { if (await create.run() !== undefined) onClose(); }}><UserPlus /> Kaydet ve ekle</button>
    </> : undefined}>
      {draft ? <><GuestFields value={draft} onChange={setDraft} compact /><ErrorBox error={create.error} /></> : (
        <div className="stack">
          <GuestSearch actionLabel="Ekle" onPick={async g => { if (await add.run(g.id) !== undefined) onClose(); }}
            onNew={can('guest.edit') ? seed => setDraft({ ...emptyGuest(), ...seed }) : undefined} />
          <ErrorBox error={add.error} />
        </div>
      )}
    </Modal>
  );
}

export function WakeupModal({ reservation: r, onClose }: { reservation: Reservation; onClose: () => void }) {
  const qc = useQueryClient();
  const [at, setAt] = useState('');
  const [notes, setNotes] = useState('');
  const save = useAction(async (key: string) => {
    await api('POST', '/api/v1/wakeup-calls', { reservationId: r.id, callAt: new Date(at).toISOString(), notes: notes || null }, { key });
    await qc.invalidateQueries({ queryKey: ['wakeups'] });
  }, { success: 'Uyandırma kaydedildi.' });
  return (
    <Modal title={`Uyandırma · Oda ${r.roomNumber ?? ''}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!at || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button>
    </>}>
      <div className="form-grid">
        <Field label="Tarih ve saat" required className="span-2"><input type="datetime-local" className="input" value={at} onChange={e => setAt(e.target.value)} autoFocus /></Field>
        <Field label="Not" className="span-2"><input className="input" value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}
