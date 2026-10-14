import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, ChefHat, Percent, Plus, Receipt, Search, Utensils, Wallet, X } from 'lucide-react';
import { get, post, qs } from '../lib/api';
import type { Outlet, PosCheck, PosCheckDetail, PosProduct, PosSendResult } from '../lib/types';
import { fmtDateTime, fmtMoney, fmtQty } from '../lib/format';
import { useSession } from '../lib/session';
import { PageHead, useAction } from '../components/common';
import { Badge, Empty, ErrorBox, Field, Modal, Spinner, Tabs, useToast } from '../components/ui';
import { CancelCheckModal, DiscountModal, EditCheckModal, SettleModal, VoidLineModal } from '../components/PosDialogs';

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
  const toast = useToast();
  const send = useAction(async (key: string) => {
    const r = await post<PosSendResult>(`/api/v1/pos/checks/${id}/send`, {}, key);
    setDetail(r.detail);
    if (r.failed.length) toast.error(`Fiş basılamadı — ${r.failed.map(f => `${f.printer}: ${f.error}`).join(' · ')}. Ürünler "gönderilmedi" olarak bekliyor; yazıcıyı kontrol edip tekrar gönderin.`);
    else if (r.lines) toast.ok(`Sipariş gönderildi: ${r.sent.join(', ')}`);
    return r;
  });
  const setDetail = (r: PosCheckDetail) => { qc.setQueryData(['pos', 'check', id], r); void qc.invalidateQueries({ queryKey: ['pos', 'checks'] }); };
  const add = useAction(async (key: string, productId: string) => { const r = await post<PosCheckDetail>(`/api/v1/pos/checks/${id}/lines`, { productId, quantity: '1' }, key); setDetail(r); return r; }, { silentError: false });

  if (d.isLoading || !d.data) return <Spinner />;
  const c = d.data.check;
  const open = c.status === 'open';
  const shown = (products.data ?? []).filter(p => (!cat || p.category === cat) && (!q.trim() || `${p.name} ${p.code}`.toLocaleLowerCase('tr-TR').includes(q.trim().toLocaleLowerCase('tr-TR'))));
  const lines = d.data.lines;
  // Gönderilmemiş yazdırılabilir ürünler ve gönderildikten sonra iptal edilenler (iptal fişi bekler).
  const pending = lines.filter(l => l.printable && !l.isVoid && !l.sentAt).length;

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
                <td>{l.name}{l.printable && !l.isVoid && (l.sentAt ? <ChefHat size={12} className="muted" style={{ marginLeft: 4 }} /> : <Badge color="orange">Gönderilmedi</Badge>)}
                  {l.note && <div className="muted" style={{ fontSize: 11 }}>{l.note}</div>}</td>
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
          {open && can('pos.order') && <button className={`btn ${pending ? 'primary' : ''}`} disabled={send.busy} onClick={() => void send.run()}><ChefHat /> {send.busy ? 'Gönderiliyor…' : pending ? `Mutfağa gönder (${pending})` : 'Mutfağa gönder'}</button>}
          {open && can('pos.discount') && <button className="btn" onClick={() => setDlg('discount')}><Percent /> İndirim</button>}
          {open && can('pos.settle') && <button className="btn primary big" disabled={lines.every(l => l.isVoid)} onClick={() => setDlg('settle')}><Wallet /> Kapat / öde</button>}
          {(open || (c.status === 'closed' && can('pos.void'))) && <button className="btn ghost" onClick={() => setDlg('cancel')}><Ban /> {open ? 'Adisyonu iptal et' : 'Kapanmış adisyonu iptal et'}</button>}
        </div>
      </div>
      {dlg === 'settle' && <SettleModal detail={d.data} pending={pending} onClose={() => setDlg(null)} onDone={r => { setDetail(r); setDlg(null); onClosed(); }} />}
      {dlg === 'discount' && <DiscountModal check={c} onClose={() => setDlg(null)} onDone={r => { setDetail(r); setDlg(null); }} />}
      {dlg === 'edit' && <EditCheckModal check={c} onClose={() => setDlg(null)} onDone={r => { setDetail(r); setDlg(null); }} />}
      {dlg === 'cancel' && <CancelCheckModal check={c} onClose={() => setDlg(null)} onDone={r => { setDetail(r); setDlg(null); onClosed(); }} />}
      {voiding && <VoidLineModal line={voiding} onClose={() => setVoiding(null)} onDone={r => { setDetail(r); setVoiding(null); }} />}
    </div>
  );
}
