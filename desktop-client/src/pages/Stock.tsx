import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, ClipboardCheck, PackageMinus, PackagePlus, Plus, Search, Trash2 } from 'lucide-react';
import { api, get, post, qs } from '../lib/api';
import type { StockBalance, StockDocument, StockDocumentLine, StockItem, StockMovement, Supplier, Warehouse } from '../lib/types';
import { useStockItems, useSuppliers, useWarehouses } from '../lib/queries';
import { DOC_KIND, StockDocumentModal, type DocKind } from '../components/StockDocument';
import { fmtDate, fmtDateTime, fmtMoney, fmtQty, parseDecimal } from '../lib/format';
import { useSession } from '../lib/session';
import { PageHead, useAction } from '../components/common';
import { Badge, DataTable, Empty, ErrorBox, Field, Modal, Spinner, Tabs, type Column } from '../components/ui';


type Tab = 'balances' | 'items' | 'documents' | 'setup';

export default function StockPage() {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('balances');
  const [doc, setDoc] = useState<DocKind | null>(null);
  return (
    <div className="page">
      <PageHead title="Stok" sub="Depo bakiyeleri, stok kartları ve stok belgeleri" actions={<>
        {can('stock.receive') && <button className="btn primary" onClick={() => setDoc('receipt')}><PackagePlus /> Mal kabul</button>}
        {can('stock.issue') && <button className="btn" onClick={() => setDoc('issue')}><PackageMinus /> Çıkış</button>}
        {can('stock.issue') && <button className="btn" onClick={() => setDoc('transfer')}><ArrowRightLeft /> Transfer</button>}
        {can('stock.count') && <button className="btn" onClick={() => setDoc('count')}><ClipboardCheck /> Sayım</button>}
      </>} />
      <Tabs value={tab} onChange={setTab} items={[{ key: 'balances', label: 'Stok durumu' }, { key: 'items', label: 'Stok kartları' }, { key: 'documents', label: 'Belgeler' },
        { key: 'setup', label: 'Depolar ve tedarikçiler' }]} />
      {tab === 'balances' && <BalancesTab />}
      {tab === 'items' && <ItemsTab />}
      {tab === 'documents' && <DocumentsTab />}
      {tab === 'setup' && <SetupTab />}
      {doc && <StockDocumentModal kind={doc} onClose={() => setDoc(null)} />}
    </div>
  );
}

function BalancesTab() {
  const wh = useWarehouses();
  const [w, setW] = useState('');
  const [q, setQ] = useState('');
  const [low, setLow] = useState(false);
  const [item, setItem] = useState<StockBalance | null>(null);
  const list = useQuery({ queryKey: ['stock', 'balances', w, low], queryFn: () => get<StockBalance[]>(`/api/v1/stock/balances${qs({ warehouseId: w || null, lowOnly: low || null, nonZero: low ? null : true })}`) });
  const rows = (list.data ?? []).filter(b => !q.trim() || `${b.itemCode} ${b.itemName} ${b.category ?? ''}`.toLocaleLowerCase('tr-TR').includes(q.trim().toLocaleLowerCase('tr-TR')));
  const total = rows.reduce((s, b) => s + Number(b.value), 0);
  const cols: Column<StockBalance>[] = [
    { key: 'warehouseCode', header: 'Depo', width: 90 },
    { key: 'itemCode', header: 'Kod', width: 110, render: b => <span className="mono">{b.itemCode}</span> },
    { key: 'itemName', header: 'Stok', filter: true },
    { key: 'category', header: 'Kategori', width: 130, filter: true },
    { key: 'quantity', header: 'Miktar', align: 'right', width: 120, value: b => Number(b.quantity), render: b => <b className={Number(b.quantity) < 0 ? 'amount-neg' : ''}>{fmtQty(b.quantity)} {b.unit}</b> },
    { key: 'avgCost', header: 'Ort. maliyet', align: 'right', width: 110, value: b => Number(b.avgCost), render: b => fmtMoney(b.avgCost) },
    { key: 'value', header: 'Tutar', align: 'right', width: 120, value: b => Number(b.value), render: b => fmtMoney(b.value) },
    { key: 'status', header: 'Durum', width: 100, render: b => Number(b.quantity) < 0 ? <Badge color="red">Eksi stok</Badge> : b.minQty && Number(b.quantity) < Number(b.minQty) ? <Badge color="orange">Kritik</Badge> : null },
  ];
  return (
    <>
      <div className="toolbar">
        <select className="input" style={{ width: 200 }} value={w} onChange={e => setW(e.target.value)}><option value="">Tüm depolar</option>{wh.data?.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <Search size={15} className="muted" /><input className="input" style={{ width: 240 }} placeholder="Kod, ad, kategori" value={q} onChange={e => setQ(e.target.value)} />
        <label className="check"><input type="checkbox" checked={low} onChange={e => setLow(e.target.checked)} /> Yalnız kritik ve eksi stok</label>
        <span className="count">{rows.length} kayıt · {fmtMoney(total.toFixed(2))}</span>
      </div>
      {list.error ? <ErrorBox error={list.error} /> : (
        <DataTable rows={rows} columns={cols} rowKey={b => b.warehouseId + b.itemId} onRowClick={setItem} maxHeight="calc(100vh - 290px)"
          empty={<Empty title={list.isLoading ? 'Yükleniyor…' : low ? 'Kritik seviyede stok yok' : 'Stokta ürün yok'} text={low ? undefined : 'Stok girişi Mal kabul ile yapılır.'} />} />
      )}
      {item && <MovementsModal itemId={item.itemId} warehouseId={item.warehouseId} title={`${item.itemCode} ${item.itemName} · ${item.warehouseName}`} unit={item.unit} onClose={() => setItem(null)} />}
    </>
  );
}

function MovementsModal({ itemId, warehouseId, title, unit, onClose }: { itemId: string; warehouseId?: string; title: string; unit: string; onClose: () => void }) {
  const mv = useQuery({ queryKey: ['stock', 'movements', itemId, warehouseId], queryFn: () => get<StockMovement[]>(`/api/v1/stock/items/${itemId}/movements${qs({ warehouseId: warehouseId ?? null })}`) });
  return (
    <Modal title={`Hareketler · ${title}`} size="xl" onClose={onClose} footer={<button className="btn" onClick={onClose}>Kapat</button>}>
      {mv.isLoading ? <Spinner /> : mv.error ? <ErrorBox error={mv.error} /> : (mv.data ?? []).length === 0 ? <Empty title="Hareket yok" /> : (
        <div className="table-wrap" style={{ maxHeight: 460 }}>
          <table className="dt"><thead><tr><th>Tarih</th><th>Belge</th><th>Tür</th><th>Depo</th><th>Karşı taraf</th><th style={{ textAlign: 'right' }}>Miktar</th><th style={{ textAlign: 'right' }}>Birim maliyet</th><th>Kullanıcı</th></tr></thead>
            <tbody>{mv.data!.map(m => (
              <tr key={m.id} className={m.isReversal ? 'muted' : ''}>
                <td>{fmtDate(m.businessDate)}</td><td className="mono">{m.docNo}</td><td>{DOC_KIND[m.kind] ?? m.kind}{m.isReversal && <Badge color="gray">İptal</Badge>}</td><td>{m.warehouseCode}</td>
                <td>{m.party}</td><td className="num"><b className={Number(m.quantity) < 0 ? 'amount-neg' : ''}>{fmtQty(m.quantity)} {unit}</b></td><td className="num">{fmtMoney(m.unitCost)}</td><td>{m.username}</td>
              </tr>))}</tbody></table>
        </div>
      )}
    </Modal>
  );
}

function ItemsTab() {
  const { can } = useSession();
  const [inactive, setInactive] = useState(false);
  const items = useStockItems(inactive);
  const [edit, setEdit] = useState<StockItem | 'new' | null>(null);
  const [mv, setMv] = useState<StockItem | null>(null);
  const cols: Column<StockItem>[] = [
    { key: 'code', header: 'Kod', width: 120, render: i => <span className="mono">{i.code}</span> },
    { key: 'name', header: 'Ad', filter: true, render: i => <>{i.name}{!i.isActive && <Badge color="gray">Pasif</Badge>}</> },
    { key: 'category', header: 'Kategori', width: 140, filter: true },
    { key: 'unit', header: 'Birim', width: 80 },
    { key: 'barcode', header: 'Barkod', width: 130 },
    { key: 'minQty', header: 'Asgari', align: 'right', width: 90, render: i => fmtQty(i.minQty) },
    { key: 'vatRate', header: 'KDV %', align: 'right', width: 70 },
    { key: 'totalQty', header: 'Toplam stok', align: 'right', width: 120, value: i => Number(i.totalQty), render: i => `${fmtQty(i.totalQty)} ${i.unit}` },
  ];
  return (
    <>
      <div className="toolbar">
        {can('stock.manage') && <button className="btn primary" onClick={() => setEdit('new')}><Plus /> Yeni stok kartı</button>}
        <label className="check"><input type="checkbox" checked={inactive} onChange={e => setInactive(e.target.checked)} /> Pasifleri de göster</label>
        <span className="count">{items.data?.length ?? 0} kart</span>
      </div>
      {items.error ? <ErrorBox error={items.error} /> : (
        <DataTable rows={items.data ?? []} columns={cols} rowKey={i => i.id} onRowClick={i => (can('stock.manage') ? setEdit(i) : setMv(i))} maxHeight="calc(100vh - 290px)"
          empty={<Empty title={items.isLoading ? 'Yükleniyor…' : 'Henüz stok kartı yok'} text="Stoklarını takip etmek istediğiniz malzemeleri kart olarak tanımlayın." />} />
      )}
      {edit && <ItemModal item={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onMovements={i => { setEdit(null); setMv(i); }} />}
      {mv && <MovementsModal itemId={mv.id} title={`${mv.code} ${mv.name}`} unit={mv.unit} onClose={() => setMv(null)} />}
    </>
  );
}

function ItemModal({ item: i, onClose, onMovements }: { item?: StockItem; onClose: () => void; onMovements: (i: StockItem) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: i?.code ?? '', name: i?.name ?? '', unit: i?.unit ?? 'adet', category: i?.category ?? '', barcode: i?.barcode ?? '',
    minQty: i?.minQty ? fmtQty(i.minQty) : '', vatRate: i?.vatRate ?? '20', isActive: i?.isActive ?? true });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(s => ({ ...s, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
  const minQty = f.minQty.trim() ? parseDecimal(f.minQty) : null;
  const save = useAction(async () => {
    const body = { code: f.code.trim().toUpperCase(), name: f.name, unit: f.unit, category: f.category || null, barcode: f.barcode || null, minQty, vatRate: f.vatRate.replace(',', '.'), isActive: f.isActive, version: i?.version };
    if (i) await api('PUT', `/api/v1/stock/items/${i.id}`, body); else await api('POST', '/api/v1/stock/items', body);
    await qc.invalidateQueries({ queryKey: ['stock'] });
  }, { success: 'Stok kartı kaydedildi.' });
  return (
    <Modal title={i ? `Stok kartı · ${i.code}` : 'Yeni stok kartı'} onClose={onClose} footer={<>
      {i && <button className="btn ghost" onClick={() => onMovements(i)}>Hareketler</button>}<span className="spacer" />
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!f.code.trim() || !f.name.trim() || !f.unit.trim() || (!!f.minQty.trim() && !minQty) || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button>
    </>}>
      <div className="form-grid">
        <Field label="Kod" required><input className="input" value={f.code} onChange={set('code')} autoFocus /></Field>
        <Field label="Ad" required className="span-3"><input className="input" value={f.name} onChange={set('name')} /></Field>
        <Field label="Birim" required hint="adet, kg, lt, paket…"><input className="input" value={f.unit} onChange={set('unit')} list="stock-units" /></Field>
        <Field label="Kategori"><input className="input" value={f.category} onChange={set('category')} /></Field>
        <Field label="Barkod"><input className="input" value={f.barcode} onChange={set('barcode')} /></Field>
        <Field label="KDV %"><input className="input num" value={f.vatRate} onChange={set('vatRate')} /></Field>
        <Field label="Asgari stok" hint="Altına düşünce kritik listede görünür"><input className="input num" value={f.minQty} onChange={set('minQty')} inputMode="decimal" /></Field>
        <div className="span-3" style={{ alignSelf: 'end' }}><label className="check"><input type="checkbox" checked={f.isActive} onChange={set('isActive')} /> Aktif</label></div>
      </div>
      <datalist id="stock-units">{['adet', 'kg', 'g', 'lt', 'ml', 'paket', 'koli', 'şişe', 'kutu', 'rulo', 'porsiyon'].map(u => <option key={u} value={u} />)}</datalist>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function DocumentsTab() {
  const { property } = useSession();
  const bd = property?.businessDate ?? '';
  const [from, setFrom] = useState(bd);
  const [to, setTo] = useState(bd);
  const [kind, setKind] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['stock', 'documents', from, to, kind], queryFn: () => get<StockDocument[]>(`/api/v1/stock/documents${qs({ from: from || null, to: to || null, kind: kind || null })}`) });
  const cols: Column<StockDocument>[] = [
    { key: 'businessDate', header: 'Tarih', width: 100, render: d => fmtDate(d.businessDate) },
    { key: 'docNo', header: 'Belge', width: 100, render: d => <span className="mono">{d.docNo}</span> },
    { key: 'kind', header: 'Tür', width: 130, value: d => DOC_KIND[d.kind], render: d => <>{DOC_KIND[d.kind]}{d.isCancelled && <Badge color="red">İptal</Badge>}</> },
    { key: 'warehouseName', header: 'Depo', width: 140, render: d => <>{d.warehouseName}{d.targetWarehouseName && ` → ${d.targetWarehouseName}`}</> },
    { key: 'party', header: 'Tedarikçi / Bölüm', filter: true, value: d => d.supplierName ?? d.department ?? d.reference ?? '' },
    { key: 'invoiceNo', header: 'Fatura', width: 110 },
    { key: 'lineCount', header: 'Kalem', align: 'right', width: 70 },
    { key: 'totalValue', header: 'Tutar', align: 'right', width: 120, value: d => Number(d.totalValue), render: d => fmtMoney(d.totalValue) },
    { key: 'username', header: 'Kullanıcı', width: 110 },
  ];
  return (
    <>
      <div className="toolbar">
        <input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} /> – <input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} />
        <select className="input" style={{ width: 160 }} value={kind} onChange={e => setKind(e.target.value)}><option value="">Tüm türler</option>{Object.entries(DOC_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <span className="count">{list.data?.length ?? 0} belge</span>
      </div>
      {list.error ? <ErrorBox error={list.error} /> : (
        <DataTable rows={list.data ?? []} columns={cols} rowKey={d => d.id} onRowClick={d => setSel(d.id)} maxHeight="calc(100vh - 290px)" rowClass={d => (d.isCancelled ? 'strike' : '')}
          empty={<Empty title={list.isLoading ? 'Yükleniyor…' : 'Bu aralıkta stok belgesi yok'} />} />
      )}
      {sel && <DocumentDetailModal id={sel} onClose={() => setSel(null)} />}
    </>
  );
}

function DocumentDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const d = useQuery({ queryKey: ['stock', 'document', id], queryFn: () => get<{ document: StockDocument; lines: StockDocumentLine[] }>(`/api/v1/stock/documents/${id}`) });
  const [reason, setReason] = useState('');
  const cancel = useAction(async (key: string) => { await post(`/api/v1/stock/documents/${id}/cancel`, { reason }, key); await qc.invalidateQueries({ queryKey: ['stock'] }); }, { success: 'Belge iptal edildi; ters hareketler yazıldı.' });
  const doc = d.data?.document;
  return (
    <Modal title={doc ? `${DOC_KIND[doc.kind]} · ${doc.docNo}` : 'Stok belgesi'} size="xl" onClose={onClose} footer={<button className="btn" onClick={onClose}>Kapat</button>}>
      {d.isLoading || !doc ? <Spinner /> : (
        <div className="stack">
          <div className="muted">
            {fmtDate(doc.businessDate)} · {doc.warehouseName}{doc.targetWarehouseName && ` → ${doc.targetWarehouseName}`}{doc.supplierName && ` · ${doc.supplierName}`}{doc.department && ` · ${doc.department}`}
            {doc.invoiceNo && ` · Fatura ${doc.invoiceNo}${doc.invoiceDate ? ' / ' + fmtDate(doc.invoiceDate) : ''}`}{doc.purchaseOrderNo && ` · Sipariş ${doc.purchaseOrderNo}`}{doc.reference && ` · ${doc.reference}`}
            {' · '}{doc.username} {fmtDateTime(doc.createdAt)}
          </div>
          {doc.notes && <div>{doc.notes}</div>}
          {doc.isCancelled && <div className="warn-box">İptal edildi: {doc.cancelReason}</div>}
          <div className="table-wrap" style={{ maxHeight: 360 }}>
            <table className="dt"><thead><tr><th>Kod</th><th>Stok</th><th>Depo</th><th style={{ textAlign: 'right' }}>Miktar</th><th style={{ textAlign: 'right' }}>Birim maliyet</th><th style={{ textAlign: 'right' }}>Tutar</th></tr></thead>
              <tbody>{d.data!.lines.map((l, i) => (
                <tr key={i} className={l.isReversal ? 'muted' : ''}><td className="mono">{l.itemCode}</td><td>{l.itemName}{l.isReversal && <Badge color="gray">İptal</Badge>}</td><td>{l.warehouseCode}</td>
                  <td className="num">{fmtQty(l.quantity)} {l.unit}</td><td className="num">{fmtMoney(l.unitCost)}</td><td className="num">{fmtMoney(l.amount)}</td></tr>))}</tbody></table>
          </div>
          {!doc.isCancelled && doc.kind !== 'pos' && can('stock.manage') && (
            <div className="row">
              <input className="input" style={{ flex: 1 }} placeholder="İptal gerekçesi" value={reason} onChange={e => setReason(e.target.value)} />
              <button className="btn danger" disabled={!reason.trim() || cancel.busy} onClick={async () => { if (await cancel.run() !== undefined) onClose(); }}><Trash2 /> Belgeyi iptal et</button>
            </div>
          )}
          {doc.kind === 'pos' && <div className="muted" style={{ fontSize: 12 }}>Satış tüketimi belgesi, ilgili adisyon iptal edilince otomatik geri alınır.</div>}
          <ErrorBox error={cancel.error} />
        </div>
      )}
    </Modal>
  );
}

function SetupTab() {
  const { can } = useSession();
  const wh = useWarehouses();
  const [inactive, setInactive] = useState(false);
  const sup = useSuppliers(inactive);
  const [w, setW] = useState<Warehouse | 'new' | null>(null);
  const [s, setS] = useState<Supplier | 'new' | null>(null);
  const canSup = can('stock.manage') || can('purchase.manage');
  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <div className="card"><div className="card-head"><h3>Depolar</h3><div className="right">{can('stock.manage') && <button className="btn sm primary" onClick={() => setW('new')}><Plus /> Ekle</button>}</div></div>
        <div className="card-body tight">
          <DataTable rows={wh.data ?? []} columns={[{ key: 'code', header: 'Kod', width: 90 }, { key: 'name', header: 'Ad' }, { key: 'isActive', header: '', width: 80, render: (x: Warehouse) => !x.isActive && <Badge color="gray">Pasif</Badge> }]}
            rowKey={x => x.id} onRowClick={x => can('stock.manage') && setW(x)} empty={<Empty title="Depo tanımlı değil" text="Stok tutulan her yer (ana depo, mutfak, bar) için depo tanımlayın." />} />
        </div></div>
      <div className="card"><div className="card-head"><h3>Tedarikçiler</h3><div className="right">
        <label className="check"><input type="checkbox" checked={inactive} onChange={e => setInactive(e.target.checked)} /> Pasifler</label>
        {canSup && <button className="btn sm primary" onClick={() => setS('new')}><Plus /> Ekle</button>}</div></div>
        <div className="card-body tight">
          <DataTable rows={sup.data ?? []} columns={[{ key: 'name', header: 'Ad', filter: true, render: (x: Supplier) => <>{x.name}{!x.isActive && <Badge color="gray">Pasif</Badge>}</> },
            { key: 'taxNumber', header: 'Vergi no', width: 120 }, { key: 'phone', header: 'Telefon', width: 130 }]}
            rowKey={x => x.id} onRowClick={x => canSup && setS(x)} empty={<Empty title="Tedarikçi tanımlı değil" />} />
        </div></div>
      {w && <WarehouseModal w={w === 'new' ? undefined : w} onClose={() => setW(null)} />}
      {s && <SupplierModal s={s === 'new' ? undefined : s} onClose={() => setS(null)} />}
    </div>
  );
}

function WarehouseModal({ w, onClose }: { w?: Warehouse; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: w?.code ?? '', name: w?.name ?? '', isActive: w?.isActive ?? true });
  const save = useAction(async () => {
    const body = { ...f, code: f.code.trim().toUpperCase(), version: w?.version };
    if (w) await api('PUT', `/api/v1/stock/warehouses/${w.id}`, body); else await api('POST', '/api/v1/stock/warehouses', body);
    await qc.invalidateQueries({ queryKey: ['stock'] });
  }, { success: 'Depo kaydedildi.' });
  return (
    <Modal title={w ? `Depo · ${w.code}` : 'Yeni depo'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!f.code.trim() || !f.name.trim() || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button></>}>
      <div className="form-grid">
        <Field label="Kod" required><input className="input" value={f.code} onChange={e => setF(s => ({ ...s, code: e.target.value }))} autoFocus /></Field>
        <Field label="Ad" required className="span-3"><input className="input" value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} /></Field>
        <div className="span-4"><label className="check"><input type="checkbox" checked={f.isActive} onChange={e => setF(s => ({ ...s, isActive: e.target.checked }))} /> Aktif</label></div>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function SupplierModal({ s, onClose }: { s?: Supplier; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: s?.name ?? '', taxOffice: s?.taxOffice ?? '', taxNumber: s?.taxNumber ?? '', contactName: s?.contactName ?? '', phone: s?.phone ?? '',
    email: s?.email ?? '', address: s?.address ?? '', notes: s?.notes ?? '', isActive: s?.isActive ?? true });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
  const save = useAction(async () => {
    const body = Object.fromEntries(Object.entries({ ...f, version: s?.version }).map(([k, v]) => [k, v === '' ? null : v]));
    if (s) await api('PUT', `/api/v1/stock/suppliers/${s.id}`, body); else await api('POST', '/api/v1/stock/suppliers', body);
    await qc.invalidateQueries({ queryKey: ['stock'] });
  }, { success: 'Tedarikçi kaydedildi.' });
  return (
    <Modal title={s ? s.name : 'Yeni tedarikçi'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!f.name.trim() || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button></>}>
      <div className="form-grid">
        <Field label="Unvan" required className="span-4"><input className="input" value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Vergi dairesi" className="span-2"><input className="input" value={f.taxOffice} onChange={set('taxOffice')} /></Field>
        <Field label="Vergi / T.C. no" className="span-2"><input className="input mono" value={f.taxNumber} onChange={set('taxNumber')} /></Field>
        <Field label="Yetkili" className="span-2"><input className="input" value={f.contactName} onChange={set('contactName')} /></Field>
        <Field label="Telefon"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="E-posta"><input className="input" value={f.email} onChange={set('email')} /></Field>
        <Field label="Adres" className="span-4"><input className="input" value={f.address} onChange={set('address')} /></Field>
        <Field label="Not" className="span-4"><textarea className="input" rows={2} value={f.notes} onChange={set('notes')} /></Field>
        <div className="span-4"><label className="check"><input type="checkbox" checked={f.isActive} onChange={set('isActive')} /> Aktif</label></div>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}
