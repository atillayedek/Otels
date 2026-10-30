import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Printer } from 'lucide-react';
import { api, del, get, newKey, post, put } from '../lib/api';
import type { AuditRow, Folio, FolioDetail, GuestProfile, MasterInfo, MasterScope, Paged, Reservation, ReservationListItem, Sharer } from '../lib/types';
import { fmtDate, fmtDateTime, fmtMoney, STATUS_LABEL } from '../lib/format';
import { useAgencies, useCompanies, useRoomTypes } from '../lib/queries';
import { useSession } from '../lib/session';
import { Empty, ErrorBox, Field, Modal, MoneyInput, Spinner, useConfirm, useContextMenu, useToast } from '../components/ui';
import { CancelModal, CheckInModal, CheckOutModal, ExtendModal, MoveModal } from '../components/ReservationActions';
import { FolioPanel, FolioPrint } from '../components/FolioPanel';
import { DocumentsPanel } from '../components/Documents';
import { KbsPromptModal } from '../components/KbsForm';
import { KvkkPrintButton } from '../components/KvkkForm';
import { ConfirmationButton } from '../components/ReservationConfirmation';
import { ReservationTraces } from '../components/Traces';
import { draftToBody, guestToDraft } from '../components/GuestFields';
import { useWinSelf, useWindows } from '../components/Windows';
import { ReservationEditModal } from './ReservationForm';
import { SharerModal, WakeupModal } from './ReservationDetail';

type Dlg = 'edit' | 'checkin' | 'checkout' | 'move' | 'cancel' | 'extend' | 'sharer' | 'wakeup' | 'kontrat' | 'plan' | 'ratelog' | 'traces' | 'docs' | 'history' | 'card' | 'master' | null;
const DIALOGS = ['edit', 'checkin', 'checkout', 'move', 'cancel', 'extend', 'sharer', 'wakeup'];
const RATE_ACTIONS = ['reservation.create', 'reservation.update', 'reservation.occupancy', 'reservation.folio_details', 'reservation.move_room', 'reservation.change_stay'];

interface Draft {
  account: string; discountPct: string; noManualCharges: boolean; invoiceType: 'invoice' | 'receipt'; keyCardType: string; creditLimit: string;
  notes: string; noteOnCheckout: boolean; specialRequests: string; etd: string; rateLocked: boolean; phone: string; preferences: string;
}
const draftOf = (r: Reservation): Draft => ({
  account: r.companyId ? `c:${r.companyId}` : r.agencyId ? `a:${r.agencyId}` : '', discountPct: String(Number(r.discountPct ?? 0)), noManualCharges: r.noManualCharges,
  invoiceType: r.invoiceType ?? 'invoice', keyCardType: r.keyCardType ?? 'GENEL', creditLimit: r.creditLimit ?? '0', notes: r.notes ?? '', noteOnCheckout: r.noteOnCheckout,
  specialRequests: r.specialRequests ?? '', etd: r.etd?.slice(0, 5) ?? '', rateLocked: r.rateLocked, phone: r.guestPhone ?? '', preferences: r.guestPreferences ?? '',
});
const pct = (v: string) => Number((v.trim() || '0').replace(',', '.'));
const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');

/**
 * Folyo Detayı penceresi (konaklama): firma, misafir, giriş/çıkış, indirim, fatura ve kart bilgileri, notlar, fiyatlar, bakiye ve
 * odadaki misafirler. Hesap hareketleri (masraf, tahsilat) ayrı pencerede açılır ("Diğer…" → Hesap hareketleri).
 */
export function FolioDetailView({ id, initialAction, kbs }: { id: string; initialAction?: string; kbs?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const win = useWinSelf();
  const windows = useWindows();
  const menu = useContextMenu();
  const { can, property } = useSession();
  const companies = useCompanies();
  const agencies = useAgencies();
  const types = useRoomTypes();
  const [dlg, setDlg] = useState<Dlg>(DIALOGS.includes(initialAction ?? '') ? initialAction as Dlg : initialAction === 'trace' ? 'traces' : null);
  const [kbsOpen, setKbsOpen] = useState(!!kbs);
  const [tab, setTab] = useState<'note' | 'info' | 'prefs'>('note');
  const [sel, setSel] = useState<string | null>(null);
  const [printMenu, setPrintMenu] = useState(false);
  const [printing, setPrinting] = useState<FolioDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const res = useQuery({ queryKey: ['reservation', id], queryFn: () => get<Reservation>(`/api/v1/reservations/${id}`) });
  const sharers = useQuery({ queryKey: ['reservation', id, 'guests'], queryFn: () => get<Sharer[]>(`/api/v1/reservations/${id}/guests`) });
  const folios = useQuery({ queryKey: ['folios', id], queryFn: () => get<Folio[]>(`/api/v1/folios?reservationId=${id}`), enabled: can('folio.view') });
  const master = useQuery({ queryKey: ['reservation', id, 'master'], queryFn: () => get<MasterInfo>(`/api/v1/reservations/${id}/master`), enabled: can('folio.view') });
  const r = res.data;
  const [d, setD] = useState<Draft | null>(null);
  // Kayıt yenilenince (ör. başka ekrandan değişiklik) form kayıtlı değerlere döner.
  useEffect(() => { if (r) setD(draftOf(r)); }, [r]);
  useEffect(() => { if (DIALOGS.includes(initialAction ?? '')) setDlg(initialAction as Dlg); }, [initialAction]);
  useEffect(() => { if (r && win) win.setTitle(`Folyo Detayı · ${r.roomNumber ? `Oda ${r.roomNumber} · ` : ''}${r.guestName}`); }, [r, win]);
  // Masraf/tahsilat isteğiyle açıldıysa hesap hareketleri penceresi açılır.
  useEffect(() => {
    if ((initialAction === 'charge' || initialAction === 'payment') && windows) windows.open({ kind: 'folio', id, action: initialAction });
  }, [initialAction, id, windows]);
  const folio = folios.data?.find(f => f.windowNo === (r?.roomChargeWindow ?? 1)) ?? folios.data?.[0];
  const dirty = useMemo(() => !!r && !!d && JSON.stringify(d) !== JSON.stringify(draftOf(r)), [r, d]);

  if (res.isLoading || (r && !d)) return <div className="page"><Spinner /></div>;
  if (res.error || !r || !d) return <div className="page"><ErrorBox error={res.error} /></div>;
  const bd = property?.businessDate ?? '';
  const pre = r.status === 'tentative' || r.status === 'confirmed';
  const inHouse = r.status === 'checked_in';
  const editable = (pre || inHouse) && can('reservation.edit');
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(s => (s ? { ...s, [k]: v } : s));
  const priceCur = r.rateCurrency ?? r.currency;
  const applied = Number(r.rateCurrency ? r.fxNightlyRate : r.nightlyRate);
  const disc = Number(r.discountPct ?? 0);
  const contract = disc > 0 && disc < 100 ? Math.round(applied / (1 - disc / 100) * 100) / 100 : applied;
  const refresh = () => qc.invalidateQueries({ predicate: q => ['reservation', 'reservations', 'roomStatus', 'rack', 'folio', 'folios', 'guest', 'guests'].includes(String(q.queryKey[0])) });
  const selected = sharers.data?.find(s => s.id === sel) ?? null;

  /** Değişen alanları kaydeder: konaklama ayarları ve misafir kartındaki telefon/tercihler. */
  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    setBusy(true);
    try {
      const base = draftOf(r);
      const resChanged = (['account', 'discountPct', 'noManualCharges', 'invoiceType', 'keyCardType', 'creditLimit', 'notes', 'noteOnCheckout', 'specialRequests', 'etd', 'rateLocked'] as const)
        .some(k => d[k] !== base[k]);
      if (resChanged) {
        await put(`/api/v1/reservations/${r.id}/folio-details`, {
          companyId: d.account.startsWith('c:') ? d.account.slice(2) : null, agencyId: d.account.startsWith('a:') ? d.account.slice(2) : null,
          discountPct: pct(d.discountPct), noManualCharges: d.noManualCharges, invoiceType: d.invoiceType, keyCardType: d.keyCardType.trim() || 'GENEL',
          creditLimit: d.creditLimit || '0', notes: d.notes.trim() || null, noteOnCheckout: d.noteOnCheckout, specialRequests: d.specialRequests.trim() || null,
          etd: d.etd ? `${d.etd}:00` : null, rateLocked: d.rateLocked, version: r.version,
        });
      }
      if (d.phone !== base.phone || d.preferences !== base.preferences) {
        const g = (await get<GuestProfile>(`/api/v1/guests/${r.guestId}`)).guest;
        await put(`/api/v1/guests/${r.guestId}`, draftToBody({ ...guestToDraft(g), phone: d.phone, preferences: d.preferences }, g.version));
      }
      await refresh();
      toast.ok('Folyo bilgileri kaydedildi.');
      return true;
    } catch (e) { toast.error(e); return false; } finally { setBusy(false); }
  };
  const applyDiscount = async () => {
    try {
      await put(`/api/v1/reservations/${r.id}/folio-details`, {
        companyId: r.companyId ?? null, agencyId: r.agencyId ?? null, discountPct: pct(d.discountPct), noManualCharges: r.noManualCharges, invoiceType: r.invoiceType,
        keyCardType: r.keyCardType, creditLimit: r.creditLimit, notes: r.notes ?? null, noteOnCheckout: r.noteOnCheckout, specialRequests: r.specialRequests ?? null,
        etd: r.etd ?? null, rateLocked: r.rateLocked, version: r.version,
      });
      await refresh();
      toast.ok(`%${d.discountPct} indirim postalanmamış gecelere uygulandı.`);
    } catch (e) { toast.error(e); }
  };
  const close = async () => { if (await save()) win?.close(); };
  const cancel = async () => {
    if (dirty && !await confirm({ title: 'Değişiklikler kaydedilmedi', message: 'Folyoda kaydedilmemiş değişiklikler var. Kaydetmeden kapatılsın mı?', confirmText: 'Kaydetmeden kapat', danger: true })) return;
    win?.close();
  };
  const printFolio = async () => {
    if (!folio) { toast.error('Yazdırılacak folyo yok.'); return; }
    try {
      const detail = await get<FolioDetail>(`/api/v1/folios/${folio.id}`);
      setPrinting(detail);
      setTimeout(() => { window.print(); setPrinting(null); }, 60);
    } catch (e) { toast.error(e); }
  };
  const keyCard = async (cardNo: string | null) => {
    if (!selected) return;
    try {
      await put(`/api/v1/reservations/${r.id}/guests/${selected.id}`, { setKeyCard: true, keyCardNo: cardNo, isActive: null });
      await qc.invalidateQueries({ queryKey: ['reservation', id, 'guests'] });
      toast.ok(cardNo ? `${selected.name}: kart ${cardNo} kaydedildi.` : `${selected.name}: kart silindi.`);
    } catch (e) { toast.error(e); }
  };
  const setActive = async (s: Sharer, active: boolean) => {
    try { await put(`/api/v1/reservations/${r.id}/guests/${s.id}`, { setKeyCard: false, keyCardNo: null, isActive: active }); await qc.invalidateQueries({ queryKey: ['reservation', id, 'guests'] }); }
    catch (e) { toast.error(e); }
  };
  const removeSharer = async (s: Sharer) => {
    if (!await confirm({ title: 'Misafiri çıkar', message: `${s.name} bu konaklamadan çıkarılacak. Misafir kartı silinmez.`, confirmText: 'Çıkar' })) return;
    try { await del(`/api/v1/reservations/${r.id}/guests/${s.id}`); await refresh(); } catch (e) { toast.error(e); }
  };
  const noShow = async () => {
    if (!await confirm({ title: 'No-show', message: `${r.guestName} için rezervasyon no-show olarak işaretlenecek.`, confirmText: 'No-show yap', danger: true })) return;
    try { await post(`/api/v1/reservations/${r.id}/no-show`, { version: r.version }, newKey()); toast.ok('No-show olarak işaretlendi.'); await refresh(); } catch (e) { toast.error(e); }
  };
  const openGuest = (gid: string) => windows?.open({ kind: 'guest', id: gid });
  const openFolio = (action?: string) => windows?.open({ kind: 'folio', id: r.id, action });

  const otherMenu = (e: React.MouseEvent) => menu.open(e, [
    { label: 'Hesap hareketleri', disabled: !can('folio.view'), onClick: () => openFolio() },
    { label: 'Tahsilat', disabled: !inHouse && !pre || !can('payment.create'), onClick: () => openFolio('payment') },
    { label: 'Masraf', disabled: !inHouse || !can('folio.post') || r.noManualCharges, onClick: () => openFolio('charge') },
    { separator: true, label: '' },
    { label: 'Giriş yap (check-in)', disabled: !pre || r.arrival > bd || !can('checkin.execute'), onClick: () => setDlg('checkin') },
    { label: 'Çıkış yap (check-out)', disabled: !inHouse || !can('checkout.execute'), onClick: () => setDlg('checkout') },
    { label: 'Oda değişimi', disabled: !inHouse || !can('room.change'), onClick: () => setDlg('move') },
    { label: 'Uzat / kısalt', disabled: !editable, onClick: () => setDlg('extend') },
    { label: 'Uyandırma', disabled: !inHouse || !can('reservation.edit'), onClick: () => setDlg('wakeup') },
    { label: 'Rezervasyon kartı', disabled: !editable, onClick: () => setDlg('edit') },
    { label: 'Kimlik bildirimi (KBS)', disabled: !inHouse || !can('kbs.manage'), onClick: () => setKbsOpen(true) },
    { separator: true, label: '' },
    { label: 'Misafir istekleri / hatırlatmalar', disabled: !can('trace.manage'), onClick: () => setDlg('traces') },
    { label: 'Belgeler', onClick: () => setDlg('docs') },
    { label: 'İşlem geçmişi', onClick: () => setDlg('history') },
    { separator: true, label: '' },
    { label: 'No-show yap', disabled: !pre || r.arrival > bd || !can('reservation.cancel'), onClick: () => void noShow() },
    { label: 'Rezervasyonu iptal et', danger: true, disabled: !pre || !can('reservation.cancel'), onClick: () => setDlg('cancel') },
  ]);
  const guestMenu = (e: React.MouseEvent) => menu.open(e, [
    { label: 'Misafir kartı', disabled: !selected, onClick: () => selected && openGuest(selected.id) },
    { label: selected?.isActive === false ? 'Aktif yap' : 'Pasif yap', disabled: !selected || selected.isPrimary || !editable, onClick: () => selected && void setActive(selected, !selected.isActive) },
    { label: 'Konaklamadan çıkar', danger: true, disabled: !selected || selected.isPrimary || !editable, onClick: () => selected && void removeSharer(selected) },
  ]);

  return (
    <div className="fdw">
      <div className="fdw-top">
        <div className="fdw-box">
          <div className="fdw-row">
            <label className="fdw-l">Firma</label>
            <select className="input fdw-yellow" value={d.account} disabled={!editable} onChange={e => set('account', e.target.value)}>
              <option value="">MÜNFERİT</option>
              {companies.data?.map(c => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}
              {agencies.data?.map(a => <option key={a.id} value={`a:${a.id}`}>{a.name} (acente)</option>)}
            </select>
            <label className="fdw-l">Adı Soyadı</label>
            <label className="fdw-chk">Aktif <input type="checkbox" checked={folio?.status !== 'closed'} disabled readOnly title="Folyo açık; kapatmak için hesap hareketlerinden bakiyeyi sıfırlayıp kapatın" /></label>
          </div>
          <div className="fdw-row">
            <label className="fdw-l">M.Kodu</label>
            <div className="row" style={{ gap: 2 }}><input className="input fdw-ro num" value={r.guestNo || ''} readOnly /><button className="btn sm" title="Misafir kartı" onClick={() => openGuest(r.guestId)}>…</button></div>
            <input className="input fdw-ro fdw-name" value={r.guestName} readOnly />
          </div>
        </div>
        <div className="fdw-box fdw-ids">
          <div className="fdw-row"><label className="fdw-l">Folyo No</label><input className="input fdw-ro num" value={folio?.folioNumber ?? ''} readOnly />
            <label className="fdw-l">Oda No</label><input className="input fdw-ro" value={r.roomNumber ?? ''} readOnly /></div>
          <div className="fdw-row"><label className="fdw-l">Durum</label><input className="input fdw-ro" value={STATUS_LABEL[r.status] ?? r.status} readOnly />
            <label className="fdw-l">Tel</label><input className="input" value={d.phone} disabled={!can('guest.edit')} onChange={e => set('phone', e.target.value)} maxLength={30} /></div>
          <div className="fdw-row"><button className="btn sm" disabled={!editable} onClick={() => setDlg('edit')}>Rez. <ChevronDown size={12} /></button><input className="input fdw-ro num" value={r.reservationNumber} readOnly />
            <label className="fdw-l">Oda Tipi</label>
            <select className="input" value={r.roomTypeId} disabled>{types.data?.map(t => <option key={t.id} value={t.id}>{t.code}</option>)}</select></div>
        </div>
      </div>

      <div className="fdw-mid">
        <div className="fdw-box">
          <div className="fdw-grid">
            <label className="fdw-l">CheckIn</label>
            <div className="row" style={{ gap: 4 }}><input className="input fdw-ro" value={fmtDate(r.arrival)} readOnly /><input className="input fdw-ro fdw-time" value={r.checkedInAt ? time(r.checkedInAt) : (r.eta?.slice(0, 5) ?? '')} readOnly /></div>
            <label className="fdw-l">Fatura</label>
            <select className="input fdw-yellow" value={d.invoiceType} disabled={!editable} onChange={e => set('invoiceType', e.target.value as Draft['invoiceType'])}><option value="invoice">Fatura</option><option value="receipt">Fiş</option></select>

            <label className="fdw-l">CheckOut</label>
            <div className="row" style={{ gap: 4 }}>
              <input className="input fdw-click" value={fmtDate(r.departure)} readOnly title="Çıkış tarihini değiştir" onClick={() => editable && setDlg('extend')} />
              <input type="time" className="input fdw-time" value={d.etd} disabled={!editable} onChange={e => set('etd', e.target.value)} />
            </div>
            <label className="fdw-l">Kart No</label>
            <input className="input fdw-ro" value={sharers.data?.find(s => s.isPrimary)?.keyCardNo ?? ''} readOnly title="Kart, alttaki misafir satırından Kart Ver ile kaydedilir" />

            <label className="fdw-l">T.Gün</label>
            <input className="input fdw-ro num fdw-short" value={r.nights} readOnly />
            <label className="fdw-l">Kart Tipi</label>
            <input className="input" list="fdw-card-types" value={d.keyCardType} disabled={!editable} onChange={e => set('keyCardType', e.target.value)} maxLength={30} />

            <label className="fdw-l">İnd (%)</label>
            <div className="row" style={{ gap: 4 }}>
              <input className="input num fdw-short" inputMode="decimal" value={d.discountPct} disabled={!editable || !can('rate.override')} onChange={e => set('discountPct', e.target.value.replace(/[^\d.,]/g, ''))} />
              <button className="btn sm" disabled={!editable || !can('rate.override') || pct(d.discountPct) === disc || d.rateLocked} title="İndirimi postalanmamış gecelerin fiyatına uygula" onClick={() => void applyDiscount()}>İnd. G.</button>
            </div>
            <label className="fdw-l">Kredi Limiti</label>
            <MoneyInput value={d.creditLimit} onChange={v => set('creditLimit', v || '0')} placeholder="0 = limitsiz" />

            <span />
            <label className="fdw-chk"><input type="checkbox" checked={d.noManualCharges} disabled={!editable} onChange={e => set('noManualCharges', e.target.checked)} /> Manuel Harcama Yapılamaz</label>
          </div>
          <datalist id="fdw-card-types"><option value="GENEL" /><option value="VIP" /><option value="PERSONEL" /></datalist>
          <div className="fdw-tabs">
            <button className={tab === 'note' ? 'active' : ''} onClick={() => setTab('note')}>Not</button>
            <button className={tab === 'info' ? 'active' : ''} onClick={() => setTab('info')}>Bilgi Notu</button>
            <button className={tab === 'prefs' ? 'active' : ''} onClick={() => setTab('prefs')}>Tercihler</button>
          </div>
          <div className="fdw-tabbody">
            {tab === 'note' && <>
              <label className="fdw-chk"><input type="checkbox" checked={d.noteOnCheckout} disabled={!editable} onChange={e => set('noteOnCheckout', e.target.checked)} /> CheckOut sırasında göster</label>
              <textarea className="input" rows={3} value={d.notes} disabled={!editable} onChange={e => set('notes', e.target.value)} maxLength={4000} />
            </>}
            {tab === 'info' && <textarea className="input" rows={4} value={d.specialRequests} disabled={!editable} onChange={e => set('specialRequests', e.target.value)} maxLength={2000} />}
            {tab === 'prefs' && <textarea className="input" rows={4} value={d.preferences} disabled={!can('guest.edit')} onChange={e => set('preferences', e.target.value)} placeholder="Misafir kartındaki tercihler" />}
          </div>
        </div>

        <div className="fdw-box fdw-price">
          <div className="fdw-pgrid">
            <span /><b>{priceCur}</b><b>{priceCur}</b>
            <label className="fdw-l">Oda F.</label>
            <input className="input fdw-ro num" value={fmtMoney(contract.toFixed(2))} readOnly title="Kontrat (indirimsiz) gecelik fiyat" />
            <input className="input fdw-ro num" value={fmtMoney(applied.toFixed(2))} readOnly title="Uygulanan gecelik fiyat" />
          </div>
          <div className="fdw-pbtns">
            <button className="btn sm" onClick={() => setDlg('kontrat')}>Fiyat Detayı...</button>
            <button className="btn sm" onClick={() => setDlg('plan')}>Plan...</button>
            <button className="btn sm" onClick={() => setDlg('ratelog')}>Fiyat Log</button>
          </div>
          <label className="fdw-chk"><input type="checkbox" checked={d.rateLocked} disabled={!editable || !can('rate.override')} onChange={e => set('rateLocked', e.target.checked)} /> Fiyatı Kilitle</label>
          <div className="fdw-pgrid fdw-master">
            <label className="fdw-l">Ana Folyo</label>
            <input className={`input fdw-ro ${master.data?.masterReservationId ? 'fdw-yellow' : ''}`} readOnly title="Bu odanın harcamalarının yazılacağı oda"
              value={master.data?.masterReservationId ? `Oda ${master.data.masterRoom ?? '—'} · ${master.data.masterGuest ?? ''} (${SCOPE_LABEL[master.data.scope]})` : ''} />
            <button className="btn sm" disabled={!(pre || inHouse) || !can('folio.transfer') || (master.data?.children.some(c => c.status === 'checked_in') ?? false)}
              title={master.data?.children.some(c => c.status === 'checked_in') ? 'Bu oda başka odaların ana folyosu' : 'Ana folyo seç'} onClick={() => setDlg('master')}>…</button>
          </div>
          {!!master.data?.children.filter(c => c.status === 'checked_in').length && (
            <div className="fdw-linked">Bağlı odalar: {master.data.children.filter(c => c.status === 'checked_in').map(c => (
              <button key={c.id} className="btn sm ghost" title={`${c.guestName} · ${SCOPE_LABEL[c.scope]}`} onClick={() => windows?.open({ kind: 'reservation', id: c.id })}>{c.roomNumber ?? '—'}</button>
            ))}</div>
          )}
          <div className="fdw-bal"><label className="fdw-l">Bakiye</label><input className={`input fdw-ro num ${Number(r.balance) > 0 ? 'due' : ''}`} value={fmtMoney(String(-Number(r.balance)))} readOnly title="Misafir açısından bakiye (eksi: misafir borçlu)" /></div>
        </div>
      </div>

      <div className="fdw-box fdw-guests">
        <div className="fdw-gbar">
          <span className="fdw-gtab">Misafirler</span>
          <span className="spacer" />
          <button className="btn sm" disabled={!editable} onClick={() => setDlg('sharer')}>Misafir Ekle</button>
          <button className="btn sm" disabled={!selected} onClick={() => selected && openGuest(selected.id)}>Değiştir</button>
          <button className="btn sm" onClick={guestMenu}>Diğer <ChevronDown size={12} /></button>
          <button className="btn sm" disabled={!selected || !editable} onClick={() => setDlg('card')}>Kart Ver</button>
          <button className="btn sm" disabled={!selected?.keyCardNo || !editable} onClick={() => void keyCard(null)}>Kart Sil</button>
        </div>
        <div className="table-wrap" style={{ maxHeight: 170 }}>
          <table className="dt fdw-gtable">
            <thead><tr><th>Adı Soyadı</th><th>CLIENTID</th><th>Uyruk</th><th>Kart No</th><th style={{ textAlign: 'right' }}>Cari Bakiye</th><th style={{ textAlign: 'right' }}>Yaşı</th><th>Aktif</th></tr></thead>
            <tbody>
              {sharers.data?.map(s => (
                <tr key={s.id} className={`clickable ${sel === s.id ? 'selected' : ''}`} onClick={() => setSel(s.id)} onDoubleClick={() => openGuest(s.id)}>
                  <td>{s.name}{!s.hasIdentity && <span className="badge orange" style={{ marginLeft: 6 }}>Kimlik eksik</span>}</td>
                  <td className="num">{s.guestNo}</td><td>{s.nationality}</td><td className="mono">{s.keyCardNo}</td>
                  <td className="num">{fmtMoney(s.balance)}</td><td className="num">{s.age ?? ''}</td>
                  <td><input type="checkbox" checked={s.isActive} disabled={s.isPrimary || !editable} onClick={e => e.stopPropagation()} onChange={e => void setActive(s, e.target.checked)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {sharers.data?.length === 0 && <Empty title="Misafir yok" />}
        </div>
      </div>

      <div className="fdw-foot">
        <button className="btn" onClick={otherMenu}>Diğer...</button>
        <span className="spacer" />
        <div className="fdw-split">
          <button className="btn" disabled={busy} onClick={async () => { if (await save()) void printFolio(); }}><Printer /> Kaydet&amp;Yaz</button>
          <button className="btn fdw-caret" onClick={() => setPrintMenu(m => !m)} aria-label="Yazdırma seçenekleri"><ChevronDown size={13} /></button>
          {printMenu && (
            <div className="fdw-pop" onMouseLeave={() => setPrintMenu(false)}>
              <button className="btn sm ghost" onClick={() => { setPrintMenu(false); void printFolio(); }}><Printer /> Folyo dökümü</button>
              {(pre || inHouse) && <ConfirmationButton r={r} />}
              {(pre || inHouse) && <KvkkPrintButton reservationId={r.id} primary={{ name: r.guestName, room: r.roomNumber, reservationNumber: r.reservationNumber, arrival: r.arrival, departure: r.departure }} />}
            </div>
          )}
        </div>
        <button className="btn primary" disabled={busy} onClick={() => void close()}>Tamam</button>
        <button className="btn" onClick={() => void cancel()}>Vazgeç</button>
      </div>

      {menu.node}
      {printing && createPortal(<FolioPrint detail={printing} reservation={r} />, document.getElementById('print-root')!)}
      {kbsOpen && can('kbs.manage') && inHouse && <KbsPromptModal reservationId={r.id} onClose={() => setKbsOpen(false)} />}
      {dlg === 'edit' && <ReservationEditModal reservation={r} onClose={() => setDlg(null)} />}
      {dlg === 'checkin' && <CheckInModal reservation={r} onClose={() => setDlg(null)} />}
      {dlg === 'checkout' && <CheckOutModal reservation={r} onClose={() => setDlg(null)} />}
      {dlg === 'move' && <MoveModal reservation={r} onClose={() => setDlg(null)} />}
      {dlg === 'cancel' && <CancelModal reservation={r} onClose={() => setDlg(null)} />}
      {dlg === 'extend' && <ExtendModal reservation={r} onClose={() => setDlg(null)} />}
      {dlg === 'sharer' && <SharerModal reservationId={r.id} onClose={() => setDlg(null)} />}
      {dlg === 'wakeup' && <WakeupModal reservation={r} onClose={() => setDlg(null)} />}
      {dlg === 'kontrat' && <KontratModal r={r} onClose={() => setDlg(null)} />}
      {dlg === 'plan' && <PlanModal r={r} onClose={() => setDlg(null)} />}
      {dlg === 'ratelog' && <HistoryModal r={r} rateOnly onClose={() => setDlg(null)} />}
      {dlg === 'master' && master.data && <MasterModal r={r} info={master.data} onClose={() => setDlg(null)} />}
      {dlg === 'history' && <HistoryModal r={r} onClose={() => setDlg(null)} />}
      {dlg === 'card' && selected && <KeyCardModal sharer={selected} onClose={() => setDlg(null)} onSave={async no => { await keyCard(no); setDlg(null); }} />}
      {dlg === 'traces' && <Modal title="Misafir istekleri / hatırlatmalar" size="lg" onClose={() => setDlg(null)}><ReservationTraces reservationId={r.id} arrival={r.arrival} departure={r.departure} open={pre || inHouse} /></Modal>}
      {dlg === 'docs' && <Modal title="Belgeler" size="lg" onClose={() => setDlg(null)}><DocumentsPanel entityType="reservation" entityId={r.id} canEdit={can('reservation.edit')} /></Modal>}
    </div>
  );
}

/** Rezervasyon kontrat detayı: dönem bilgisi ve kişi sayısına göre oda fiyatları (Sng/Dbl/Trp/Quad). */
function KontratModal({ r, onClose }: { r: Reservation; onClose: () => void }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const [o, setO] = useState({ sgl: r.rateSgl ?? '', dbl: r.rateDbl ?? '', trp: r.rateTrp ?? '', quad: r.rateQuad ?? '' });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const cur = r.rateCurrency ?? r.currency;
  const nightly = r.rateCurrency ? r.fxNightlyRate : r.nightlyRate;
  const n = (v: string) => (v === '' ? null : v);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await api('PUT', `/api/v1/reservations/${r.id}`, {
        guestId: r.guestId, newGuest: null, companyId: r.companyId ?? null, agencyId: r.agencyId ?? null, groupId: r.groupId ?? null, roomTypeId: r.roomTypeId, roomId: r.roomId ?? null,
        arrival: r.arrival, departure: r.departure, adults: r.adults, children: r.children, ratePlanId: r.ratePlanId ?? null, nightlyRate: null, rateCurrency: r.rateCurrency ?? null,
        channel: r.channel ?? null, channelRef: r.channelRef ?? null, mealPlan: r.mealPlan, status: r.status, source: r.source, market: r.market ?? null, segment: r.segment ?? null,
        eta: r.eta ?? null, etd: r.etd ?? null, notes: r.notes ?? null, specialRequests: r.specialRequests ?? null, depositRequired: r.depositRequired, optionUntil: r.optionUntil ?? null,
        version: r.version, occupancy: { single: n(o.sgl), double: n(o.dbl), triple: n(o.trp), quad: n(o.quad) },
      }, { key: newKey() });
      await qc.invalidateQueries({ predicate: q => ['reservation', 'reservations', 'roomStatus', 'rack'].includes(String(q.queryKey[0])) });
      onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const ro = !can('rate.override') || r.rateLocked || !['tentative', 'confirmed', 'checked_in'].includes(r.status);
  return (
    <Modal title={`Rezervasyon Kontrat Detay · ${r.reservationNumber}`} size="lg" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={ro || busy} onClick={() => void save()}>Tamam</button>
    </>}>
      <div className="kontrat">
        <div className="muted" style={{ marginBottom: 8 }}>Rezervasyonun konaklaması boyunca uygulanacak kontrat fiyatları</div>
        <div className="kontrat-grid">
          <fieldset><legend>Dönem Bilgisi</legend>
            <div className="kv-mini"><span>Başlangıç</span><b>{fmtDate(r.arrival)}</b></div>
            <div className="kv-mini"><span>Sezon</span><b>{r.ratePlanCode ?? ([r.rateSgl, r.rateDbl, r.rateTrp, r.rateQuad].some(v => v != null) ? 'ÖZEL FİYAT' : 'Oda tipi varsayılanı')}</b></div>
            <div className="kv-mini"><span>Günlük Oda</span><b>{fmtMoney(nightly, cur)}</b></div>
            <div className="kv-mini"><span>Günlük T.</span><b>{fmtMoney(nightly, cur)}</b></div>
          </fieldset>
          <fieldset><legend>Oda Fiyatları</legend>
            <Field label="Sng"><MoneyInput value={o.sgl} onChange={v => setO(s => ({ ...s, sgl: v }))} /></Field>
            <Field label="Dbl"><MoneyInput value={o.dbl} onChange={v => setO(s => ({ ...s, dbl: v }))} /></Field>
            <Field label="Trp"><MoneyInput value={o.trp} onChange={v => setO(s => ({ ...s, trp: v }))} /></Field>
            <Field label="Quad"><MoneyInput value={o.quad} onChange={v => setO(s => ({ ...s, quad: v }))} /></Field>
          </fieldset>
        </div>
        {r.rateLocked && <div className="warn-box" style={{ marginTop: 8 }}>Fiyat kilitli; değiştirmek için folyoda "Fiyatı Kilitle" işaretini kaldırın.</div>}
        {!can('rate.override') && <div className="muted" style={{ marginTop: 8 }}>Fiyat değiştirme yetkiniz yok.</div>}
        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>Yetişkin sayısına karşılık gelen fiyat uygulanır ({r.adults} yetişkin); kişi sayısı değişince (ek misafir eklenince de) fiyat kendiliğinden ayarlanır.</div>
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

/** Gece gece uygulanacak oda fiyatları. */
function PlanModal({ r, onClose }: { r: Reservation; onClose: () => void }) {
  const rates = useQuery({ queryKey: ['reservation', r.id, 'rates'], queryFn: () => get<{ date: string; rate: string }[]>(`/api/v1/reservations/${r.id}/rates`) });
  return (
    <Modal title={`Fiyat planı · ${r.reservationNumber}`} onClose={onClose} footer={<button className="btn" onClick={onClose}>Kapat</button>}>
      {rates.isLoading ? <Spinner /> : (
        <table className="dt"><thead><tr><th>Gece</th><th style={{ textAlign: 'right' }}>Fiyat</th></tr></thead>
          <tbody>{rates.data?.map(x => <tr key={x.date}><td>{fmtDate(x.date)}</td><td className="num">{fmtMoney(x.rate, r.currency)}</td></tr>)}</tbody>
          <tfoot><tr><td>Toplam</td><td className="num"><b>{fmtMoney(r.totalRate, r.currency)}</b></td></tr></tfoot></table>
      )}
    </Modal>
  );
}

/** İşlem geçmişi; rateOnly: yalnız fiyatı etkileyen işlemler (Fiyat Log). */
function HistoryModal({ r, rateOnly, onClose }: { r: Reservation; rateOnly?: boolean; onClose: () => void }) {
  const history = useQuery({ queryKey: ['reservation', r.id, 'history'], queryFn: () => get<AuditRow[]>(`/api/v1/reservations/${r.id}/history`) });
  const rows = (history.data ?? []).filter(h => !rateOnly || RATE_ACTIONS.includes(h.action));
  return (
    <Modal title={`${rateOnly ? 'Fiyat Log' : 'İşlem geçmişi'} · ${r.reservationNumber}`} size="lg" onClose={onClose} footer={<button className="btn" onClick={onClose}>Kapat</button>}>
      {history.isLoading ? <Spinner /> : rows.length === 0 ? <Empty title="Kayıt yok" /> : (
        <table className="dt"><thead><tr><th>Zaman</th><th>Kullanıcı</th><th>İşlem</th><th>Gerekçe</th></tr></thead>
          <tbody>{rows.map((h, i) => <tr key={i}><td>{fmtDateTime(h.at)}</td><td>{h.username}</td><td>{h.action}</td><td>{h.reason}</td></tr>)}</tbody></table>
      )}
    </Modal>
  );
}

/** Kart Ver: oda kartı numarası kaydı (kapı kilidi entegrasyonu gelene kadar kart elle tanımlanır). */
function KeyCardModal({ sharer, onClose, onSave }: { sharer: Sharer; onClose: () => void; onSave: (no: string) => Promise<void> }) {
  const [no, setNo] = useState(sharer.keyCardNo ?? '');
  return (
    <Modal title={`Kart Ver · ${sharer.name}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!no.trim()} onClick={() => void onSave(no.trim())}>Kaydet</button>
    </>}>
      <Field label="Kart No" hint="Kodlanan oda kartının numarası. Kapı kilidi sistemi bağlandığında kart buradan kodlanacak."><input className="input mono" value={no} onChange={e => setNo(e.target.value)} maxLength={40} autoFocus /></Field>
    </Modal>
  );
}

/** Hesap hareketleri penceresi: masraf, tahsilat, iade, indirim ve aktarımlar (folyo pencereleri). */
export function FolioLinesView({ id, action }: { id: string; action?: string }) {
  const win = useWinSelf();
  const { can } = useSession();
  const res = useQuery({ queryKey: ['reservation', id], queryFn: () => get<Reservation>(`/api/v1/reservations/${id}`) });
  useEffect(() => { if (res.data && win) win.setTitle(`Hesap Hareketleri · ${res.data.roomNumber ? `Oda ${res.data.roomNumber} · ` : ''}${res.data.guestName}`); }, [res.data, win]);
  if (res.isLoading) return <div className="page"><Spinner /></div>;
  if (res.error || !res.data) return <div className="page"><ErrorBox error={res.error} /></div>;
  if (!can('folio.view')) return <div className="page"><Empty title="Folyo görüntüleme yetkiniz yok" /></div>;
  return <div className="page"><FolioPanel reservation={res.data} initialDialog={action === 'charge' || action === 'payment' ? action : undefined} /></div>;
}

const SCOPE_LABEL: Record<MasterScope, string> = { all: 'tüm harcamalar', room: 'yalnız oda ücreti', extras: 'yalnız ekstralar' };

/** Ana folyo seçimi: bu odanın harcamaları (seçilen kapsamda) konaklayan başka bir odanın folyosuna yazılır. */
function MasterModal({ r, info, onClose }: { r: Reservation; info: MasterInfo; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const inhouse = useQuery({ queryKey: ['reservations', 'inhouse-picker'], queryFn: () => get<Paged<ReservationListItem>>(`/api/v1/reservations?view=inhouse&pageSize=500`) });
  const [mid, setMid] = useState(info.masterReservationId ?? '');
  const [scope, setScope] = useState<MasterScope>(info.scope);
  const [busy, setBusy] = useState(false);
  const rooms = (inhouse.data?.items ?? []).filter(x => x.id !== r.id && x.roomNumber && x.currency === r.currency)
    .sort((a, b) => (a.roomNumber ?? '').localeCompare(b.roomNumber ?? '', 'tr', { numeric: true }));
  const save = async (masterId: string | null) => {
    setBusy(true);
    try {
      await put(`/api/v1/reservations/${r.id}/master`, { masterReservationId: masterId, scope });
      await qc.invalidateQueries({ predicate: q => ['reservation', 'reservations'].includes(String(q.queryKey[0])) });
      toast.ok(masterId ? 'Ana folyo bağlandı.' : 'Ana folyo bağlantısı kaldırıldı.');
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal title="Ana Folyo" onClose={onClose} footer={<>
      {info.masterReservationId && <button className="btn danger" disabled={busy} onClick={() => void save(null)}>Bağlantıyı kaldır</button>}
      <span className="spacer" />
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={busy || !mid} onClick={() => void save(mid)}>Kaydet</button>
    </>}>
      <div className="stack">
        <Field label="Ana oda (konaklayan)">
          <select className="input" value={mid} onChange={e => setMid(e.target.value)} autoFocus>
            <option value="" />{rooms.map(x => <option key={x.id} value={x.id}>{x.roomNumber} · {x.guestName}</option>)}
          </select>
        </Field>
        <Field label="Ana folyoya yazılacaklar">
          <div className="stack" style={{ gap: 6 }}>
            {(['all', 'room', 'extras'] as const).map(k => (
              <label key={k} className="fdw-chk"><input type="radio" name="master-scope" checked={scope === k} onChange={() => setScope(k)} />
                {k === 'all' ? 'Tüm harcamalar (oda ücreti ve ekstralar)' : k === 'room' ? 'Yalnız oda ücreti ve konaklama vergisi' : 'Yalnız ekstralar (masraflar, restoran)'}</label>
            ))}
          </div>
        </Field>
        <div className="muted" style={{ fontSize: 12 }}>Bağlantıdan sonraki masraflar ana odanın folyosuna "· Oda {r.roomNumber ?? ''}" notuyla yazılır; önceki satırlar yerinde kalır.
          Ana odanın çıkışı, bağlı odalar konaklarken yapılamaz.</div>
      </div>
    </Modal>
  );
}
