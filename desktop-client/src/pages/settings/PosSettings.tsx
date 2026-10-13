import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api, get, qs } from '../../lib/api';
import type { Outlet, PosProduct, RecipeLine } from '../../lib/types';
import { fmtMoney, fmtQty, parseDecimal } from '../../lib/format';
import { useStockItems, useTransactionCodes, useWarehouses } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { PageHead, useAction } from '../../components/common';
import { ItemDatalist, ItemPicker } from '../../components/StockDocument';
import { Badge, DataTable, Empty, ErrorBox, Field, Modal, MoneyInput, Spinner, type Column } from '../../components/ui';

/** Restoran menüsü, satış noktaları ve reçeteler. */
export default function PosSettingsPage() {
  const outlets = useQuery({ queryKey: ['pos', 'outlets'], queryFn: () => get<Outlet[]>('/api/v1/pos/outlets') });
  const [inactive, setInactive] = useState(false);
  const products = useQuery({ queryKey: ['pos', 'products', 'all', inactive], queryFn: () => get<PosProduct[]>(`/api/v1/pos/products${qs({ includeInactive: inactive || null })}`) });
  const [outlet, setOutlet] = useState<Outlet | 'new' | null>(null);
  const [product, setProduct] = useState<PosProduct | 'new' | null>(null);
  const [recipe, setRecipe] = useState<PosProduct | null>(null);
  const outletName = (id: string) => outlets.data?.find(o => o.id === id)?.name ?? '';
  const pcols: Column<PosProduct>[] = [
    { key: 'code', header: 'Kod', width: 110, render: p => <span className="mono">{p.code}</span> },
    { key: 'name', header: 'Ürün', filter: true, render: p => <>{p.name}{!p.isActive && <Badge color="gray">Pasif</Badge>}</> },
    { key: 'category', header: 'Kategori', width: 140, filter: true },
    { key: 'price', header: 'Fiyat', align: 'right', width: 100, value: p => Number(p.price), render: p => fmtMoney(p.price) },
    { key: 'vatRate', header: 'KDV %', align: 'right', width: 70 },
    { key: 'outlets', header: 'Satış noktaları', width: 180, value: p => (p.outletIds.length ? p.outletIds.map(outletName).join(', ') : 'Tümü') },
    { key: 'recipeItems', header: 'Reçete', width: 110, render: p => <button className="btn sm ghost" onClick={e => { e.stopPropagation(); setRecipe(p); }}>{p.recipeItems ? `${p.recipeItems} malzeme` : 'Tanımla'}</button> },
  ];
  return (
    <div className="page">
      <PageHead title="Menü ve Satış Noktaları" sub="Restoran / bar ürünleri, fiyatları, reçeteleri ve satış noktaları" />
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><h3>Satış noktaları</h3><div className="right"><button className="btn sm primary" onClick={() => setOutlet('new')}><Plus /> Ekle</button></div></div>
        <div className="card-body tight">
          <DataTable rows={outlets.data ?? []} rowKey={o => o.id} onRowClick={setOutlet} columns={[
            { key: 'code', header: 'Kod', width: 90 }, { key: 'name', header: 'Ad', render: (o: Outlet) => <>{o.name}{!o.isActive && <Badge color="gray">Pasif</Badge>}</> },
            { key: 'transactionCode', header: 'Folyo işlem kodu', width: 150 }, { key: 'warehouseName', header: 'Stok düşülen depo', width: 170, value: (o: Outlet) => o.warehouseName ?? 'Stok düşülmez' },
            { key: 'openChecks', header: 'Açık adisyon', align: 'right', width: 110 },
          ]} empty={<Empty title="Satış noktası yok" text="Restoran, bar, oda servisi gibi her satış noktası için kayıt açın." />} />
        </div>
      </div>
      <div className="toolbar">
        <h3 style={{ margin: 0 }}>Menü</h3>
        <button className="btn primary" onClick={() => setProduct('new')}><Plus /> Yeni ürün</button>
        <label className="check"><input type="checkbox" checked={inactive} onChange={e => setInactive(e.target.checked)} /> Pasifleri de göster</label>
        <span className="count">{products.data?.length ?? 0} ürün</span>
      </div>
      {products.error ? <ErrorBox error={products.error} /> : (
        <DataTable rows={products.data ?? []} columns={pcols} rowKey={p => p.id} onRowClick={setProduct} maxHeight="calc(100vh - 420px)"
          empty={<Empty title={products.isLoading ? 'Yükleniyor…' : 'Menüde ürün yok'} />} />
      )}
      {outlet && <OutletModal o={outlet === 'new' ? undefined : outlet} onClose={() => setOutlet(null)} />}
      {product && <ProductModal p={product === 'new' ? undefined : product} outlets={outlets.data ?? []} onClose={() => setProduct(null)} />}
      {recipe && <RecipeModal p={recipe} onClose={() => setRecipe(null)} />}
    </div>
  );
}

function OutletModal({ o, onClose }: { o?: Outlet; onClose: () => void }) {
  const qc = useQueryClient();
  const codes = useTransactionCodes();
  const wh = useWarehouses();
  const { can } = useSession();
  const [f, setF] = useState({ code: o?.code ?? '', name: o?.name ?? '', transactionCodeId: o?.transactionCodeId ?? '', warehouseId: o?.warehouseId ?? '', sortOrder: String(o?.sortOrder ?? 0), isActive: o?.isActive ?? true });
  const save = useAction(async () => {
    const body = { code: f.code.trim().toUpperCase(), name: f.name, transactionCodeId: f.transactionCodeId, warehouseId: f.warehouseId || null, sortOrder: Number(f.sortOrder) || 0, isActive: f.isActive, version: o?.version };
    if (o) await api('PUT', `/api/v1/pos/outlets/${o.id}`, body); else await api('POST', '/api/v1/pos/outlets', body);
    await qc.invalidateQueries({ queryKey: ['pos'] });
  }, { success: 'Satış noktası kaydedildi.' });
  const usable = (codes.data ?? []).filter(c => c.isActive && c.category !== 'room' && c.category !== 'tax');
  return (
    <Modal title={o ? `Satış noktası · ${o.code}` : 'Yeni satış noktası'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!f.code.trim() || !f.name.trim() || !f.transactionCodeId || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button></>}>
      <div className="form-grid">
        <Field label="Kod" required><input className="input" value={f.code} onChange={e => setF(s => ({ ...s, code: e.target.value }))} autoFocus /></Field>
        <Field label="Ad" required className="span-3"><input className="input" value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} /></Field>
        <Field label="Folyo işlem kodu" required className="span-2" hint="Odaya aktarılan adisyon bu kodla folyoya yazılır">
          <select className="input" value={f.transactionCodeId} onChange={e => setF(s => ({ ...s, transactionCodeId: e.target.value }))}><option value="">Seçin</option>{usable.map(c => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
        </Field>
        <Field label="Stok düşülen depo" className="span-2" hint="Reçeteli ürünler bu depodan düşülür">
          <select className="input" value={f.warehouseId} onChange={e => setF(s => ({ ...s, warehouseId: e.target.value }))} disabled={!can('stock.view') && !can('pos.manage')}><option value="">Stok düşülmez</option>{wh.data?.filter(w => w.isActive).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        </Field>
        <Field label="Sıra"><input className="input num" value={f.sortOrder} onChange={e => setF(s => ({ ...s, sortOrder: e.target.value.replace(/[^\d-]/g, '') }))} /></Field>
        <div className="span-3" style={{ alignSelf: 'end' }}><label className="check"><input type="checkbox" checked={f.isActive} onChange={e => setF(s => ({ ...s, isActive: e.target.checked }))} /> Aktif</label></div>
      </div>
      {usable.length === 0 && <div className="warn-box">Uygun işlem kodu yok. Ön Kasa → İşlem Kodları ekranından "Yiyecek-içecek" kategorisinde kod ekleyin.</div>}
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function ProductModal({ p, outlets, onClose }: { p?: PosProduct; outlets: Outlet[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: p?.code ?? '', name: p?.name ?? '', category: p?.category ?? '', price: p?.price ?? '', vatRate: p?.vatRate ?? '10', sortOrder: String(p?.sortOrder ?? 0), isActive: p?.isActive ?? true });
  const [sel, setSel] = useState<string[]>(p?.outletIds ?? []);
  const save = useAction(async () => {
    const body = { code: f.code.trim().toUpperCase(), name: f.name, category: f.category, price: f.price || '0', vatRate: f.vatRate.replace(',', '.'), sortOrder: Number(f.sortOrder) || 0, isActive: f.isActive, outletIds: sel, version: p?.version };
    if (p) await api('PUT', `/api/v1/pos/products/${p.id}`, body); else await api('POST', '/api/v1/pos/products', body);
    await qc.invalidateQueries({ queryKey: ['pos'] });
  }, { success: 'Ürün kaydedildi.' });
  return (
    <Modal title={p ? `Ürün · ${p.name}` : 'Yeni ürün'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!f.code.trim() || !f.name.trim() || !f.category.trim() || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button></>}>
      <div className="form-grid">
        <Field label="Kod" required><input className="input" value={f.code} onChange={e => setF(s => ({ ...s, code: e.target.value }))} autoFocus /></Field>
        <Field label="Ürün adı" required className="span-3"><input className="input" value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} /></Field>
        <Field label="Kategori" required className="span-2" hint="Satış ekranında grup düğmesi olur"><input className="input" value={f.category} onChange={e => setF(s => ({ ...s, category: e.target.value }))} /></Field>
        <Field label="Fiyat (KDV dahil)"><MoneyInput value={f.price} onChange={v => setF(s => ({ ...s, price: v }))} /></Field>
        <Field label="KDV %"><input className="input num" value={f.vatRate} onChange={e => setF(s => ({ ...s, vatRate: e.target.value }))} /></Field>
        <Field label="Sıra"><input className="input num" value={f.sortOrder} onChange={e => setF(s => ({ ...s, sortOrder: e.target.value.replace(/[^\d-]/g, '') }))} /></Field>
        <div className="span-3" style={{ alignSelf: 'end' }}><label className="check"><input type="checkbox" checked={f.isActive} onChange={e => setF(s => ({ ...s, isActive: e.target.checked }))} /> Satışta</label></div>
        <Field label="Satıldığı yerler" className="span-4" hint="Hiçbiri seçilmezse tüm satış noktalarında satılır">
          <div className="row wrap">{outlets.map(o => <label key={o.id} className="check"><input type="checkbox" checked={sel.includes(o.id)} onChange={e => setSel(s => e.target.checked ? [...s, o.id] : s.filter(x => x !== o.id))} /> {o.name}</label>)}</div>
        </Field>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function RecipeModal({ p, onClose }: { p: PosProduct; onClose: () => void }) {
  const qc = useQueryClient();
  const items = useStockItems();
  const r = useQuery({ queryKey: ['pos', 'recipe', p.id], queryFn: () => get<RecipeLine[]>(`/api/v1/pos/products/${p.id}/recipe`) });
  const [lines, setLines] = useState<{ itemId: string; qty: string }[] | null>(null);
  const rows = lines ?? (r.data ? r.data.map(x => ({ itemId: x.stockItemId, qty: fmtQty(x.quantity) })) : null);
  const setRow = (i: number, patch: Partial<{ itemId: string; qty: string }>) => setLines((rows ?? []).map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const parsed = (rows ?? []).filter(l => l.itemId).map(l => ({ stockItemId: l.itemId, quantity: parseDecimal(l.qty, 3) }));
  const valid = parsed.every(l => l.quantity && Number(l.quantity) > 0) && new Set(parsed.map(l => l.stockItemId)).size === parsed.length;
  const save = useAction(async () => { await api('PUT', `/api/v1/pos/products/${p.id}/recipe`, { lines: parsed }); await qc.invalidateQueries({ queryKey: ['pos'] }); }, { success: 'Reçete kaydedildi.' });
  return (
    <Modal title={`Reçete · ${p.name}`} size="lg" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!rows || !valid || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button></>}>
      {!rows || items.isLoading ? <Spinner /> : (
        <div className="stack">
          <div className="muted" style={{ fontSize: 12 }}>1 adet/porsiyon satışta satış noktasının deposundan düşülecek malzemeler. Reçetesiz ürün satışı stoğu etkilemez.</div>
          {(items.data ?? []).length === 0 ? <Empty title="Stok kartı yok" text="Reçete için önce Stok ekranından stok kartı tanımlayın." /> : <>
            {rows.length === 0 && <Empty title="Reçete boş" />}
            {rows.map((l, i) => (
              <div key={i} className="row">
                <div style={{ flex: 1 }}><ItemPicker key={l.itemId || `n${i}`} items={items.data!} value={l.itemId} onChange={id => setRow(i, { itemId: id })} /></div>
                <input className="input num" style={{ width: 110 }} value={l.qty} onChange={e => setRow(i, { qty: e.target.value })} placeholder={items.data!.find(x => x.id === l.itemId)?.unit ?? 'miktar'} />
                <button className="btn sm ghost icon" title="Kaldır" onClick={() => setLines(rows.filter((_, j) => j !== i))}><Trash2 /></button>
              </div>
            ))}
            <div><button className="btn sm" onClick={() => setLines([...rows, { itemId: '', qty: '' }])}><Plus /> Malzeme ekle</button></div>
            <ItemDatalist items={items.data!} />
          </>}
          <ErrorBox error={save.error} />
        </div>
      )}
    </Modal>
  );
}
