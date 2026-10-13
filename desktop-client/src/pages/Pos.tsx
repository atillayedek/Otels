import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, Ban, Gift, Percent, Plus, Receipt, Search, Utensils, Wallet, X } from 'lucide-react';
import { get, post, put, qs } from '../lib/api';
import type { ExchangeRatesView, InHouseRoom, Outlet, PosCheck, PosCheckDetail, PosProduct } from '../lib/types';
import { fmtDateTime, fmtMoney, fmtQty, parseDecimal } from '../lib/format';
import { usePaymentMethods } from '../lib/queries';
import { useSession } from '../lib/session';
import { PageHead, useAction } from '../components/common';
import { Badge, Empty, ErrorBox, Field, Modal, MoneyInput, Spinner, Tabs } from '../components/ui';

const OUTLET_KEY = 'pms.pos.outlet';
const SETTLE_LABEL: Record<string, string> = { room: 'Odaya', payment: 'Ödeme', complimentary: 'İkram' };

function readOutlet() { try { return localStorage.getItem(OUTLET_KEY) ?? ''; } catch { return ''; } }
function saveOutlet(id: string) { try { localStorage.setItem(OUTLET_KEY, id); } catch { /* tarayıcı depolaması kapalı olabilir */ } }

/** Restoran / bar satış ekranı: masa adisyonları, ürün ekleme, indirim, kapanış (ödeme, odaya aktarma, ikram). */
export default function PosPage() {
  const { can } = useSession();
  const outlets = useQuery({ queryKey: ['pos', 'outlets'], queryFn: () => get<Outlet[]>('/api/v1/pos/outlets') });
  const active = (outlets.data ?? []).filter(o => o.isActive);
  const [outletId, setOutletId] = useState(readOutlet);
  const outlet = active.find(o => o.id === outletId) ?? active[0];
  useEffect(() => { if (outlet && outlet.id !== outletId) setOutletId(outlet.id); }, [outlet, outletId]);
  const [view, setView] = useState<'open' | 'closed'>('open');
  const [sel, setSel] = useState<string | null>(null);
  const [newCheck, setNewCheck] = useState(false);

  if (outlets.isLoading) return <div className="page"><Spinner /></div>;
  if (outlets.error) return <div className="page"><ErrorBox error={outlets.error} /></div>;
  if (!outlet) return (
    <div className="page"><PageHead title="Restoran / Bar" />
      <Empty icon={<Utensils />} title="Satış noktası tanımlı değil" text={can('pos.manage') ? 'Restoran → Menü ve Satış Noktaları ekranından satış noktası ve ürün tanımlayın.' : 'Yöneticinizden satış noktası tanımlamasını isteyin.'} />
    </div>
  );

  return (
    <div className="page pos-page">
      <PageHead title="Restoran / Bar" actions={<>
        <div className="seg">{active.map(o => <button key={o.id} className={o.id === outlet.id ? 'active' : ''} onClick={() => { setOutletId(o.id); saveOutlet(o.id); setSel(null); }}>{o.name}{o.openChecks > 0 && <span className="pill">{o.openChecks}</span>}</button>)}</div>
        {can('pos.order') && <button className="btn primary" onClick={() => setNewCheck(true)}><Plus /> Yeni adisyon</button>}
      </>} />
      <div className="pos-layout">
        <div className="pos-checks">
          <Tabs value={view} onChange={v => { setView(v); setSel(null); }} items={[{ key: 'open', label: 'Açık adisyonlar' }, { key: 'closed', label: 'Bugün kapanan' }]} />
          <CheckList outletId={outlet.id} view={view} selected={sel} onSelect={setSel} />
        </div>
        <div className="pos-main">
          {sel ? <CheckScreen key={sel} id={sel} outletId={outlet.id} onClosed={() => setSel(null)} /> : <Empty icon={<Receipt />} title="Adisyon seçin" text="Soldan bir adisyon seçin veya yeni adisyon açın." />}
        </div>
      </div>
      {newCheck && <NewCheckModal outletId={outlet.id} onClose={() => setNewCheck(false)} onCreated={id => { setNewCheck(false); setView('open'); setSel(id); }} />}
    </div>
  );
}

function CheckList({ outletId, view, selected, onSelect }: { outletId: string; view: 'open' | 'closed'; selected: string | null; onSelect: (id: string) => void }) {
  const { property } = useSession();
  const list = useQuery({
    queryKey: ['pos', 'checks', outletId, view],
    queryFn: () => get<PosCheck[]>(`/api/v1/pos/checks${qs(view === 'open' ? { outletId, status: 'open' } : { outletId, date: property?.businessDate ?? null })}`),
  });
  const rows = view === 'open' ? list.data ?? [] : (list.data ?? []).filter(c => c.status !== 'open');
  if (list.isLoading) return <Spinner />;
  if (list.error) return <ErrorBox error={list.error} />;
  if (rows.length === 0) return <Empty title={view === 'open' ? 'Açık adisyon yok' : 'Bugün kapanan adisyon yok'} />;
  return (
    <div className="pos-check-grid">
      {rows.map(c => (
        <button key={c.id} className={`pos-check-card ${c.id === selected ? 'active' : ''} ${c.status}`} onClick={() => onSelect(c.id)}>
          <div className="row"><b>{c.tableLabel ? `Masa ${c.tableLabel}` : `#${c.checkNo}`}</b><span className="spacer" />{c.status !== 'open' && <Badge color={c.status === 'cancelled' ? 'red' : 'gray'}>{c.status === 'cancelled' ? 'İptal' : SETTLE_LABEL[c.settlement ?? ''] ?? 'Kapalı'}</Badge>}</div>
          <div className="muted">#{c.checkNo} · {c.covers} kişi · {fmtQty(c.itemCount)} ürün</div>
          <div className="pos-check-total">{fmtMoney(c.total)}</div>
          <div className="muted" style={{ fontSize: 11 }}>{c.openedBy} · {fmtDateTime(c.openedAt)}</div>
        </button>
      ))}
    </div>
  );
}

function NewCheckModal({ outletId, onClose, onCreated }: { outletId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [table, setTable] = useState('');
  const [covers, setCovers] = useState('1');
  const open = useAction(async (key: string) => {
    const r = await post<PosCheckDetail>('/api/v1/pos/checks', { outletId, tableLabel: table.trim() || null, covers: Number(covers) || 1 }, key);
    await qc.invalidateQueries({ queryKey: ['pos'] });
    return r;
  });
  return (
    <Modal title="Yeni adisyon" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={open.busy || !(Number(covers) >= 1)} onClick={async () => { const r = await open.run(); if (r) onCreated(r.check.id); }}>Aç</button></>}>
      <div className="form-grid">
        <Field label="Masa / yer" className="span-2"><input className="input" value={table} onChange={e => setTable(e.target.value)} autoFocus maxLength={30} /></Field>
        <Field label="Kişi sayısı" className="span-2"><input className="input num" value={covers} onChange={e => setCovers(e.target.value.replace(/\D/g, ''))} inputMode="numeric" /></Field>
      </div>
      <ErrorBox error={open.error} />
    </Modal>
  );
}

function CheckScreen({ id, outletId, onClosed }: { id: string; outletId: string; onClosed: () => void }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const d = useQuery({ queryKey: ['pos', 'check', id], queryFn: () => get<PosCheckDetail>(`/api/v1/pos/checks/${id}`) });
  const products = useQuery({ queryKey: ['pos', 'products', outletId], queryFn: () => get<PosProduct[]>(`/api/v1/pos/products${qs({ outletId })}`) });
  const categories = useMemo(() => [...new Set((products.data ?? []).map(p => p.category))], [products.data]);
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [dlg, setDlg] = useState<'settle' | 'discount' | 'edit' | 'cancel' | null>(null);
  const [voiding, setVoiding] = useState<{ id: string; name: string } | null>(null);
  const setDetail = (r: PosCheckDetail) => { qc.setQueryData(['pos', 'check', id], r); void qc.invalidateQueries({ queryKey: ['pos', 'checks'] }); };
  const add = useAction(async (key: string, productId: string) => { const r = await post<PosCheckDetail>(`/api/v1/pos/checks/${id}/lines`, { productId, quantity: '1' }, key); setDetail(r); return r; }, { silentError: false });

  if (d.isLoading || !d.data) return <Spinner />;
  const c = d.data.check;
  const open = c.status === 'open';
  const shown = (products.data ?? []).filter(p => (!cat || p.category === cat) && (!q.trim() || `${p.name} ${p.code}`.toLocaleLowerCase('tr-TR').includes(q.trim().toLocaleLowerCase('tr-TR'))));
  const lines = d.data.lines;

  return (
    <div className="pos-check-screen">
      {open && can('pos.order') && (
        <div className="pos-menu">
          <div className="row wrap">
            <div className="seg wrap"><button className={!cat ? 'active' : ''} onClick={() => setCat('')}>Tümü</button>{categories.map(x => <button key={x} className={cat === x ? 'active' : ''} onClick={() => setCat(x)}>{x}</button>)}</div>
            <span className="spacer" /><Search size={15} className="muted" /><input className="input" style={{ width: 170 }} placeholder="Ürün ara" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          {products.isLoading ? <Spinner /> : shown.length === 0 ? <Empty title="Ürün yok" text={(products.data ?? []).length === 0 ? 'Bu satış noktasında satılan ürün tanımlı değil.' : undefined} /> : (
            <div className="pos-products">
              {shown.map(p => <button key={p.id} className="pos-product" disabled={add.busy} onClick={() => void add.run(p.id)}><span>{p.name}</span><b>{fmtMoney(p.price)}</b></button>)}
            </div>
          )}
          <ErrorBox error={add.error} />
        </div>
      )}
      <div className="pos-ticket card">
        <div className="card-head">
          <h3>{c.tableLabel ? `Masa ${c.tableLabel}` : 'Adisyon'} · #{c.checkNo}</h3>
          <div className="right">{c.status !== 'open' && <Badge color={c.status === 'cancelled' ? 'red' : 'green'}>{c.status === 'cancelled' ? 'İptal' : `Kapalı · ${SETTLE_LABEL[c.settlement ?? '']}`}</Badge>}
            {open && can('pos.order') && <button className="btn sm ghost" onClick={() => setDlg('edit')}>{c.covers} kişi</button>}</div>
        </div>
        <div className="card-body tight pos-ticket-lines">
          {lines.length === 0 ? <Empty title="Adisyon boş" text={open ? 'Soldan ürün seçin.' : undefined} /> : (
            <table className="dt"><tbody>{lines.map(l => (
              <tr key={l.id} className={l.isVoid ? 'strike muted' : ''} title={l.isVoid ? `İptal: ${l.voidReason} (${l.voidedBy})` : `${l.addedBy} · ${fmtDateTime(l.addedAt)}`}>
                <td style={{ width: 50 }} className="num">{fmtQty(l.quantity)}×</td>
                <td>{l.name}{l.note && <div className="muted" style={{ fontSize: 11 }}>{l.note}</div>}</td>
                <td className="num">{fmtMoney(l.amount)}</td>
                <td style={{ width: 34 }}>{open && !l.isVoid && <button className="btn sm ghost icon" title="Ürünü iptal et" onClick={() => setVoiding({ id: l.id, name: l.name })}><X /></button>}</td>
              </tr>))}</tbody></table>
          )}
        </div>
        <div className="pos-totals">
          <div className="row"><span>Ara toplam</span><span className="spacer" /><span>{fmtMoney(c.subtotal)}</span></div>
          {Number(c.discountAmount) > 0 && <div className="row"><span>İndirim <span className="muted">({c.discountReason})</span></span><span className="spacer" /><span className="amount-neg">-{fmtMoney(c.discountAmount)}</span></div>}
          <div className="row pos-grand"><span>Toplam</span><span className="spacer" /><b>{fmtMoney(c.total)}</b></div>
          {c.roomNumber && <div className="muted">Oda {c.roomNumber} · {c.guestName}</div>}
          {d.data.payments.map(p => <div key={p.id} className="row muted"><span>{p.isReversal ? 'İptal: ' : ''}{p.paymentMethod}{p.tenderedCurrency ? ` (${fmtMoney(p.tenderedAmount, p.tenderedCurrency)})` : ''}</span><span className="spacer" /><span>{fmtMoney(p.amount)}</span></div>)}
          {c.cancelReason && <div className="warn-box">İptal: {c.cancelReason}</div>}
        </div>
        <div className="pos-actions">
          {open && can('pos.discount') && <button className="btn" onClick={() => setDlg('discount')}><Percent /> İndirim</button>}
          {open && can('pos.settle') && <button className="btn primary big" disabled={lines.every(l => l.isVoid)} onClick={() => setDlg('settle')}><Wallet /> Kapat / öde</button>}
          {(open || (c.status === 'closed' && can('pos.void'))) && <button className="btn ghost" onClick={() => setDlg('cancel')}><Ban /> {open ? 'Adisyonu iptal et' : 'Kapanmış adisyonu iptal et'}</button>}
        </div>
      </div>
      {dlg === 'settle' && <SettleModal detail={d.data} onClose={() => setDlg(null)} onDone={r => { setDetail(r); setDlg(null); onClosed(); }} />}
      {dlg === 'discount' && <DiscountModal check={c} onClose={() => setDlg(null)} onDone={r => { setDetail(r); setDlg(null); }} />}
      {dlg === 'edit' && <EditCheckModal check={c} onClose={() => setDlg(null)} onDone={r => { setDetail(r); setDlg(null); }} />}
      {dlg === 'cancel' && <CancelCheckModal check={c} onClose={() => setDlg(null)} onDone={r => { setDetail(r); setDlg(null); onClosed(); }} />}
      {voiding && <VoidLineModal line={voiding} onClose={() => setVoiding(null)} onDone={r => { setDetail(r); setVoiding(null); }} />}
    </div>
  );
}

function VoidLineModal({ line, onClose, onDone }: { line: { id: string; name: string }; onClose: () => void; onDone: (r: PosCheckDetail) => void }) {
  const [reason, setReason] = useState('');
  const act = useAction(async (key: string) => onDone(await post<PosCheckDetail>(`/api/v1/pos/check-lines/${line.id}/void`, { reason: reason.trim() }, key)));
  return (
    <Modal title={`${line.name} · iptal`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn danger" disabled={!reason.trim() || act.busy} onClick={() => void act.run()}>İptal et</button></>}>
      <div className="stack">
        <div className="muted" style={{ fontSize: 12 }}>Kendi eklediğiniz ürünü 2 dakika içinde iptal edebilirsiniz; sonrası için iptal yetkisi gerekir. İptaller raporda görünür.</div>
        <Field label="Gerekçe" required><input className="input" list="pos-void-reasons" value={reason} onChange={e => setReason(e.target.value)} autoFocus maxLength={200} />
          <datalist id="pos-void-reasons">{['Yanlış ürün', 'Misafir vazgeçti', 'Mutfakta yok', 'İade'].map(x => <option key={x} value={x} />)}</datalist></Field>
        <ErrorBox error={act.error} />
      </div>
    </Modal>
  );
}

function DiscountModal({ check, onClose, onDone }: { check: PosCheck; onClose: () => void; onDone: (r: PosCheckDetail) => void }) {
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

function EditCheckModal({ check, onClose, onDone }: { check: PosCheck; onClose: () => void; onDone: (r: PosCheckDetail) => void }) {
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

function CancelCheckModal({ check, onClose, onDone }: { check: PosCheck; onClose: () => void; onDone: (r: PosCheckDetail) => void }) {
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

function SettleModal({ detail, onClose, onDone }: { detail: PosCheckDetail; onClose: () => void; onDone: (r: PosCheckDetail) => void }) {
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
