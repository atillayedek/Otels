import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, ChevronDown, ChevronUp, Printer, ShoppingBag } from 'lucide-react';
import { get, post, qs } from '../lib/api';
import type { CashSale, ExchangeRatesView, FolioDetail, Shift } from '../lib/types';
import { fmtDate, fmtDateTime, fmtMoney, fmtRate } from '../lib/format';
import { defaultPaymentMethodId, usePaymentMethods, useTransactionCodes } from '../lib/queries';
import { useSession } from '../lib/session';
import { PageHead, useAction } from '../components/common';
import { FolioPrint } from '../components/FolioPanel';
import { Badge, Empty, ErrorBox, Modal, MoneyInput, Spinner } from '../components/ui';
import { useWinSelf } from '../components/Windows';

const LEDGER = ['city_ledger', 'company', 'agency'];

export default function CashSalePage() {
  return <div className="page"><PageHead title="Peşin Satış" /><div className="card" style={{ maxWidth: 640 }}><CashSaleView /></div></div>;
}

/**
 * Peşin satış penceresi (klasik resepsiyon düzeni): Departman, Açıklama, Kart Tipi, D.Tutar, Kasa, Not, Kullanıcı.
 * "Sürekli" işaretliyse kayıttan sonra pencere açık kalır ve yeni satış için temizlenir.
 */
export function CashSaleView() {
  const { can, property, me } = useSession();
  const self = useWinSelf();
  const qc = useQueryClient();
  const codes = useTransactionCodes();
  const methods = usePaymentMethods();
  const fx = useQuery({ queryKey: ['exchangeRates'], queryFn: () => get<ExchangeRatesView>('/api/v1/exchange-rates') });
  const shift = useQuery({ queryKey: ['cashier', 'current'], queryFn: () => get<Shift | null>('/api/v1/cashier/current'), enabled: can('cashier.manage') });

  const [codeId, setCodeId] = useState('');
  const [desc, setDesc] = useState('');
  const [methodSel, setMethodSel] = useState('');
  const [amount, setAmount] = useState('');
  const [cur, setCur] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [keepOpen, setKeepOpen] = useState(false);
  const [printId, setPrintId] = useState<string | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);
  const [menu, setMenu] = useState<'other' | 'print' | null>(null);
  const [list, setList] = useState(false);

  const saleCodes = codes.data?.filter(c => c.isActive && c.category !== 'room' && c.category !== 'tax') ?? [];
  const payMethods = methods.data?.filter(m => m.isActive && !LEDGER.includes(m.kind)) ?? [];
  const methodId = methodSel || defaultPaymentMethodId(payMethods);
  const method = payMethods.find(m => m.id === methodId);
  const code = saleCodes.find(c => c.id === codeId);
  const base = property?.currency ?? '';
  const tCur = cur && cur !== base ? cur : null;
  const rate = tCur ? fx.data?.rates.find(r => r.currency === tCur) : undefined;
  const approx = tCur && amount && rate ? (Math.round(Number(amount) * Number(rate.rate) * 100) / 100).toFixed(2) : null;
  const noShift = can('cashier.manage') && shift.isFetched && !shift.data;
  const ok = !!codeId && !!amount && Number(amount) > 0 && !!methodId && (!method?.requiresReference || !!reference.trim()) && !noShift && (!tCur || !!rate);

  const clear = () => { setCodeId(''); setDesc(''); setAmount(''); setReference(''); setNote(''); };
  const save = useAction(async (key: string) => {
    const r = await post<{ id: string; folioNumber: string; total: string }>('/api/v1/cash-sales', {
      transactionCodeId: codeId, description: desc.trim() || null, amount, currency: tCur, exchangeRate: null,
      paymentMethodId: methodId, reference: reference.trim() || null, note: note.trim() || null,
    }, key);
    await qc.invalidateQueries({ predicate: q => ['cash-sales', 'cashier', 'folio', 'folios', 'dashboard'].includes(String(q.queryKey[0])) });
    setLastId(r.id);
    return r;
  }, { success: r => `Peşin satış kaydedildi: ${r.folioNumber} · ${fmtMoney(r.total, base)}` });

  /** Tamam / Kaydet&Yaz: Sürekli işaretli değilse pencere kapanır (yazdırma bittikten sonra). */
  const finish = async (print: boolean) => {
    const r = await save.run();
    if (!r) return;
    if (print) setPrintId(r.id);
    if (keepOpen || !self) clear();
    else if (!print) self.close();
  };

  if (codes.isLoading || methods.isLoading) return <Spinner />;

  return (
    <div className="psw">
      <div className="psw-box">
        <label className="psw-l">Departman</label>
        <div className="psw-code">
          <select className="input" value={codeId} onChange={e => setCodeId(e.target.value)} autoFocus>
            <option value="" />{saleCodes.map(c => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </select>
          <input className="input psw-ro" readOnly tabIndex={-1} value={code?.name ?? ''} />
        </div>
        <label className="psw-l">Açıklama</label>
        <input className="input" value={desc} onChange={e => setDesc(e.target.value)} maxLength={200} placeholder={code?.name} />
      </div>
      {saleCodes.length === 0 && <div className="warn-box">Departman (işlem kodu) tanımlı değil. Yönetim → İşlem Kodları ve Ödeme Tipleri ekranından ekleyin.</div>}

      <div className="psw-box">
        <label className="psw-l">Kart Tipi</label>
        <select className="input" value={methodId} onChange={e => setMethodSel(e.target.value)}>{payMethods.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <label className="psw-l">D.Tutar</label>
        <div className="psw-amt">
          <MoneyInput value={amount} onChange={setAmount} />
          <select className="input psw-cur" value={tCur ?? base} onChange={e => setCur(e.target.value)} title="Para birimi">
            <option value={base}>{base}</option>{fx.data?.currencies.filter(c => c !== base).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {tCur && <><span /><div className="psw-hint">{rate ? <>Kur {fmtRate(rate.rate)} ({fmtDate(rate.rateDate)}) · Satış tutarı ≈ <b>{approx ? fmtMoney(approx, base) : '—'}</b></> : <>{tCur} için kur girilmemiş. Ön Kasa → Döviz Kurları ekranından girin.</>}</div></>}
        {method && method.kind !== 'cash' && <>
          <label className="psw-l">Referans</label>
          <input className="input" value={reference} onChange={e => setReference(e.target.value)} maxLength={100} placeholder={method.requiresReference ? 'Slip / provizyon no (zorunlu)' : 'Slip / provizyon no'} />
        </>}
      </div>

      <div className="psw-box">
        <label className="psw-l">Kasa</label>
        <input className="input psw-ro" readOnly tabIndex={-1} value={shift.data ? `Vardiya ${shift.data.shiftNo} · ${shift.data.username}` : 'Açık kasa vardiyası yok'} />
        <label className="psw-l">Not</label>
        <textarea className="input" rows={3} value={note} onChange={e => setNote(e.target.value)} maxLength={100} data-enter="keep" />
        <label className="psw-l">Kullanıcı</label>
        <div className="psw-amt">
          <input className="input psw-ro" readOnly tabIndex={-1} value={me?.fullName || me?.username || ''} />
          <input className="input psw-ro psw-date" readOnly tabIndex={-1} value={fmtDate(property?.businessDate)} title="İş günü" />
        </div>
        {code && <><span /><div className="psw-dept">{code.name.toLocaleUpperCase('tr-TR')}</div></>}
      </div>

      {noShift && <div className="error-box">Tahsilat için açık kasa vardiyanız yok. Ön Kasa → Kasa Vardiyası ekranından vardiya açın.</div>}
      <ErrorBox error={save.error} />

      <div className="psw-foot">
        <label className="fdw-chk"><input type="checkbox" checked={keepOpen} onChange={e => setKeepOpen(e.target.checked)} /> Sürekli</label>
        <div className="fdw-split">
          <button className="btn" onClick={() => setMenu(m => (m === 'other' ? null : 'other'))}>Diğer… {menu === 'other' ? <ChevronUp /> : <ChevronDown />}</button>
          {menu === 'other' && <div className="fdw-pop" style={{ left: 0, right: 'auto' }}>
            <button className="btn sm ghost" onClick={() => { setMenu(null); setList(true); }}><ShoppingBag /> Bugünkü peşin satışlar</button>
          </div>}
        </div>
        <span className="spacer" />
        <div className="fdw-split">
          <button className="btn" disabled={!ok || save.busy} onClick={() => void finish(true)}><Printer /> Kaydet&amp;Yaz</button>
          <button className="btn fdw-caret" onClick={() => setMenu(m => (m === 'print' ? null : 'print'))} title="Diğer yazdırma"><ChevronDown /></button>
          {menu === 'print' && <div className="fdw-pop">
            <button className="btn sm ghost" disabled={!lastId} onClick={() => { setMenu(null); if (lastId) setPrintId(lastId); }}><Printer /> Son satışı tekrar yazdır</button>
          </div>}
        </div>
        <button className="btn primary" disabled={!ok || save.busy} onClick={() => void finish(false)}>{save.busy ? 'Kaydediliyor…' : 'Tamam'}</button>
        {self && <button className="btn" onClick={self.close}>Vazgeç</button>}
      </div>

      {printId && <SalePrint id={printId} onDone={() => { setPrintId(null); if (self && !keepOpen) self.close(); }} />}
      {list && <SalesListModal onClose={() => setList(false)} onPrint={setPrintId} />}
    </div>
  );
}

function SalePrint({ id, onDone }: { id: string; onDone: () => void }) {
  const detail = useQuery({ queryKey: ['folio', id], queryFn: () => get<FolioDetail>(`/api/v1/folios/${id}`) });
  const [started, setStarted] = useState(false);
  if (detail.data && !started) {
    setStarted(true);
    setTimeout(() => { window.print(); onDone(); }, 50);
  }
  if (detail.error && !started) { setStarted(true); setTimeout(onDone, 0); }
  return detail.data ? createPortal(<FolioPrint detail={detail.data} kind="Peşin Satış" />, document.getElementById('print-root')!) : null;
}

/** Diğer → seçilen iş gününün peşin satışları: yazdırma ve (aynı iş günü içinde) iptal. */
function SalesListModal({ onClose, onPrint }: { onClose: () => void; onPrint: (id: string) => void }) {
  const { can, property } = useSession();
  const [date, setDate] = useState(property?.businessDate ?? '');
  const list = useQuery({ queryKey: ['cash-sales', date], queryFn: () => get<CashSale[]>(`/api/v1/cash-sales${qs({ date: date || undefined })}`) });
  const [cancelling, setCancelling] = useState<CashSale | null>(null);
  const sales = list.data ?? [];
  const active = sales.filter(s => !s.isCancelled);
  const total = active.reduce((a, s) => a + Math.round(Number(s.total) * 100), 0) / 100;
  return (
    <Modal title="Peşin satışlar" size="lg" onClose={onClose} footer={<button className="btn" onClick={onClose}>Kapat</button>}>
      <div className="stack">
        <div className="row"><span className="muted">İş günü</span><input type="date" className="input" style={{ width: 160 }} value={date} onChange={e => setDate(e.target.value)} /></div>
        {list.isLoading ? <Spinner /> : list.error ? <ErrorBox error={list.error} /> : sales.length === 0 ? <Empty icon={<ShoppingBag />} title="Bu iş gününde peşin satış yok" /> : (
          <div className="table-wrap" style={{ maxHeight: 420 }}>
            <table className="dt">
              <thead><tr><th>No</th><th>Saat</th><th>Açıklama</th><th>Kart tipi</th><th>Not</th><th style={{ textAlign: 'right' }}>Tutar</th><th>Kullanıcı</th><th /></tr></thead>
              <tbody>
                {sales.map(s => (
                  <tr key={s.id}>
                    <td>{s.folioNumber}</td>
                    <td>{fmtDateTime(s.createdAt).split(' ').pop()}</td>
                    <td>{s.name}{s.isCancelled && <> <Badge color="red">İptal edildi</Badge></>}</td>
                    <td>{s.paymentMethods}</td>
                    <td className="muted">{s.note}</td>
                    <td className="num">{fmtMoney(s.total, s.currency)}</td>
                    <td>{s.username}</td>
                    <td className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                      {!s.isCancelled && <button className="btn sm ghost icon" title="Yazdır" onClick={() => onPrint(s.id)}><Printer /></button>}
                      {!s.isCancelled && can('folio.void') && can('payment.refund') && s.businessDate === property?.businessDate &&
                        <button className="btn sm ghost icon" title="Satışı iptal et" onClick={() => setCancelling(s)}><Ban /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={5}>{active.length} satış</td><td className="num"><b>{fmtMoney(total.toFixed(2), property?.currency)}</b></td><td colSpan={2} /></tr></tfoot>
            </table>
          </div>
        )}
      </div>
      {cancelling && <CancelModal sale={cancelling} onClose={() => setCancelling(null)} />}
    </Modal>
  );
}

function CancelModal({ sale, onClose }: { sale: CashSale; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const act = useAction(async (key: string) => {
    await post(`/api/v1/cash-sales/${sale.id}/cancel`, { reason }, key);
    await qc.invalidateQueries({ predicate: q => ['cash-sales', 'cashier', 'folio', 'folios', 'dashboard'].includes(String(q.queryKey[0])) });
  }, { success: 'Peşin satış iptal edildi.' });
  return (
    <Modal title={`Peşin satış iptali · ${sale.folioNumber}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn danger" disabled={!reason.trim() || act.busy} onClick={async () => { if (await act.run() !== undefined) onClose(); }}>{act.busy ? 'İptal ediliyor…' : 'İptal et'}</button>
    </>}>
      <div className="stack">
        <div className="warn-box">{sale.name} · {fmtMoney(sale.total, sale.currency)} satışı ve tahsilatı iptal edilecek; tahsilat kasadan düşülür.</div>
        <input className="input" value={reason} onChange={e => setReason(e.target.value)} maxLength={300} autoFocus placeholder="İptal gerekçesi" />
        <ErrorBox error={act.error} />
      </div>
    </Modal>
  );
}
