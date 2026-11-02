import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, ClipboardList, Lock, Printer, Repeat, Unlock, Wallet } from 'lucide-react';
import { get, post, qs } from '../lib/api';
import type { CashMovement, Dashboard, ExchangeRatesView, OpenShiftBrief, Paged, ReservationListItem, Shift, ShiftCash, ShiftReport } from '../lib/types';
import { fmtDate, fmtDateTime, fmtMoney } from '../lib/format';
import { useSession } from '../lib/session';
import { Kv, PageHead, useAction } from '../components/common';
import { DocFooter, DocHeader } from '../components/PrintDoc';
import { Badge, Empty, ErrorBox, Field, Modal, MoneyInput, Spinner } from '../components/ui';

export default function CashierPage() {
  const qc = useQueryClient();
  const { property } = useSession();
  const cur = useQuery({ queryKey: ['cashier', 'current'], queryFn: () => get<Shift | null>('/api/v1/cashier/current') });
  const [date, setDate] = useState(property?.businessDate ?? '');
  const shifts = useQuery({ queryKey: ['cashier', 'shifts', date], queryFn: () => get<Shift[]>(`/api/v1/cashier/shifts${qs({ date })}`) });
  const [sel, setSel] = useState<string | null>(null);
  const report = useQuery({ queryKey: ['cashier', 'shift', sel ?? cur.data?.id], queryFn: () => get<ShiftReport>(`/api/v1/cashier/shifts/${sel ?? cur.data!.id}`), enabled: !!(sel ?? cur.data?.id) });
  const [openDlg, setOpenDlg] = useState(false);
  const [closeDlg, setCloseDlg] = useState(false);
  const [moveDlg, setMoveDlg] = useState<CashMovement['kind'] | null>(null);
  const [handover, setHandover] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['cashier'] });

  return (
    <div className="page">
      <PageHead title="Kasa Vardiyası" sub="Nakit ve kart tahsilatları açık vardiyaya yazılır" actions={<>
        <button className="btn" onClick={() => setHandover(true)}><ClipboardList /> Devir özeti</button>
        {/* Kasa hareketleri her zaman görünür; vardiya kapalıyken pasif ve nedeni yazılı. */}
        <button className="btn" disabled={!cur.data} title={cur.data ? '' : 'Önce vardiya açın'} onClick={() => setMoveDlg('cash_in')}><ArrowDownToLine /> Kasa girişi</button>
        <button className="btn" disabled={!cur.data} title={cur.data ? '' : 'Önce vardiya açın'} onClick={() => setMoveDlg('cash_out')}><ArrowUpFromLine /> Kasa çıkışı</button>
        <button className="btn" disabled={!cur.data} title={cur.data ? '' : 'Önce vardiya açın'} onClick={() => setMoveDlg('exchange')}><Repeat /> Döviz bozdurma</button>
        <button className="btn" disabled={!cur.data} title={cur.data ? '' : 'Önce vardiya açın'} onClick={() => setMoveDlg('transfer')}><ArrowLeftRight /> Kasa transfer</button>
        {cur.data ? <button className="btn danger" onClick={() => setCloseDlg(true)}><Lock /> Vardiyayı kapat</button>
          : <button className="btn primary" onClick={() => setOpenDlg(true)}><Unlock /> Vardiya aç</button>}
      </>} />
      {handover && <HandoverModal shift={cur.data ? report.data : undefined} onClose={() => setHandover(false)} />}
      {cur.isLoading ? <Spinner /> : (
        <div className="split wide">
          <div className="stack">
            <div className="card">
              <div className="card-head"><Wallet size={16} /><h3>Benim vardiyam</h3></div>
              <div className="card-body">
                {cur.data ? <Kv items={[['Vardiya', `#${cur.data.shiftNo}`], ['İş günü', fmtDate(cur.data.businessDate)], ['Açılış', fmtDateTime(cur.data.openedAt)], ['Açılış kasası', fmtMoney(cur.data.openingFloat, property?.currency)],
                  ['Beklenen nakit', report.data ? <b key="e">{report.data.cash.filter(c => c.currency === property?.currency || Number(c.expected) !== 0).map(c => fmtMoney(c.expected, c.currency)).join(' · ')}</b> : '…']]} />
                  : <Empty title="Açık vardiyanız yok" text="Nakit ve kart tahsilatı için önce vardiya açın." />}
              </div>
            </div>
            <div className="card">
              <div className="card-head"><h3>Vardiyalar</h3><div className="right"><input type="date" className="input sm" value={date} onChange={e => setDate(e.target.value)} /></div></div>
              <div className="card-body tight">
                {shifts.data?.length === 0 ? <Empty title="Bu tarihte vardiya yok" /> : (
                  <table className="dt"><thead><tr><th>#</th><th>Kullanıcı</th><th>Durum</th><th style={{ textAlign: 'right' }}>Fark</th></tr></thead>
                    <tbody>{shifts.data?.map(s => (
                      <tr key={s.id} className={`clickable ${(sel ?? cur.data?.id) === s.id ? 'selected' : ''}`} onClick={() => setSel(s.id)}>
                        <td>{s.shiftNo}</td><td>{s.username}</td><td>{s.status === 'open' ? <Badge color="green">Açık</Badge> : <Badge color="gray">Kapalı</Badge>}</td>
                        <td className="num">{s.difference ? fmtMoney(s.difference) : '—'}</td>
                      </tr>))}</tbody></table>
                )}
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h3>Vardiya dökümü{report.data ? ` · #${report.data.shift.shiftNo} ${report.data.shift.username}` : ''}</h3></div>
            <div className="card-body">
              {!report.data ? <Empty title="Görüntülenecek vardiya seçin" /> : (
                <>
                  <table className="dt">
                    <thead><tr><th>Ödeme tipi</th><th>Para birimi</th><th style={{ textAlign: 'right' }}>Adet</th><th style={{ textAlign: 'right' }}>Tahsilat</th><th style={{ textAlign: 'right' }}>İade</th><th style={{ textAlign: 'right' }}>Net</th></tr></thead>
                    <tbody>{report.data.totals.map(t => <tr key={t.paymentMethod + t.currency}><td>{t.paymentMethod}</td><td>{t.currency}</td><td className="num">{t.count}</td><td className="num">{fmtMoney(t.collected)}</td><td className="num">{fmtMoney(t.refunded)}</td><td className="num"><b>{fmtMoney(t.net)}</b></td></tr>)}</tbody>
                  </table>
                  {report.data.totals.length === 0 && <Empty title="Bu vardiyada tahsilat yok" />}
                  <h4 style={{ margin: '14px 0 6px' }}>Nakit kasa</h4>
                  <table className="dt">
                    <thead><tr><th>Para birimi</th><th style={{ textAlign: 'right' }}>Beklenen</th><th style={{ textAlign: 'right' }}>Sayılan</th><th style={{ textAlign: 'right' }}>Fark</th></tr></thead>
                    <tbody>{report.data.cash.map(c => <tr key={c.currency}><td>{c.currency}</td><td className="num">{fmtMoney(c.expected)}</td><td className="num">{c.counted ? fmtMoney(c.counted) : '—'}</td>
                      <td className="num">{c.difference ? <b className={c.difference.startsWith('-') ? 'amount-neg' : ''}>{fmtMoney(c.difference)}</b> : '—'}</td></tr>)}</tbody>
                  </table>
                  {report.data.movements.length > 0 && <>
                    <h4 style={{ margin: '14px 0 6px' }}>Kasa hareketleri</h4>
                    <table className="dt">
                      <thead><tr><th>Saat</th><th>Tür</th><th>Açıklama</th><th style={{ textAlign: 'right' }}>Tutar</th></tr></thead>
                      <tbody>{report.data.movements.map(m => (
                        <tr key={m.id}><td>{fmtDateTime(m.createdAt)}</td><td>{MOVE_LABEL[m.kind]}</td>
                          <td>{m.description}{m.counterpart && <span className="muted"> · {m.counterpart}</span>}{m.exchangeRate && <span className="muted"> · kur {m.exchangeRate}</span>}{m.reference && <span className="muted"> · {m.reference}</span>}</td>
                          <td className="num"><b className={m.amount.startsWith('-') ? 'amount-neg' : ''}>{fmtMoney(m.amount, m.currency)}</b></td></tr>
                      ))}</tbody>
                    </table>
                  </>}
                  <div style={{ marginTop: 12 }}>
                    <Kv items={[['Açılış kasası', fmtMoney(report.data.shift.openingFloat, property?.currency)],
                      ...(report.data.shift.closedAt ? [['Kapanış', fmtDateTime(report.data.shift.closedAt)], ['Not', report.data.shift.closeNote]] as [string, React.ReactNode][] : [])]} />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {moveDlg && <MovementModal kind={moveDlg} base={property?.currency ?? 'TRY'} cash={report.data?.cash ?? []} onClose={() => setMoveDlg(null)} onDone={refresh} />}
      {openDlg && <OpenShiftModal onClose={() => setOpenDlg(false)} onDone={refresh} />}
      {closeDlg && cur.data && <CloseShiftModal cash={report.data?.cash ?? []} base={property?.currency ?? ''} onClose={() => setCloseDlg(false)} onDone={refresh} />}
    </div>
  );
}

function OpenShiftModal({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<unknown> }) {
  const [v, setV] = useState('0.00');
  const act = useAction(async (key: string) => { await post('/api/v1/cashier/open', { openingFloat: v || '0' }, key); await onDone(); }, { success: 'Vardiya açıldı.' });
  return (
    <Modal title="Vardiya aç" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={act.busy} onClick={async () => { if (await act.run() !== undefined) onClose(); }}>Aç</button></>}>
      <Field label="Açılış kasası (devir nakit)"><MoneyInput value={v} onChange={setV} autoFocus /></Field>
      <ErrorBox error={act.error} />
    </Modal>
  );
}

function CloseShiftModal({ cash, base, onClose, onDone }: { cash: ShiftCash[]; base: string; onClose: () => void; onDone: () => Promise<unknown> }) {
  const [v, setV] = useState('');
  const [note, setNote] = useState('');
  // Kasada döviz bulunan her para birimi ayrıca sayılır.
  const foreign = cash.filter(c => c.currency !== base && Number(c.expected) !== 0);
  const [fv, setFv] = useState<Record<string, string>>({});
  const expected = cash.find(c => c.currency === base)?.expected;
  const act = useAction(async (key: string) => {
    await post('/api/v1/cashier/close', { countedCash: v, note: note || null, countedForeign: Object.fromEntries(foreign.map(c => [c.currency, fv[c.currency]])) }, key);
    await onDone();
  }, { success: 'Vardiya kapatıldı.' });
  const ready = !!v && foreign.every(c => !!fv[c.currency]);
  // Kasa sayım föyü: TL küpürleri adetle girilir, toplam sayılan nakde yazılır ve föy yazdırılabilir.
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [printing, setPrinting] = useState(false);
  const countTotal = TRY_DENOMS.reduce((t, d) => t + d * (Number(counts[d]) || 0), 0);
  const setCount = (d: number, x: string) => {
    const next: Record<string, string> = { ...counts, [d]: x.replace(/[^0-9]/g, '') };
    setCounts(next);
    const total = TRY_DENOMS.reduce((t, k) => t + k * (Number(next[k]) || 0), 0);
    setV(total > 0 ? total.toFixed(2) : '');
  };
  const printSheet = () => { setPrinting(true); setTimeout(() => { window.print(); setPrinting(false); }, 80); };
  return (
    <Modal title="Vardiyayı kapat" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn danger" disabled={!ready || act.busy} onClick={async () => { if (await act.run() !== undefined) onClose(); }}>Kapat</button></>}>
      <div className="stack">
        {expected && <div className="info-box">Sisteme göre beklenen nakit: <b>{[fmtMoney(expected, base), ...foreign.map(c => fmtMoney(c.expected, c.currency))].join(' · ')}</b></div>}
        {base === 'TRY' && (
          <details className="count-sheet">
            <summary>Kasa sayım föyü (küpür küpür say)</summary>
            <table className="dt">
              <thead><tr><th>Küpür</th><th style={{ width: 90 }}>Adet</th><th style={{ textAlign: 'right' }}>Tutar</th></tr></thead>
              <tbody>{TRY_DENOMS.map(d => (
                <tr key={d}><td>{fmtMoney(d.toFixed(2), 'TRY')}</td>
                  <td><input className="input sm" inputMode="numeric" value={counts[d] ?? ''} onChange={e => setCount(d, e.target.value)} /></td>
                  <td className="num">{fmtMoney((d * (Number(counts[d]) || 0)).toFixed(2))}</td></tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={2}><b>Toplam</b></td><td className="num"><b>{fmtMoney(countTotal.toFixed(2), 'TRY')}</b></td></tr></tfoot>
            </table>
            <button className="btn sm" type="button" disabled={countTotal === 0} onClick={printSheet}>Sayım föyünü yazdır</button>
          </details>
        )}
        <Field label={`Sayılan nakit (${base})`} required hint={base === 'TRY' ? 'Küpür sayımı yapılırsa toplam buraya yazılır' : undefined}><MoneyInput value={v} onChange={setV} autoFocus /></Field>
        {foreign.map(c => <Field key={c.currency} label={`Sayılan ${c.currency}`} required><MoneyInput value={fv[c.currency] ?? ''} onChange={x => setFv(s => ({ ...s, [c.currency]: x }))} /></Field>)}
        <Field label="Not"><input className="input" value={note} onChange={e => setNote(e.target.value)} /></Field>
        <ErrorBox error={act.error} />
      </div>
      {printing && createPortal(
        <div className="doc folio-doc report-doc">
          <DocHeader kind="Kasa Sayım Föyü" no={new Date().toLocaleString('tr-TR')} lines={[`Beklenen nakit: ${expected ? fmtMoney(expected, base) : '—'}`]} />
          <table className="fd-table">
            <thead><tr><th>Küpür</th><th className="r">Adet</th><th className="r">Tutar</th></tr></thead>
            <tbody>{TRY_DENOMS.filter(d => Number(counts[d]) > 0).map(d => (
              <tr key={d}><td>{fmtMoney(d.toFixed(2), 'TRY')}</td><td className="r">{counts[d]}</td><td className="r">{fmtMoney((d * Number(counts[d])).toFixed(2))}</td></tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={2}><b>Sayılan toplam</b></td><td className="r"><b>{fmtMoney(countTotal.toFixed(2), 'TRY')}</b></td></tr>
              {expected && <tr><td colSpan={2}>Fark (sayılan − beklenen)</td><td className="r">{fmtMoney((countTotal - Number(expected)).toFixed(2), 'TRY')}</td></tr>}</tfoot>
          </table>
          {foreign.length > 0 && <p>Döviz sayımı: {foreign.map(c => `${c.currency} ${fv[c.currency] ?? '—'}`).join(' · ')}</p>}
          <DocFooter note="Sayan: ____________________    Teslim alan: ____________________" />
        </div>, document.getElementById('print-root')!)}
    </Modal>
  );
}

const TRY_DENOMS = [200, 100, 50, 20, 10, 5, 1, 0.5, 0.25, 0.1, 0.05];

const MOVE_LABEL: Record<CashMovement['kind'], string> = { cash_in: 'Kasa girişi', cash_out: 'Kasa çıkışı', exchange: 'Döviz bozdurma', transfer: 'Kasa transfer' };
const FOREIGN = ['EUR', 'USD', 'GBP', 'CHF', 'RUB', 'SAR'];

/** Kasa girişi/çıkışı, döviz bozdurma ve kasa transferi (folyoya bağlı olmayan nakit hareketleri). */
function MovementModal({ kind, base, cash, onClose, onDone }: { kind: CashMovement['kind']; base: string; cash: ShiftCash[]; onClose: () => void; onDone: () => Promise<unknown> }) {
  const [currency, setCurrency] = useState(kind === 'exchange' ? 'EUR' : base);
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [who, setWho] = useState('');
  const [ref, setRef] = useState('');
  const [direction, setDirection] = useState<'buy' | 'sell'>('buy');
  const [rate, setRate] = useState('');
  const [target, setTarget] = useState('');
  const others = useQuery({ queryKey: ['cashier', 'open-shifts'], queryFn: () => get<OpenShiftBrief[]>('/api/v1/cashier/open-shifts'), enabled: kind === 'transfer' });
  const rates = useQuery({ queryKey: ['exchangeRates'], queryFn: () => get<ExchangeRatesView>('/api/v1/exchange-rates'), enabled: kind === 'exchange' });
  const dayRate = rates.data?.rates.filter(r => r.currency === currency).sort((a, b) => b.rateDate.localeCompare(a.rateDate))[0]?.rate;
  const effRate = rate || dayRate || '';
  const local = Number(amount) > 0 && Number(effRate) > 0 ? Math.round(Number(amount) * Number(effRate) * 100) / 100 : 0;
  const outCur = kind === 'exchange' ? (direction === 'buy' ? base : currency) : currency;
  const have = cash.find(c => c.currency === outCur)?.expected ?? '0';
  const currencies = [...new Set([base, ...FOREIGN, ...cash.map(c => c.currency)])].filter(c => kind !== 'exchange' || c !== base);
  const act = useAction(async (key: string) => {
    if (kind === 'exchange') await post('/api/v1/cashier/exchange', { direction, currency, foreignAmount: amount, rate: rate || null, counterpart: who.trim() || null, note: desc.trim() || null }, key);
    else if (kind === 'transfer') await post('/api/v1/cashier/transfer', { toShiftId: target, currency, amount, description: desc.trim() }, key);
    else await post('/api/v1/cashier/movements', { kind, currency, amount, description: desc.trim(), counterpart: who.trim() || null, reference: ref.trim() || null }, key);
    await onDone();
  }, { success: kind === 'exchange' ? 'Döviz bozdurma kaydedildi.' : kind === 'transfer' ? 'Kasa transferi yapıldı.' : 'Kasa hareketi kaydedildi.' });
  const ok = Number(amount) > 0 && (kind === 'exchange' ? Number(effRate) > 0 : !!desc.trim()) && (kind !== 'transfer' || !!target);
  return (
    <Modal title={MOVE_LABEL[kind]} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!ok || act.busy} onClick={async () => { if (await act.run() !== undefined) onClose(); }}>Kaydet</button></>}>
      <div className="stack">
        {kind === 'exchange' && <div className="seg">
          <button className={direction === 'buy' ? 'active' : ''} onClick={() => setDirection('buy')}>Döviz al ({base} ver)</button>
          <button className={direction === 'sell' ? 'active' : ''} onClick={() => setDirection('sell')}>Döviz sat ({base} al)</button>
        </div>}
        {kind === 'transfer' && <Field label="Alan kasa (açık vardiya)" required>
          <select className="input" value={target} onChange={e => setTarget(e.target.value)} autoFocus>
            <option value="" />{others.data?.map(s => <option key={s.id} value={s.id}>#{s.shiftNo} · {s.fullName ?? s.username}</option>)}
          </select>
          {others.data?.length === 0 && <div className="muted" style={{ fontSize: 12 }}>Başka açık kasa vardiyası yok.</div>}
        </Field>}
        <div className="grid cols-2">
          <Field label="Para birimi"><select className="input" value={currency} onChange={e => { setCurrency(e.target.value); setRate(''); }}>
            {currencies.map(c => <option key={c} value={c}>{c}</option>)}</select></Field>
          <Field label={kind === 'exchange' ? `${currency} tutarı` : 'Tutar'} required hint={kind !== 'cash_in' ? `Kasada ${fmtMoney(have, outCur)}` : undefined}>
            <MoneyInput value={amount} onChange={setAmount} autoFocus={kind !== 'transfer'} /></Field>
        </div>
        {kind === 'exchange' && <>
          <Field label="Kur" hint={dayRate ? `Günün kuru ${dayRate}; farklı bozdurma kuru yazabilirsiniz` : 'Günün kuru girilmemiş; kuru yazın'}>
            <input className="input" inputMode="decimal" value={rate} placeholder={dayRate ?? ''} onChange={e => setRate(e.target.value.replace(',', '.'))} /></Field>
          {local > 0 && <div className="info-box">{direction === 'buy'
            ? `Misafirden ${fmtMoney(amount, currency)} alınır, ${fmtMoney(String(local), base)} verilir.`
            : `Misafirden ${fmtMoney(String(local), base)} alınır, ${fmtMoney(amount, currency)} verilir.`}</div>}
        </>}
        {kind !== 'transfer' && <Field label={kind === 'exchange' ? 'Misafir / oda' : 'Kişi / firma'}><input className="input" maxLength={120} value={who} onChange={e => setWho(e.target.value)} /></Field>}
        <Field label={kind === 'exchange' ? 'Not' : 'Açıklama'} required={kind !== 'exchange'}><input className="input" maxLength={300} value={desc} onChange={e => setDesc(e.target.value)}
          placeholder={kind === 'cash_out' ? 'Ör. kargo ödemesi' : kind === 'cash_in' ? 'Ör. merkez kasadan bozuk para' : kind === 'transfer' ? 'Ör. vardiya devri' : ''} /></Field>
        {(kind === 'cash_in' || kind === 'cash_out') && <Field label="Belge no"><input className="input" maxLength={100} value={ref} onChange={e => setRef(e.target.value)} /></Field>}
      </div>
    </Modal>
  );
}

/**
 * Vardiya devir özeti: bir sonraki vardiyaya kalan işler tek sayfada. Bekleyen girişler, çıkış yapmamış misafirler ve bakiyeleri,
 * kasa durumu, açık görev/arıza/uyandırma sayıları ve elle yazılan devir notu. Veriler o anki kayıtlardan okunur.
 */
function HandoverModal({ shift, onClose }: { shift?: ShiftReport; onClose: () => void }) {
  const { property, me } = useSession();
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => get<Dashboard>('/api/v1/dashboard') });
  const arr = useQuery({ queryKey: ['reservations', 'handover', 'arrivals'], queryFn: () => get<Paged<ReservationListItem>>(`/api/v1/reservations${qs({ view: 'arrivals', pageSize: 300 })}`) });
  const dep = useQuery({ queryKey: ['reservations', 'handover', 'departures'], queryFn: () => get<Paged<ReservationListItem>>(`/api/v1/reservations${qs({ view: 'departures', pageSize: 300 })}`) });
  const [note, setNote] = useState('');
  const [printing, setPrinting] = useState(false);
  const pendingArr = (arr.data?.items ?? []).filter(r => r.status === 'tentative' || r.status === 'confirmed');
  const pendingDep = (dep.data?.items ?? []).filter(r => r.status === 'checked_in');
  const d = dash.data;
  const facts: [string, React.ReactNode][] = d ? [
    ['İş günü', fmtDate(d.businessDate)], ['Konaklayan oda / kişi', `${d.occupied} / ${d.guestsInHouse}`],
    ['Bekleyen giriş', `${pendingArr.length}`], ['Çıkış yapmamış', `${pendingDep.length}`],
    ['Boş kirli oda', d.vacantDirty], ['Açık kat görevi', d.openHkTasks], ['Açık arıza', d.openTickets], ['Bekleyen uyandırma', d.pendingWakeups],
    ['KBS bildirimi bekleyen', d.kbsPending], ['Açık folyo bakiyesi', fmtMoney(d.openBalance, d.currency)],
  ] : [];
  const cash = shift ? shift.cash.filter(c => c.currency === property?.currency || Number(c.expected) !== 0).map(c => fmtMoney(c.expected, c.currency)).join(' · ') : 'Açık vardiya yok';
  const print = () => { setPrinting(true); setTimeout(() => { window.print(); setPrinting(false); }, 80); };
  const loading = dash.isLoading || arr.isLoading || dep.isLoading;
  const resTable = (rows: ReservationListItem[], withBalance: boolean) => (
    <table className="fd-table"><thead><tr><th>Oda</th><th>Misafir</th><th>Firma</th>{withBalance ? <th className="r">Bakiye</th> : <th>Çıkış</th>}</tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><td>{r.roomNumber ?? '—'}</td><td>{r.guestName}</td><td>{r.companyName ?? r.agencyName ?? ''}</td>
        {withBalance ? <td className="r">{fmtMoney(r.balance, r.currency)}</td> : <td>{fmtDate(r.departure)}</td>}</tr>)}</tbody></table>
  );
  return (
    <Modal title="Vardiya devir özeti" size="lg" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Kapat</button>
      <button className="btn primary" disabled={loading} onClick={print}><Printer /> Yazdır</button>
    </>}>
      {(dash.error || arr.error || dep.error) && <ErrorBox error={dash.error ?? arr.error ?? dep.error} />}
      {loading ? <Spinner /> : <>
        <Kv items={[...facts, ['Kasada beklenen nakit', cash]]} />
        <h4 style={{ margin: '12px 0 6px' }}>Bekleyen girişler ({pendingArr.length})</h4>
        {pendingArr.length ? resTable(pendingArr, false) : <p className="muted">Yok.</p>}
        <h4 style={{ margin: '12px 0 6px' }}>Çıkış yapmamış misafirler ({pendingDep.length})</h4>
        {pendingDep.length ? resTable(pendingDep, true) : <p className="muted">Yok.</p>}
        <Field label="Devir notu (sonraki vardiyaya)"><textarea className="input" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Ör. 305 geç çıkış istedi, 412 kartı yeniden basılacak" /></Field>
      </>}
      {printing && createPortal(
        <div className="doc folio-doc report-doc">
          <DocHeader kind="Vardiya Devir Özeti" no={new Date().toLocaleString('tr-TR')} lines={[`Devreden: ${me?.fullName ?? me?.username ?? ''}`]} />
          <table className="fd-table"><tbody>{[...facts, ['Kasada beklenen nakit', cash] as [string, React.ReactNode]].map(([k, v]) => <tr key={k}><td>{k}</td><td className="r">{v}</td></tr>)}</tbody></table>
          <h4>Bekleyen girişler ({pendingArr.length})</h4>{pendingArr.length > 0 && resTable(pendingArr, false)}
          <h4>Çıkış yapmamış misafirler ({pendingDep.length})</h4>{pendingDep.length > 0 && resTable(pendingDep, true)}
          {note.trim() && <><h4>Devir notu</h4><p style={{ whiteSpace: 'pre-wrap' }}>{note}</p></>}
          <DocFooter note="Devreden: ____________________    Devralan: ____________________" />
        </div>, document.getElementById('print-root')!)}
    </Modal>
  );
}
