import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChefHat, Percent, Plus, Wallet, X } from 'lucide-react';
import { get, post, qs } from '../lib/api';
import type { Outlet, PosCheck, PosCheckDetail, PosProduct, PosSendResult } from '../lib/types';
import { fmtMoney, fmtQty } from '../lib/format';
import { useSession } from '../lib/session';
import { Empty, ErrorBox, Field, Modal, Spinner, useToast } from './ui';
import { DiscountModal, SettleModal } from './PosDialogs';

const OUTLET_KEY = 'pms.pos.outlet';
function readOutlet() { try { return localStorage.getItem(OUTLET_KEY) ?? ''; } catch { return ''; } }
function saveOutlet(id: string) { try { localStorage.setItem(OUTLET_KEY, id); } catch { /* depolama kapalı olabilir */ } }

/** Telefon/tablet garson ekranı: masa adisyonu, ürün ekleme, kendi yanlışını iptal, mutfağa gönderme; yetkiye göre indirim ve hesap kapatma. */
export function MobilePos() {
  const outlets = useQuery({ queryKey: ['pos', 'outlets'], queryFn: () => get<Outlet[]>('/api/v1/pos/outlets') });
  const active = (outlets.data ?? []).filter(o => o.isActive);
  const [outletId, setOutletId] = useState(readOutlet);
  const outlet = active.find(o => o.id === outletId) ?? active[0];
  const [sel, setSel] = useState<string | null>(null);
  if (outlets.isLoading) return <Spinner />;
  if (outlets.error) return <ErrorBox error={outlets.error} />;
  if (!outlet) return <Empty title="Satış noktası tanımlı değil" />;
  if (sel) return <MobileCheck id={sel} outletId={outlet.id} onBack={() => setSel(null)} />;
  return (
    <>
      {active.length > 1 && <div className="m-filters">{active.map(o => <button key={o.id} className={o.id === outlet.id ? 'active' : ''} onClick={() => { setOutletId(o.id); saveOutlet(o.id); }}>{o.name}</button>)}</div>}
      <MobileCheckList outletId={outlet.id} onSelect={setSel} />
    </>
  );
}

function MobileCheckList({ outletId, onSelect }: { outletId: string; onSelect: (id: string) => void }) {
  const { can } = useSession();
  const list = useQuery({ queryKey: ['pos', 'checks', outletId, 'open'], queryFn: () => get<PosCheck[]>(`/api/v1/pos/checks${qs({ outletId, status: 'open' })}`) });
  const [create, setCreate] = useState(false);
  return (
    <>
      {can('pos.order') && <button className="btn primary big" style={{ width: '100%', marginBottom: 10 }} onClick={() => setCreate(true)}><Plus /> Yeni adisyon</button>}
      {list.isLoading ? <Spinner /> : list.error ? <ErrorBox error={list.error} /> : (list.data ?? []).length === 0 ? <Empty title="Açık adisyon yok" /> : (
        <div className="m-grid">
          {list.data!.map(c => (
            <button key={c.id} className="m-check" onClick={() => onSelect(c.id)}>
              <span className="m-no">{c.tableLabel ?? `#${c.checkNo}`}</span>
              <span>{fmtMoney(c.total)}</span>
              <small>{c.covers} kişi · {fmtQty(c.itemCount)} ürün</small>
            </button>
          ))}
        </div>
      )}
      {create && <NewCheck outletId={outletId} onClose={() => setCreate(false)} onCreated={id => { setCreate(false); onSelect(id); }} />}
    </>
  );
}

function NewCheck({ outletId, onClose, onCreated }: { outletId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [table, setTable] = useState('');
  const [covers, setCovers] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const open = async () => {
    setBusy(true); setError(null);
    try {
      const r = await post<PosCheckDetail>('/api/v1/pos/checks', { outletId, tableLabel: table.trim() || null, covers }, crypto.randomUUID());
      await qc.invalidateQueries({ queryKey: ['pos'] });
      onCreated(r.check.id);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title="Yeni adisyon" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy} onClick={() => void open()}>Aç</button></>}>
      <div className="stack">
        <Field label="Masa"><input className="input" value={table} onChange={e => setTable(e.target.value)} autoFocus inputMode="text" maxLength={30} /></Field>
        <Field label="Kişi sayısı">
          <div className="row"><button className="btn big" onClick={() => setCovers(c => Math.max(1, c - 1))}>−</button><b style={{ fontSize: 22, minWidth: 40, textAlign: 'center' }}>{covers}</b><button className="btn big" onClick={() => setCovers(c => Math.min(99, c + 1))}>+</button></div>
        </Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function MobileCheck({ id, outletId, onBack }: { id: string; outletId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useSession();
  const d = useQuery({ queryKey: ['pos', 'check', id], queryFn: () => get<PosCheckDetail>(`/api/v1/pos/checks/${id}`) });
  const products = useQuery({ queryKey: ['pos', 'products', outletId], queryFn: () => get<PosProduct[]>(`/api/v1/pos/products${qs({ outletId })}`) });
  const cats = useMemo(() => [...new Set((products.data ?? []).map(p => p.category))], [products.data]);
  const [cat, setCat] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'menu' | 'ticket'>('menu');
  const [voiding, setVoiding] = useState<{ id: string; name: string } | null>(null);
  const [dlg, setDlg] = useState<'settle' | 'discount' | null>(null);
  const apply = (r: PosCheckDetail) => { qc.setQueryData(['pos', 'check', id], r); void qc.invalidateQueries({ queryKey: ['pos', 'checks'] }); };
  const call = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { toast.error(e); } finally { setBusy(false); } };
  const add = (productId: string) => call(async () => apply(await post<PosCheckDetail>(`/api/v1/pos/checks/${id}/lines`, { productId, quantity: '1' }, crypto.randomUUID())));
  const send = () => call(async () => {
    const r = await post<PosSendResult>(`/api/v1/pos/checks/${id}/send`, {}, crypto.randomUUID());
    apply(r.detail);
    if (r.failed.length) toast.error(new Error(r.failed.map(f => `${f.printer}: ${f.error}`).join(' · ')));
    else toast.ok(r.lines ? `Gönderildi: ${r.sent.join(', ')}` : 'Gönderilecek yeni ürün yok.');
  });

  if (d.isLoading || !d.data) return <Spinner />;
  const c = d.data.check;
  if (c.status !== 'open') return <><button className="btn ghost" onClick={onBack}><ArrowLeft /> Adisyonlar</button><Empty title="Adisyon kapatılmış" /></>;
  const lines = d.data.lines.filter(l => !l.isVoid);
  const pending = lines.filter(l => l.printable && !l.sentAt).length;
  const shown = (products.data ?? []).filter(p => !cat || p.category === cat);
  return (
    <div className="m-pos">
      <div className="row"><button className="btn ghost" onClick={onBack}><ArrowLeft /></button><b style={{ fontSize: 17 }}>{c.tableLabel ? `Masa ${c.tableLabel}` : `#${c.checkNo}`}</b>
        <span className="spacer" /><b style={{ fontSize: 17 }}>{fmtMoney(c.total)}</b></div>
      <div className="m-filters"><button className={view === 'menu' ? 'active' : ''} onClick={() => setView('menu')}>Menü</button><button className={view === 'ticket' ? 'active' : ''} onClick={() => setView('ticket')}>Adisyon ({lines.length})</button></div>
      {view === 'menu' ? <>
        <div className="m-filters"><button className={!cat ? 'active' : ''} onClick={() => setCat('')}>Tümü</button>{cats.map(x => <button key={x} className={cat === x ? 'active' : ''} onClick={() => setCat(x)}>{x}</button>)}</div>
        {can('pos.order') && <div className="m-products">{shown.map(p => <button key={p.id} disabled={busy} onClick={() => void add(p.id)}><span>{p.name}</span><b>{fmtMoney(p.price)}</b></button>)}</div>}
      </> : (
        lines.length === 0 ? <Empty title="Adisyon boş" /> : (
          <ul className="m-list">{lines.map(l => (
            <li key={l.id}><div><b>{fmtQty(l.quantity)} × {l.name}</b><small>{fmtMoney(l.amount)}{l.printable ? (l.sentAt ? ' · mutfakta' : ' · gönderilmedi') : ''}</small></div>
              <button className="btn ghost icon" aria-label="İptal" onClick={() => setVoiding({ id: l.id, name: l.name })}><X /></button></li>))}</ul>
        )
      )}
      <div className="m-pos-bar">
        <button className={`btn big ${pending ? 'primary' : ''}`} disabled={busy} onClick={() => void send()}><ChefHat /> {pending ? `Mutfağa gönder (${pending})` : 'Mutfağa gönder'}</button>
        {(can('pos.settle') || can('pos.discount')) && (
          <div className="row" style={{ marginTop: 8 }}>
            {can('pos.discount') && <button className="btn big" style={{ flex: 1 }} onClick={() => setDlg('discount')}><Percent /> İndirim</button>}
            {can('pos.settle') && <button className="btn big primary" style={{ flex: 2 }} disabled={lines.length === 0} onClick={() => setDlg('settle')}><Wallet /> Hesabı kapat</button>}
          </div>
        )}
      </div>
      {!can('pos.settle') && <div className="muted" style={{ fontSize: 12, textAlign: 'center' }}>Hesap kasada kapatılır.</div>}
      {dlg === 'settle' && <SettleModal detail={d.data} pending={pending} onClose={() => setDlg(null)} onDone={r => { apply(r); setDlg(null); onBack(); }} />}
      {dlg === 'discount' && <DiscountModal check={c} onClose={() => setDlg(null)} onDone={r => { apply(r); setDlg(null); }} />}
      {voiding && <VoidModal line={voiding} onClose={() => setVoiding(null)} onDone={r => { apply(r); setVoiding(null); }} />}
    </div>
  );
}

function VoidModal({ line, onClose, onDone }: { line: { id: string; name: string }; onClose: () => void; onDone: (r: PosCheckDetail) => void }) {
  const [reason, setReason] = useState('Yanlış ürün');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); setError(null);
    try { onDone(await post<PosCheckDetail>(`/api/v1/pos/check-lines/${line.id}/void`, { reason: reason.trim() }, crypto.randomUUID())); }
    catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={`${line.name} iptal`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn danger" disabled={!reason.trim() || busy} onClick={() => void run()}>İptal et</button></>}>
      <div className="stack">
        <div className="m-filters">{['Yanlış ürün', 'Misafir vazgeçti', 'Mutfakta yok'].map(x => <button key={x} className={reason === x ? 'active' : ''} onClick={() => setReason(x)}>{x}</button>)}</div>
        <Field label="Gerekçe"><input className="input" value={reason} onChange={e => setReason(e.target.value)} maxLength={200} /></Field>
        <div className="muted" style={{ fontSize: 12 }}>Kendi eklediğiniz ürünü mutfağa/bara gönderilmeden 2 dakika içinde iptal edebilirsiniz; sonrası için müdür onayı gerekir.</div>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
