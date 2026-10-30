import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, qs } from '../lib/api';
import type { Folio, Paged, ReservationListItem, Shift } from '../lib/types';
import { fmtDate, fmtMoney } from '../lib/format';
import { useTransactionCodes } from '../lib/queries';
import { useSession } from '../lib/session';
import { useAction } from '../components/common';
import { CodePicker } from '../components/CodePicker';
import { ErrorBox, MoneyInput, Spinner } from '../components/ui';
import { useWinSelf } from '../components/Windows';

export type ChargeMode = 'misc' | 'telephone' | 'paidout' | 'adjust';
const CHARGE_TITLE: Record<ChargeMode, string> = { misc: 'Muhtelif Harcama', telephone: 'Telefon / Fax', paidout: 'Misafir Paid-Out', adjust: 'Tutar Düzeltme' };

/**
 * Harcama penceresi (Folyo → Harcama menüsü): oda numarası seçilir, işlem odanın folyosuna yazılır.
 * Muhtelif ve Telefon/Fax masraf; Paid-Out kasadan misafir adına ödeme; Tutar Düzeltme folyo düzeltmesi (indirim) yazar.
 */
export function ChargeView({ mode, reservationId }: { mode: ChargeMode; reservationId?: string }) {
  const { property, me } = useSession();
  const self = useWinSelf();
  const qc = useQueryClient();
  const codes = useTransactionCodes();
  const inhouse = useQuery({ queryKey: ['reservations', 'inhouse-picker'], queryFn: () => get<Paged<ReservationListItem>>(`/api/v1/reservations${qs({ view: 'inhouse', pageSize: 500 })}`) });
  const shift = useQuery({ queryKey: ['cashier', 'current'], queryFn: () => get<Shift | null>('/api/v1/cashier/current'), enabled: mode === 'paidout' });

  const [resId, setResId] = useState(reservationId ?? '');
  const [folioSel, setFolioSel] = useState('');
  const [codeId, setCodeId] = useState('');
  const [desc, setDesc] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [reference, setReference] = useState('');
  const [kind, setKind] = useState<'allowance' | 'discount'>('allowance');
  const [keepOpen, setKeepOpen] = useState(false);

  const folios = useQuery({ queryKey: ['folios', resId], queryFn: () => get<Folio[]>(`/api/v1/folios${qs({ reservationId: resId })}`), enabled: !!resId });
  const open = (folios.data ?? []).filter(f => f.status === 'open');
  const folioId = folioSel && open.some(f => f.id === folioSel) ? folioSel : open[0]?.id ?? '';
  const folio = open.find(f => f.id === folioId);
  const res = inhouse.data?.items.find(r => r.id === resId);

  const allCodes = codes.data?.filter(c => c.isActive && c.category !== 'room' && c.category !== 'tax') ?? [];
  const deptCodes = mode === 'telephone' ? allCodes.filter(c => c.category === 'telephone') : allCodes;
  const code = deptCodes.find(c => c.id === codeId);
  const lineAmount = Math.round(Number(qty.replace(',', '.')) * Number(price) * 100) / 100;
  const noShift = mode === 'paidout' && shift.isFetched && !shift.data;

  const ok = !!folioId && (
    mode === 'misc' || mode === 'telephone' ? !!codeId && Number(price) > 0 && Number(qty.replace(',', '.')) > 0
      : mode === 'paidout' ? Number(price) > 0 && !!desc.trim() && !noShift
        : Number(price) > 0 && !!desc.trim());

  const save = useAction(async (key: string) => {
    if (mode === 'misc' || mode === 'telephone')
      await post(`/api/v1/folios/${folioId}/charges`, { transactionCodeId: codeId, description: desc.trim() || null, quantity: qty.replace(',', '.'), unitPrice: price, reference: reference.trim() || null }, key);
    else if (mode === 'paidout')
      await post(`/api/v1/folios/${folioId}/paid-out`, { amount: price, description: desc.trim(), reference: reference.trim() || null }, key);
    else
      await post(`/api/v1/folios/${folioId}/discounts`, { kind, amount: price, reason: desc.trim(), relatedLineId: null }, key);
    await qc.invalidateQueries({ predicate: q => ['folio', 'folios', 'reservation', 'reservations', 'dashboard', 'cashier', 'rooms'].includes(String(q.queryKey[0])) });
  }, { success: `${CHARGE_TITLE[mode]} kaydedildi.` });

  const finish = async () => {
    if (await save.run() === undefined) return;
    if (keepOpen || !self) { setCodeId(''); setDesc(''); setQty('1'); setPrice(''); setReference(''); if (!reservationId) setResId(''); }
    else self.close();
  };

  if (codes.isLoading || inhouse.isLoading) return <Spinner />;
  const rooms = [...(inhouse.data?.items ?? [])].filter(r => r.roomNumber).sort((a, b) => (a.roomNumber ?? '').localeCompare(b.roomNumber ?? '', 'tr', { numeric: true }));

  return (
    <div className="psw">
      <div className="psw-box">
        <label className="psw-l">Oda No</label>
        <select className="input" value={resId} onChange={e => { setResId(e.target.value); setFolioSel(''); }} autoFocus={!reservationId}>
          <option value="" />{rooms.map(r => <option key={r.id} value={r.id}>{r.roomNumber} · {r.guestName}</option>)}
        </select>
        {res && <><span /><div className="psw-hint">{res.reservationNumber} · {fmtDate(res.arrival)} – {fmtDate(res.departure)}{folio ? ` · Bakiye ${fmtMoney(folio.balance, folio.currency)}` : ''}</div></>}
        {open.length > 1 && <>
          <label className="psw-l">Folyo</label>
          <select className="input" value={folioId} onChange={e => setFolioSel(e.target.value)}>{open.map(f => <option key={f.id} value={f.id}>Pencere {f.windowNo} · {f.name}</option>)}</select>
        </>}
        {resId && folios.isFetched && open.length === 0 && <><span /><div className="error-box">Bu konaklamanın açık folyosu yok.</div></>}
      </div>

      <div className="psw-box">
        {(mode === 'misc' || mode === 'telephone') && <>
          <label className="psw-l">Departman</label>
          <div className="psw-code">
            <CodePicker codes={deptCodes} value={codeId} onChange={id => { setCodeId(id); const c = deptCodes.find(x => x.id === id); if (c?.defaultPrice && !price) setPrice(c.defaultPrice); }} autoFocus={!!reservationId} />
            <input className="input psw-ro" readOnly tabIndex={-1} value={code?.name ?? ''} />
          </div>
          {mode === 'telephone' && deptCodes.length === 0 && <><span /><div className="warn-box">Telefon kategorisinde işlem kodu yok. İşlem Kodları ekranında kategorisi "Telefon" olan bir kod ekleyin.</div></>}
          <label className="psw-l">Açıklama</label>
          <input className="input" value={desc} onChange={e => setDesc(e.target.value)} maxLength={300} placeholder={code?.name} />
          <label className="psw-l">Miktar</label>
          <input className="input num" value={qty} onChange={e => setQty(e.target.value.replace(/[^\d.,]/g, ''))} inputMode="decimal" />
          <label className="psw-l">Birim Fiyat</label>
          <MoneyInput value={price} onChange={setPrice} />
          {lineAmount > 0 && Number(qty.replace(',', '.')) !== 1 && <><span /><div className="psw-hint">Tutar {fmtMoney(lineAmount.toFixed(2), property?.currency)}</div></>}
          <label className="psw-l">Referans</label>
          <input className="input" value={reference} onChange={e => setReference(e.target.value)} maxLength={100} />
        </>}
        {mode === 'paidout' && <>
          <label className="psw-l">Tutar</label>
          <MoneyInput value={price} onChange={setPrice} autoFocus={!!reservationId} />
          <label className="psw-l">Açıklama</label>
          <input className="input" value={desc} onChange={e => setDesc(e.target.value)} maxLength={250} placeholder="ör. Kargo ücreti, taksi" />
          <label className="psw-l">Referans</label>
          <input className="input" value={reference} onChange={e => setReference(e.target.value)} maxLength={100} placeholder="Fiş / makbuz no" />
          <span /><div className="psw-hint">Tutar kasadan nakit olarak çıkar ve misafirin folyosuna borç yazılır.</div>
        </>}
        {mode === 'adjust' && <>
          <label className="psw-l">Tür</label>
          <select className="input" value={kind} onChange={e => setKind(e.target.value as 'allowance' | 'discount')}><option value="allowance">Düzeltme</option><option value="discount">İndirim</option></select>
          <label className="psw-l">Tutar</label>
          <MoneyInput value={price} onChange={setPrice} autoFocus={!!reservationId} />
          <label className="psw-l">Gerekçe</label>
          <input className="input" value={desc} onChange={e => setDesc(e.target.value)} maxLength={300} />
          <span /><div className="psw-hint">Tutar folyodan düşülür (alacak). Satır silinmez; gerekçesiyle kaydedilir.</div>
        </>}
        <label className="psw-l">Kullanıcı</label>
        <div className="psw-amt">
          <input className="input psw-ro" readOnly tabIndex={-1} value={me?.fullName || me?.username || ''} />
          <input className="input psw-ro psw-date" readOnly tabIndex={-1} value={fmtDate(property?.businessDate)} title="İş günü" />
        </div>
      </div>

      {noShift && <div className="error-box">Paid-Out için açık kasa vardiyanız yok. Ön Kasa → Kasa Vardiyası ekranından vardiya açın.</div>}
      <ErrorBox error={save.error} />
      <div className="psw-foot">
        <label className="fdw-chk"><input type="checkbox" checked={keepOpen} onChange={e => setKeepOpen(e.target.checked)} /> Sürekli</label>
        <span className="spacer" />
        <button className="btn primary" disabled={!ok || save.busy} onClick={() => void finish()}>{save.busy ? 'Kaydediliyor…' : 'Tamam'}</button>
        {self && <button className="btn" onClick={self.close}>Vazgeç</button>}
      </div>
    </div>
  );
}
