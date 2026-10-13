import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { get, post, qs } from '../lib/api';
import type { PurchaseOrder, PurchaseOrderLine, StockBalance, StockItem } from '../lib/types';
import { fmtMoney, fmtQty, parseDecimal } from '../lib/format';
import { useStockItems, useSuppliers, useWarehouses } from '../lib/queries';
import { useSession } from '../lib/session';
import { useAction } from './common';
import { Empty, ErrorBox, Field, Modal, Spinner } from './ui';

export const DOC_KIND: Record<string, string> = { receipt: 'Mal kabul', issue: 'Çıkış', transfer: 'Transfer', count: 'Sayım', pos: 'Satış tüketimi' };
const DEPARTMENTS = ['Kat hizmetleri', 'Mutfak', 'Restoran', 'Bar', 'Teknik servis', 'Ön büro', 'İdari'];
export type DocKind = 'receipt' | 'issue' | 'transfer' | 'count';


interface DocLine { itemId: string; qty: string; cost: string; polId?: string }

const itemLabel = (i: StockItem) => `${i.code} · ${i.name} (${i.unit})`;

/** ItemPicker'ların ortak öneri listesi; bir pencerede bir kez yerleştirilir. */
export function ItemDatalist({ items }: { items: StockItem[] }) {
  return <datalist id="stock-item-list">{items.map(i => <option key={i.id} value={itemLabel(i)} />)}</datalist>;
}

/** Kod veya adla aranabilen stok kartı seçici (öneriler için pencerede ItemDatalist bulunmalıdır). */
export function ItemPicker({ items, value, onChange, autoFocus }: { items: StockItem[]; value: string; onChange: (id: string) => void; autoFocus?: boolean }) {
  const cur = items.find(i => i.id === value);
  const [text, setText] = useState(cur ? itemLabel(cur) : '');
  return (
    <input className="input" list="stock-item-list" value={text} autoFocus={autoFocus} placeholder="Kod veya ad yazın"
      onChange={e => { setText(e.target.value); const m = items.find(i => itemLabel(i) === e.target.value); onChange(m?.id ?? ''); }} />
  );
}

export function StockDocumentModal({ kind, onClose, order }: { kind: DocKind; onClose: () => void; order?: { order: PurchaseOrder; lines: PurchaseOrderLine[] } }) {
  const qc = useQueryClient();
  const { property } = useSession();
  const wh = useWarehouses();
  const items = useStockItems();
  const sup = useSuppliers();
  const active = (wh.data ?? []).filter(w => w.isActive);
  const [f, setF] = useState({ warehouseId: order?.order.warehouseId ?? '', targetWarehouseId: '', supplierId: order?.order.supplierId ?? '', invoiceNo: '',
    invoiceDate: property?.businessDate ?? '', department: '', reference: '', notes: '' });
  const [lines, setLines] = useState<DocLine[]>(() => order
    ? order.lines.filter(l => Number(l.quantity) > Number(l.receivedQty)).map(l => ({ itemId: l.itemId, qty: fmtQty(Number(l.quantity) - Number(l.receivedQty)), cost: String(Number(l.unitCost)).replace('.', ','), polId: l.id }))
    : [{ itemId: '', qty: '', cost: '' }]);
  const balances = useQuery({ queryKey: ['stock', 'balances', f.warehouseId, false], enabled: !!f.warehouseId && kind !== 'receipt',
    queryFn: () => get<StockBalance[]>(`/api/v1/stock/balances${qs({ warehouseId: f.warehouseId })}`) });
  const current = (itemId: string) => balances.data?.find(b => b.itemId === itemId)?.quantity;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(s => ({ ...s, [k]: e.target.value }));
  const setLine = (i: number, patch: Partial<DocLine>) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const itemOf = (id: string) => items.data?.find(x => x.id === id);

  const parsed = lines.filter(l => l.itemId).map(l => ({ ...l, q: parseDecimal(l.qty, 3), c: kind === 'receipt' ? parseDecimal(l.cost, 4) : '0' }));
  const valid = parsed.length > 0 && parsed.every(l => l.q !== null && (kind === 'count' || Number(l.q) > 0) && l.c !== null)
    && new Set(parsed.map(l => l.itemId)).size === parsed.length && !!f.warehouseId
    && (kind !== 'receipt' || !!f.supplierId) && (kind !== 'issue' || !!f.department.trim()) && (kind !== 'transfer' || (!!f.targetWarehouseId && f.targetWarehouseId !== f.warehouseId));
  const total = kind === 'receipt' ? parsed.reduce((s, l) => s + Number(l.q ?? 0) * Number(l.c ?? 0), 0) : 0;

  const save = useAction(async (key: string) => {
    const nn = (v: string) => (v.trim() ? v.trim() : null);
    switch (kind) {
      case 'receipt': await post('/api/v1/stock/receipts', { warehouseId: f.warehouseId, supplierId: f.supplierId, purchaseOrderId: order?.order.id ?? null, invoiceNo: nn(f.invoiceNo),
        invoiceDate: f.invoiceNo.trim() ? f.invoiceDate || null : null, reference: nn(f.reference), notes: nn(f.notes),
        lines: parsed.map(l => ({ itemId: l.itemId, quantity: l.q, unitCost: l.c, purchaseOrderLineId: l.polId ?? null })) }, key); break;
      case 'issue': await post('/api/v1/stock/issues', { warehouseId: f.warehouseId, department: f.department.trim(), reference: nn(f.reference), notes: nn(f.notes),
        lines: parsed.map(l => ({ itemId: l.itemId, quantity: l.q })) }, key); break;
      case 'transfer': await post('/api/v1/stock/transfers', { warehouseId: f.warehouseId, targetWarehouseId: f.targetWarehouseId, notes: nn(f.notes),
        lines: parsed.map(l => ({ itemId: l.itemId, quantity: l.q })) }, key); break;
      case 'count': await post('/api/v1/stock/counts', { warehouseId: f.warehouseId, notes: nn(f.notes), lines: parsed.map(l => ({ itemId: l.itemId, countedQuantity: l.q })) }, key); break;
    }
    await qc.invalidateQueries({ queryKey: ['stock'] });
  }, { success: `${DOC_KIND[kind]} kaydedildi.` });

  const fillCount = () => setLines((balances.data ?? []).map(b => ({ itemId: b.itemId, qty: '', cost: '' })));
  const titles: Record<DocKind, string> = { receipt: order ? `Mal kabul · ${order.order.orderNo}` : 'Mal kabul', issue: 'Stok çıkışı', transfer: 'Depolar arası transfer', count: 'Stok sayımı' };

  return (
    <Modal title={titles[kind]} size="xl" onClose={onClose} footer={<>
      {kind === 'receipt' && <span className="muted">Toplam (KDV hariç): <b>{fmtMoney(total.toFixed(2))}</b></span>}<span className="spacer" />
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!valid || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>{save.busy ? 'Kaydediliyor…' : 'Kaydet'}</button>
    </>}>
      {items.isLoading || wh.isLoading ? <Spinner /> : active.length === 0 ? <Empty title="Depo tanımlı değil" text="Önce Depolar ve tedarikçiler sekmesinden depo tanımlayın." /> : (
        <div className="stack">
          <div className="form-grid">
            <Field label={kind === 'transfer' ? 'Kaynak depo' : 'Depo'} required className="span-2">
              <select className="input" value={f.warehouseId} onChange={set('warehouseId')} disabled={!!order}><option value="">Seçin</option>{active.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
            </Field>
            {kind === 'transfer' && <Field label="Hedef depo" required className="span-2"><select className="input" value={f.targetWarehouseId} onChange={set('targetWarehouseId')}><option value="">Seçin</option>{active.filter(w => w.id !== f.warehouseId).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>}
            {kind === 'receipt' && <>
              <Field label="Tedarikçi" required className="span-2"><select className="input" value={f.supplierId} onChange={set('supplierId')} disabled={!!order}><option value="">Seçin</option>{sup.data?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              <Field label="Fatura / irsaliye no"><input className="input" value={f.invoiceNo} onChange={set('invoiceNo')} /></Field>
              <Field label="Fatura tarihi"><input type="date" className="input" value={f.invoiceDate} onChange={set('invoiceDate')} /></Field>
            </>}
            {kind === 'issue' && <Field label="Çıkış yapılan bölüm" required className="span-2"><input className="input" list="stock-departments" value={f.department} onChange={set('department')} />
              <datalist id="stock-departments">{DEPARTMENTS.map(d => <option key={d} value={d} />)}</datalist></Field>}
            {(kind === 'receipt' || kind === 'issue') && <Field label="Referans"><input className="input" value={f.reference} onChange={set('reference')} /></Field>}
            <Field label="Not" className={kind === 'count' ? 'span-2' : 'span-3'}><input className="input" value={f.notes} onChange={set('notes')} /></Field>
          </div>
          {kind === 'count' && <div className="info-box row">Sayılan miktarları girin; yalnız farklı olanlar düzeltme olarak kaydedilir. {f.warehouseId && <button className="btn sm" onClick={fillCount}>Depodaki tüm kartları listele</button>}</div>}
          {(items.data ?? []).length === 0 ? <Empty title="Stok kartı yok" text="Önce Stok kartları sekmesinden kart tanımlayın." /> : (
            <div className="table-wrap" style={{ maxHeight: 380 }}>
              <table className="dt">
                <thead><tr><th>Stok kartı</th>{kind !== 'receipt' && <th style={{ textAlign: 'right', width: 130 }}>Mevcut</th>}<th style={{ width: 130 }}>{kind === 'count' ? 'Sayılan' : 'Miktar'}</th>
                  {kind === 'receipt' && <><th style={{ width: 130 }}>Birim maliyet</th><th style={{ textAlign: 'right', width: 120 }}>Tutar</th></>}<th style={{ width: 40 }} /></tr></thead>
                <tbody>{lines.map((l, i) => {
                  const it = itemOf(l.itemId);
                  const q = parseDecimal(l.qty, 3);
                  const c = parseDecimal(l.cost, 4);
                  return (
                    <tr key={i}>
                      <td><ItemPicker key={l.itemId || `new-${i}`} items={items.data!} value={l.itemId} onChange={id => setLine(i, { itemId: id })} autoFocus={i === lines.length - 1 && !l.itemId && i > 0} /></td>
                      {kind !== 'receipt' && <td className="num">{l.itemId ? `${fmtQty(current(l.itemId) ?? '0')} ${it?.unit ?? ''}` : ''}</td>}
                      <td><input className={`input num ${l.qty && !q ? 'invalid' : ''}`} value={l.qty} onChange={e => setLine(i, { qty: e.target.value })} inputMode="decimal" placeholder={it?.unit} /></td>
                      {kind === 'receipt' && <><td><input className={`input num ${l.cost && !c ? 'invalid' : ''}`} value={l.cost} onChange={e => setLine(i, { cost: e.target.value })} inputMode="decimal" /></td>
                        <td className="num">{q && c ? fmtMoney((Number(q) * Number(c)).toFixed(2)) : ''}</td></>}
                      <td><button className="btn sm ghost icon" title="Satırı sil" onClick={() => setLines(ls => ls.length === 1 ? [{ itemId: '', qty: '', cost: '' }] : ls.filter((_, j) => j !== i))}><Trash2 /></button></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
          {!order && <div><button className="btn sm" onClick={() => setLines(ls => [...ls, { itemId: '', qty: '', cost: '' }])}><Plus /> Satır ekle</button></div>}
          <ItemDatalist items={items.data ?? []} />
          {new Set(parsed.map(l => l.itemId)).size !== parsed.length && <div className="error-box">Aynı stok kartı birden fazla satırda; satırları birleştirin.</div>}
          <ErrorBox error={save.error} />
        </div>
      )}
    </Modal>
  );
}
