import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BedDouble, Gift, Plus, Search } from 'lucide-react';
import { get, post, put } from '../lib/api';
import type { ExchangeRatesView, InHouseRoom, PosCheck, PosCheckDetail } from '../lib/types';
import { fmtMoney, parseDecimal } from '../lib/format';
import { usePaymentMethods } from '../lib/queries';
import { useSession } from '../lib/session';
import { useAction } from './common';
import { Badge, Empty, ErrorBox, Field, Modal, MoneyInput, Spinner, Tabs } from './ui';

/** Adisyon diyalogları: masaüstü satış ekranı ve telefon garson uygulaması ortak kullanır. */

export function VoidLineModal({ line, onClose, onDone }: { line: { id: string; name: string }; onClose: () => void; onDone: (r: PosCheckDetail) => void }) {
  const [reason, setReason] = useState('');
  const act = useAction(async (key: string) => onDone(await post<PosCheckDetail>(`/api/v1/pos/check-lines/${line.id}/void`, { reason: reason.trim() }, key)));
  return (
    <Modal title={`${line.name} · iptal`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn danger" disabled={!reason.trim() || act.busy} onClick={() => void act.run()}>İptal et</button></>}>
      <div className="stack">
        <div className="muted" style={{ fontSize: 12 }}>Kendi eklediğiniz ürünü mutfağa/bara gönderilmeden 2 dakika içinde iptal edebilirsiniz; gönderilmiş ürün ve sonrası için iptal yetkisi gerekir. İptaller raporda görünür.</div>
        <Field label="Gerekçe" required><input className="input" list="pos-void-reasons" value={reason} onChange={e => setReason(e.target.value)} autoFocus maxLength={200} />
          <datalist id="pos-void-reasons">{['Yanlış ürün', 'Misafir vazgeçti', 'Mutfakta yok', 'İade'].map(x => <option key={x} value={x} />)}</datalist></Field>
        <ErrorBox error={act.error} />
      </div>
    </Modal>
  );
}

export function DiscountModal({ check, onClose, onDone }: { check: PosCheck; onClose: () => void; onDone: (r: PosCheckDetail) => void }) {
  const [mode, setMode] = useState<'amount' | 'percent'>('amount');
  const [v, setV] = useState(Number(check.discountAmount) > 0 ? check.discountAmount : '');
  const [pct, setPct] = useState('');
  const [reason, setReason] = useState(check.discountReason ?? '');
  const p = parseDecimal(pct, 2);
  const amount = mode === 'amount' ? v : p ? (Math.round(Number(check.subtotal) * Number(p)) / 100).toFixed(2) : '';
  const act = useAction(async (key: string) => onDone(await post<PosCheckDetail>(`/api/v1/pos/checks/${check.id}/discount`, { amount: amount || '0', reason: reason.trim() || null, version: check.version }, key)),
    { success: 'İndirim uygulandı.' });
  const zero = !amount || Number(amount) === 0;
  return (
    <Modal title="Adisyon indirimi" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={act.busy || (!zero && !reason.trim()) || Number(amount) > Number(check.subtotal)} onClick={() => void act.run()}>{zero ? 'İndirimi kaldır' : 'Uygula'}</button></>}>
      <div className="form-grid">
        <Field label="Tür" className="span-2"><select className="input" value={mode} onChange={e => setMode(e.target.value as 'amount' | 'percent')}><option value="amount">Tutar</option><option value="percent">Yüzde</option></select></Field>
        {mode === 'amount' ? <Field label="İndirim tutarı" className="span-2" hint={`Ara toplam ${fmtMoney(check.subtotal)}`}><MoneyInput value={v} onChange={setV} autoFocus /></Field>
          : <Field label="İndirim %" className="span-2" hint={amount ? `= ${fmtMoney(amount)}` : undefined}><input className="input num" value={pct} onChange={e => setPct(e.target.value)} autoFocus /></Field>}
        <Field label="Gerekçe" required={!zero} className="span-4" hint="İkram için tamamına indirim uygulayıp 'İkram' ile kapatın."><input className="input" value={reason} onChange={e => setReason(e.target.value)} maxLength={200} /></Field>
      </div>
      <ErrorBox error={act.error} />
    </Modal>
  );
}

export function EditCheckModal({ check, onClose, onDone }: { check: PosCheck; onClose: () => void; onDone: (r: PosCheckDetail) => void }) {
  const [table, setTable] = useState(check.tableLabel ?? '');
  const [covers, setCovers] = useState(String(check.covers));
  const [note, setNote] = useState(check.note ?? '');
  const act = useAction(async () => onDone(await put<PosCheckDetail>(`/api/v1/pos/checks/${check.id}`, { tableLabel: table.trim() || null, covers: Number(covers), note: note.trim() || null, version: check.version })));
  return (
    <Modal title={`Adisyon #${check.checkNo}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={act.busy || !(Number(covers) >= 1)} onClick={() => void act.run()}>Kaydet</button></>}>
      <div className="form-grid">
        <Field label="Masa / yer" className="span-2"><input className="input" value={table} onChange={e => setTable(e.target.value)} autoFocus maxLength={30} /></Field>
        <Field label="Kişi sayısı" className="span-2"><input className="input num" value={covers} onChange={e => setCovers(e.target.value.replace(/\D/g, ''))} /></Field>
        <Field label="Not" className="span-4"><input className="input" value={note} onChange={e => setNote(e.target.value)} maxLength={500} /></Field>
      </div>
      <ErrorBox error={act.error} />
    </Modal>
  );
}

export function CancelCheckModal({ check, onClose, onDone }: { check: PosCheck; onClose: () => void; onDone: (r: PosCheckDetail) => void }) {
  const [reason, setReason] = useState('');
  const act = useAction(async (key: string) => onDone(await post<PosCheckDetail>(`/api/v1/pos/checks/${check.id}/cancel`, { reason: reason.trim(), version: check.version }, key)),
    { success: 'Adisyon iptal edildi.' });
  const closed = check.status === 'closed';
  return (
    <Modal title={`Adisyon #${check.checkNo} iptali`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn danger" disabled={!reason.trim() || act.busy} onClick={() => void act.run()}>İptal et</button></>}>
      <div className="stack">
        {closed && <div className="warn-box">Kapanmış adisyon iptal edilirse {check.settlement === 'room' ? 'odaya aktarılan masraf folyodan iptal edilir' : check.settlement === 'payment' ? 'ödemeler kasanızdan ters kayıtla geri alınır' : 'ikram kaydı iptal edilir'}; reçeteyle düşülen stok geri yüklenir.</div>}
        <Field label="Gerekçe" required><input className="input" value={reason} onChange={e => setReason(e.target.value)} autoFocus maxLength={300} /></Field>
        <ErrorBox error={act.error} />
      </div>
    </Modal>
  );
}

interface PayRow { methodId: string; currency: string; amount: string; reference: string }

export function SettleModal({ detail, pending, onClose, onDone }: { detail: PosCheckDetail; pending: number; onClose: () => void; onDone: (r: PosCheckDetail) => void }) {
  const { property, can } = useSession();
  const c = detail.check;
  const base = property?.currency ?? 'TRY';
  const zero = Number(c.total) === 0;
  const [mode, setMode] = useState<'payment' | 'room' | 'complimentary'>(zero ? 'complimentary' : 'payment');
  const methods = usePaymentMethods();
  const fx = useQuery({ queryKey: ['exchangeRates'], queryFn: () => get<ExchangeRatesView>('/api/v1/exchange-rates') });
  const rooms = useQuery({ queryKey: ['pos', 'inhouse'], queryFn: () => get<InHouseRoom[]>('/api/v1/pos/in-house'), enabled: mode === 'room' });
  const usable = (methods.data ?? []).filter(m => m.isActive && !['city_ledger', 'company', 'agency'].includes(m.kind));
  const [rows, setRows] = useState<PayRow[]>([{ methodId: '', currency: base, amount: c.total, reference: '' }]);
  const [room, setRoom] = useState('');
  const [rq, setRq] = useState('');
  const [received, setReceived] = useState('');
  const rateOf = (cur: string) => (cur === base ? 1 : Number(fx.data?.rates.find(r => r.currency === cur)?.rate ?? 0));
  const inBase = (r: PayRow) => (r.amount ? Math.round(Number(r.amount) * rateOf(r.currency) * 100) / 100 : 0);
  const paid = rows.reduce((s, r) => s + inBase(r), 0);
  const remaining = Math.round((Number(c.total) - paid) * 100) / 100;
  const setRow = (i: number, p: Partial<PayRow>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const cashRow = rows.find(r => usable.find(m => m.id === r.methodId)?.kind === 'cash' && r.currency === base);
  const change = cashRow && received ? Number(received) - Number(cashRow.amount) : 0;

  const close = useAction(async (key: string) => {
    const body = mode === 'payment'
      ? { settlement: 'payment', payments: rows.filter(r => r.methodId && r.amount).map(r => r.currency === base
        ? { paymentMethodId: r.methodId, amount: r.amount, reference: r.reference.trim() || null }
        : { paymentMethodId: r.methodId, amount: inBase(r).toFixed(2), tenderedCurrency: r.currency, tenderedAmount: r.amount, reference: r.reference.trim() || null }), version: c.version }
      : mode === 'room' ? { settlement: 'room', reservationId: room, version: c.version } : { settlement: 'complimentary', version: c.version };
    onDone(await post<PosCheckDetail>(`/api/v1/pos/checks/${c.id}/close`, body, key));
  }, { success: 'Adisyon kapatıldı.' });

  const ok = mode === 'complimentary' ? zero : mode === 'room' ? !!room && !zero
    : !zero && rows.every(r => !r.amount || (r.methodId && (!usable.find(m => m.id === r.methodId)?.requiresReference || r.reference.trim()) && rateOf(r.currency) > 0))
      && rows.some(r => r.methodId && r.amount) && Math.abs(remaining) <= 0.05;
  const shownRooms = (rooms.data ?? []).filter(r => !rq.trim() || `${r.roomNumber} ${r.guestName}`.toLocaleLowerCase('tr-TR').includes(rq.trim().toLocaleLowerCase('tr-TR')));

  return (
    <Modal title={`Adisyon #${c.checkNo} · ${fmtMoney(c.total, base)}`} size="lg" onClose={onClose} footer={<>
      {mode === 'payment' && <span className={Math.abs(remaining) > 0.05 ? 'amount-neg' : 'muted'}>Kalan: <b>{fmtMoney(remaining.toFixed(2), base)}</b></span>}<span className="spacer" />
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!ok || close.busy} onClick={() => void close.run()}>{close.busy ? 'Kapatılıyor…' : 'Adisyonu kapat'}</button>
    </>}>
      <div className="stack">
        {pending > 0 && <div className="warn-box">Mutfağa gönderilmemiş {pending} ürün var. Hazırlanması gerekiyorsa önce gönderin.</div>}
        <Tabs value={mode} onChange={setMode} items={[{ key: 'payment' as const, label: 'Ödeme' }, { key: 'room' as const, label: 'Odaya aktar' }, ...(can('pos.discount') ? [{ key: 'complimentary' as const, label: 'İkram' }] : [])]} />
        {mode === 'payment' && (zero ? <div className="info-box">Tutar sıfır; ikram olarak kapatın.</div> : <>
          {rows.map((r, i) => (
            <div key={i} className="form-grid">
              <Field label="Ödeme tipi" className="span-2"><select className="input" value={r.methodId} onChange={e => setRow(i, { methodId: e.target.value })} autoFocus={i === 0}><option value="">Seçin</option>{usable.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
              <Field label="Para birimi"><select className="input" value={r.currency} onChange={e => setRow(i, { currency: e.target.value, amount: '' })}>
                <option value={base}>{base}</option>{fx.data?.currencies.filter(x => x !== base).map(x => <option key={x} value={x}>{x}</option>)}</select></Field>
              <Field label="Tutar" hint={r.currency !== base ? (rateOf(r.currency) ? `≈ ${fmtMoney(inBase(r).toFixed(2), base)}` : 'Kur girilmemiş') : undefined}>
                <div className="row"><MoneyInput value={r.amount} onChange={x => setRow(i, { amount: x })} />
                  {remaining > 0 && <button className="btn sm" title="Kalanı yaz" onClick={() => setRow(i, { amount: r.currency === base ? (Number(r.amount || 0) + remaining).toFixed(2) : rateOf(r.currency) ? (Math.ceil(((Number(r.amount || 0) * rateOf(r.currency)) + remaining) / rateOf(r.currency) * 100) / 100).toFixed(2) : r.amount })}>Kalan</button>}</div>
              </Field>
              {usable.find(m => m.id === r.methodId)?.requiresReference && <Field label="Slip / referans no" required className="span-2"><input className="input" value={r.reference} onChange={e => setRow(i, { reference: e.target.value })} /></Field>}
              {rows.length > 1 && <div style={{ alignSelf: 'end' }}><button className="btn sm ghost" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>Satırı kaldır</button></div>}
            </div>
          ))}
          {rows.length < 10 && <div><button className="btn sm" onClick={() => setRows(rs => [...rs, { methodId: '', currency: base, amount: remaining > 0 ? remaining.toFixed(2) : '', reference: '' }])}><Plus /> Bölünmüş ödeme</button></div>}
          {cashRow && <div className="form-grid"><Field label="Alınan nakit (para üstü için)" className="span-2"><MoneyInput value={received} onChange={setReceived} /></Field>
            {change > 0 && <div className="span-2" style={{ alignSelf: 'end' }}>Para üstü: <b>{fmtMoney(change.toFixed(2), base)}</b></div>}</div>}
        </>)}
        {mode === 'room' && (
          <>
            <div className="row"><Search size={15} className="muted" /><input className="input" style={{ flex: 1 }} placeholder="Oda no veya misafir adı" value={rq} onChange={e => setRq(e.target.value)} autoFocus /></div>
            {rooms.isLoading ? <Spinner /> : shownRooms.length === 0 ? <Empty title="Konaklayan misafir bulunamadı" /> : (
              <div className="pos-rooms">
                {shownRooms.map(r => (
                  <button key={r.reservationId} className={`pos-room ${room === r.reservationId ? 'active' : ''}`} disabled={r.isBlacklisted} onClick={() => setRoom(r.reservationId)}>
                    <BedDouble size={15} /><b>{r.roomNumber}</b><span>{r.guestName}</span>{r.isBlacklisted && <Badge color="red">Kara liste</Badge>}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {mode === 'complimentary' && (zero ? <div className="info-box row"><Gift size={15} /> Adisyon ikram olarak kapatılacak. Tutar raporlarda ikram olarak görünür.</div>
          : <div className="warn-box">İkram için önce adisyonun tamamına gerekçeli indirim uygulayın.</div>)}
        <ErrorBox error={close.error} />
      </div>
    </Modal>
  );
}
