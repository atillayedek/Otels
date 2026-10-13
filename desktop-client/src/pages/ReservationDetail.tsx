import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, ArrowLeft, BedDouble, CalendarClock, Crown, LogIn, LogOut, Pencil, Trash2, UserMinus, UserPlus, UserX, XCircle } from 'lucide-react';
import { api, del, get, post, qs } from '../lib/api';
import type { AuditRow, GuestListItem, Paged, Reservation, Sharer } from '../lib/types';
import { fmtDate, fmtDateTime, fmtMoney, MEAL_LABEL, SOURCE_LABEL, STATUS_BADGE, STATUS_LABEL } from '../lib/format';
import { useSession } from '../lib/session';
import { Kv, PageHead, useAction } from '../components/common';
import { Badge, Empty, ErrorBox, Field, Modal, Spinner, Tabs, useConfirm, useToast } from '../components/ui';
import { CancelModal, CheckInModal, CheckOutModal, ExtendModal, MoveModal } from '../components/ReservationActions';
import { FolioPanel } from '../components/FolioPanel';
import { DocumentsPanel } from '../components/Documents';
import { ReservationEditModal } from './ReservationForm';
import { KbsPromptModal } from '../components/KbsForm';

type Dlg = 'edit' | 'checkin' | 'checkout' | 'move' | 'cancel' | 'extend' | 'sharer' | 'wakeup' | null;

export default function ReservationDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { can, property } = useSession();
  const [tab, setTab] = useState<'folio' | 'guests' | 'rates' | 'history' | 'docs'>('folio');
  const [dlg, setDlg] = useState<Dlg>(null);
  const [sp, setSp] = useSearchParams();
  const res = useQuery({ queryKey: ['reservation', id], queryFn: () => get<Reservation>(`/api/v1/reservations/${id}`) });
  const sharers = useQuery({ queryKey: ['reservation', id, 'guests'], queryFn: () => get<Sharer[]>(`/api/v1/reservations/${id}/guests`), enabled: tab === 'guests' });
  const rates = useQuery({ queryKey: ['reservation', id, 'rates'], queryFn: () => get<{ date: string; rate: string }[]>(`/api/v1/reservations/${id}/rates`), enabled: tab === 'rates' });
  const history = useQuery({ queryKey: ['reservation', id, 'history'], queryFn: () => get<AuditRow[]>(`/api/v1/reservations/${id}/history`), enabled: tab === 'history' });

  if (res.isLoading) return <div className="page"><Spinner /></div>;
  if (res.error) return <div className="page"><ErrorBox error={res.error} /></div>;
  const r = res.data!;
  const bd = property?.businessDate ?? '';
  const pre = r.status === 'tentative' || r.status === 'confirmed';

  const noShow = async () => {
    if (!await confirm({ title: 'No-show', message: `${r.guestName} için rezervasyon no-show olarak işaretlenecek.`, confirmText: 'No-show yap', danger: true })) return;
    try { await post(`/api/v1/reservations/${r.id}/no-show`, { version: r.version }, crypto.randomUUID()); toast.ok('No-show olarak işaretlendi.'); await qc.invalidateQueries({ queryKey: ['reservation'] }); } catch (e) { toast.error(e); }
  };
  const removeSharer = async (s: Sharer) => {
    if (!await confirm({ title: 'Ek misafiri çıkar', message: `${s.name} bu konaklamadan çıkarılacak. Misafir kartı silinmez.`, confirmText: 'Çıkar' })) return;
    try { await del(`/api/v1/reservations/${r.id}/guests/${s.id}`); await qc.invalidateQueries({ queryKey: ['reservation', id, 'guests'] }); } catch (e) { toast.error(e); }
  };

  return (
    <div className="page">
      <PageHead title={<>{r.guestIsVip && <Crown size={18} color="var(--warning)" />} {r.guestName}</>} sub={<>
        <span className="mono">{r.reservationNumber}</span> · <Badge color={STATUS_BADGE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
        {r.guestIsBlacklisted && <Badge color="red">Kara listede</Badge>}
      </>} actions={<>
        <button className="btn ghost" onClick={() => nav(-1)}><ArrowLeft /> Geri</button>
        {pre && can('reservation.edit') && <button className="btn" onClick={() => setDlg('edit')}><Pencil /> Düzenle</button>}
        {r.status === 'checked_in' && can('reservation.edit') && <button className="btn" onClick={() => setDlg('edit')}><Pencil /> Düzenle</button>}
        {pre && can('checkin.execute') && r.arrival <= bd && <button className="btn primary" onClick={() => setDlg('checkin')}><LogIn /> Giriş yap</button>}
        {r.status === 'checked_in' && can('room.change') && <button className="btn" onClick={() => setDlg('move')}><BedDouble /> Oda değiştir</button>}
        {(pre || r.status === 'checked_in') && can('reservation.edit') && <button className="btn" onClick={() => setDlg('extend')}><CalendarClock /> Uzat / kısalt</button>}
        {r.status === 'checked_in' && can('reservation.edit') && <button className="btn" onClick={() => setDlg('wakeup')}><AlarmClock /> Uyandırma</button>}
        {r.status === 'checked_in' && can('checkout.execute') && <button className="btn primary" onClick={() => setDlg('checkout')}><LogOut /> Çıkış yap</button>}
        {pre && r.arrival <= bd && can('reservation.cancel') && <button className="btn" onClick={() => void noShow()}><UserX /> No-show</button>}
        {pre && can('reservation.cancel') && <button className="btn danger" onClick={() => setDlg('cancel')}><XCircle /> İptal</button>}
      </>} />

      <div className="grid cols-3" style={{ marginBottom: 14 }}>
        <div className="card"><div className="card-head"><h3>Konaklama</h3></div><div className="card-body">
          <Kv items={[
            ['Giriş', `${fmtDate(r.arrival)}${r.eta ? ` · ${r.eta.slice(0, 5)}` : ''}`], ['Çıkış', `${fmtDate(r.departure)}${r.etd ? ` · ${r.etd.slice(0, 5)}` : ''}`],
            ['Gece', r.nights], ['Oda', r.roomNumber ? `${r.roomNumber} · ${r.roomTypeCode}` : `Atanmadı · ${r.roomTypeCode}`], ['Kişi', `${r.adults} yetişkin, ${r.children} çocuk`],
            ['Pansiyon', MEAL_LABEL[r.mealPlan] ?? r.mealPlan], ...(r.checkedInAt ? [['Giriş zamanı', fmtDateTime(r.checkedInAt)] as [string, string]] : []),
            ...(r.checkedOutAt ? [['Çıkış zamanı', fmtDateTime(r.checkedOutAt)] as [string, string]] : []),
            ...(r.optionUntil ? [['Opsiyon bitişi', fmtDate(r.optionUntil)] as [string, string]] : []),
          ]} />
        </div></div>
        <div className="card"><div className="card-head"><h3>Fiyat ve hesap</h3></div><div className="card-body">
          <Kv items={[
            ['Gecelik', fmtMoney(r.nightlyRate, r.currency)], ['Toplam', fmtMoney(r.totalRate, r.currency)], ['Fiyat planı', r.ratePlanCode ?? 'Varsayılan'],
            ['Bakiye', <b key="b" className={r.balance.startsWith('-') ? 'amount-neg' : ''}>{fmtMoney(r.balance, r.currency)}</b>],
            ['Depozito', fmtMoney(r.depositRequired, r.currency)], ['Şirket', r.companyName], ['Acente', r.agencyName], ['Kaynak', SOURCE_LABEL[r.source] ?? r.source],
          ]} />
        </div></div>
        <div className="card"><div className="card-head"><h3>Notlar</h3></div><div className="card-body">
          <Kv items={[
            ['Özel istek', r.specialRequests], ['Not', r.notes], ['Oluşturma', `${fmtDateTime(r.createdAt)}${r.createdBy ? ` · ${r.createdBy}` : ''}`],
            ...(r.cancelledAt ? [['İptal', `${fmtDateTime(r.cancelledAt)} · ${r.cancelReason ?? ''}`] as [string, string]] : []),
          ]} />
          <button className="btn sm" style={{ marginTop: 10 }} onClick={() => nav(`/guests/${r.guestId}`)}>Misafir kartı</button>
        </div></div>
      </div>

      <Tabs value={tab} onChange={setTab} items={[{ key: 'folio', label: 'Folyo' }, { key: 'guests', label: 'Ek misafirler' }, { key: 'rates', label: 'Gecelik fiyatlar' }, { key: 'history', label: 'İşlem geçmişi' }, { key: 'docs', label: 'Belgeler' }]} />
      <div className="card"><div className="card-body">
        {tab === 'folio' && (can('folio.view') ? <FolioPanel reservation={r} /> : <Empty title="Folyo görüntüleme yetkiniz yok" />)}
        {tab === 'guests' && (
          <div className="stack">
            {can('reservation.edit') && r.status !== 'checked_out' && r.status !== 'cancelled' && <div><button className="btn sm" onClick={() => setDlg('sharer')}><UserPlus /> Misafir ekle</button></div>}
            {sharers.isLoading ? <Spinner /> : (
              <table className="dt">
                <thead><tr><th>Ad soyad</th><th>Uyruk</th><th>Kimlik</th><th>Rol</th><th /></tr></thead>
                <tbody>
                  {sharers.data?.map(s => (
                    <tr key={s.id}>
                      <td>{s.name}</td><td>{s.nationality}</td><td>{s.hasIdentity ? <Badge color="green">Var</Badge> : <Badge color="orange">Eksik</Badge>}</td>
                      <td>{s.isPrimary ? 'Ana misafir' : 'Ek misafir'}</td>
                      <td style={{ textAlign: 'right' }}>{!s.isPrimary && can('reservation.edit') && <button className="btn sm ghost" onClick={() => void removeSharer(s)}><UserMinus /> Çıkar</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        {tab === 'docs' && <DocumentsPanel entityType="reservation" entityId={r.id} canEdit={can('reservation.edit')} />}
        {tab === 'rates' && (rates.isLoading ? <Spinner /> : (
          <table className="dt"><thead><tr><th>Gece</th><th style={{ textAlign: 'right' }}>Fiyat</th></tr></thead>
            <tbody>{rates.data?.map(x => <tr key={x.date}><td>{fmtDate(x.date)}</td><td className="num">{fmtMoney(x.rate, r.currency)}</td></tr>)}</tbody></table>
        ))}
        {tab === 'history' && (history.isLoading ? <Spinner /> : history.data?.length === 0 ? <Empty title="Kayıt yok" /> : (
          <table className="dt"><thead><tr><th>Zaman</th><th>Kullanıcı</th><th>İşlem</th><th>Gerekçe</th></tr></thead>
            <tbody>{history.data?.map((h, i) => <tr key={i}><td>{fmtDateTime(h.at)}</td><td>{h.username}</td><td>{h.action}</td><td>{h.reason}</td></tr>)}</tbody></table>
        ))}
      </div></div>

      {sp.get('kbs') === '1' && can('kbs.manage') && r.status === 'checked_in' && <KbsPromptModal reservationId={r.id} onClose={() => setSp({}, { replace: true })} />}
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

function SharerModal({ reservationId, onClose }: { reservationId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['guests', 'sharer', q], queryFn: () => get<Paged<GuestListItem>>(`/api/v1/guests${qs({ q, pageSize: 10 })}`), enabled: q.trim().length >= 2 });
  const add = useAction(async (key: string, guestId: string) => {
    await api('POST', `/api/v1/reservations/${reservationId}/guests`, { guestId }, { key });
    await qc.invalidateQueries({ queryKey: ['reservation', reservationId, 'guests'] });
  }, { success: 'Misafir eklendi.' });
  return (
    <Modal title="Konaklamaya misafir ekle" onClose={onClose}>
      <div className="stack">
        <Field label="Misafir ara" hint="Yeni misafiri önce Misafirler ekranından kaydedin."><input className="input" autoFocus value={q} onChange={e => setQ(e.target.value)} /></Field>
        <ul className="list-plain">
          {list.data?.items.map(g => (
            <li key={g.id}><span>{g.firstName} {g.lastName}</span><span className="muted">{g.nationality} {g.identityNumber}</span><span className="spacer" />
              <button className="btn sm primary" disabled={add.busy} onClick={async () => { if (await add.run(g.id) !== undefined) onClose(); }}>Ekle</button></li>
          ))}
        </ul>
        <ErrorBox error={add.error} />
      </div>
    </Modal>
  );
}

function WakeupModal({ reservation: r, onClose }: { reservation: Reservation; onClose: () => void }) {
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
