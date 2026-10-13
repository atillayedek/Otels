import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PackagePlus, Plus, Send, Trash2, XCircle } from 'lucide-react';
import { get, post, put, qs } from '../lib/api';
import type { PurchaseOrder, PurchaseOrderLine } from '../lib/types';
import { fmtDate, fmtMoney, fmtQty, parseDecimal } from '../lib/format';
import { useStockItems, useSuppliers, useWarehouses } from '../lib/queries';
import { useSession } from '../lib/session';
import { PageHead, useAction } from '../components/common';
import { ItemDatalist, ItemPicker, StockDocumentModal } from '../components/StockDocument';
import { Badge, DataTable, Empty, ErrorBox, Field, Modal, Spinner, type Column } from '../components/ui';

const STATUS: Record<PurchaseOrder['status'], [string, string]> = {
  draft: ['Taslak', 'gray'], ordered: ['Sipariş verildi', 'blue'], partially_received: ['Kısmen teslim', 'orange'], received: ['Teslim alındı', 'green'], cancelled: ['İptal', 'red'],
};
type Detail = { order: PurchaseOrder; lines: PurchaseOrderLine[] };

export default function PurchaseOrdersPage() {
  const { can } = useSession();
  const [status, setStatus] = useState('open');
  const [edit, setEdit] = useState<Detail | 'new' | null>(null);
  const [view, setView] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['stock', 'orders', status], queryFn: () => get<PurchaseOrder[]>(`/api/v1/purchase-orders${qs({ status: status || null })}`) });
  const cols: Column<PurchaseOrder>[] = [
    { key: 'orderNo', header: 'Sipariş', width: 100, render: o => <span className="mono">{o.orderNo}</span> },
    { key: 'orderDate', header: 'Tarih', width: 100, render: o => fmtDate(o.orderDate) },
    { key: 'supplierName', header: 'Tedarikçi', filter: true },
    { key: 'warehouseName', header: 'Depo', width: 140 },
    { key: 'expectedDate', header: 'Beklenen', width: 100, render: o => fmtDate(o.expectedDate) },
    { key: 'status', header: 'Durum', width: 140, value: o => STATUS[o.status][0], render: o => <Badge color={STATUS[o.status][1]}>{STATUS[o.status][0]}</Badge> },
    { key: 'total', header: 'Tutar (KDV dahil)', align: 'right', width: 140, value: o => Number(o.total), render: o => fmtMoney(o.total) },
    { key: 'username', header: 'Oluşturan', width: 110 },
  ];
  return (
    <div className="page">
      <PageHead title="Satın Alma Siparişleri" actions={can('purchase.manage') && <button className="btn primary" onClick={() => setEdit('new')}><Plus /> Yeni sipariş</button>} />
      <div className="toolbar">
        <select className="input" style={{ width: 200 }} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="open">Teslim bekleyenler</option><option value="draft">Taslaklar</option><option value="received">Teslim alınanlar</option><option value="cancelled">İptal edilenler</option><option value="">Tümü</option>
        </select>
        <span className="count">{list.data?.length ?? 0} sipariş</span>
      </div>
      {list.error ? <ErrorBox error={list.error} /> : (
        <DataTable rows={list.data ?? []} columns={cols} rowKey={o => o.id} onRowClick={o => setView(o.id)} maxHeight="calc(100vh - 250px)"
          empty={<Empty title={list.isLoading ? 'Yükleniyor…' : 'Bu listede sipariş yok'} />} />
      )}
      {view && <OrderViewModal id={view} onClose={() => setView(null)} onEdit={d => { setView(null); setEdit(d); }} />}
      {edit && <OrderEditModal detail={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function OrderViewModal({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (d: Detail) => void }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const d = useQuery({ queryKey: ['stock', 'order', id], queryFn: () => get<Detail>(`/api/v1/purchase-orders/${id}`) });
  const [receive, setReceive] = useState(false);
  const [reason, setReason] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['stock'] });
  const send = useAction(async (key: string) => { await post(`/api/v1/purchase-orders/${id}/send`, { version: d.data!.order.version }, key); await refresh(); }, { success: 'Sipariş gönderildi olarak işaretlendi.' });
  const cancel = useAction(async (key: string) => { await post(`/api/v1/purchase-orders/${id}/cancel`, { version: d.data!.order.version, reason }, key); await refresh(); }, { success: 'Sipariş iptal edildi.' });
  const o = d.data?.order;
  return (
    <Modal title={o ? `Sipariş ${o.orderNo}` : 'Sipariş'} size="xl" onClose={onClose} footer={<>
      {o?.status === 'draft' && can('purchase.manage') && <button className="btn" onClick={() => onEdit(d.data!)}>Düzenle</button>}
      {o?.status === 'draft' && can('purchase.manage') && <button className="btn primary" disabled={send.busy} onClick={() => void send.run()}><Send /> Sipariş verildi</button>}
      {(o?.status === 'ordered' || o?.status === 'partially_received') && can('stock.receive') && <button className="btn primary" onClick={() => setReceive(true)}><PackagePlus /> Mal kabul</button>}
      <span className="spacer" /><button className="btn" onClick={onClose}>Kapat</button>
    </>}>
      {d.isLoading || !o ? <Spinner /> : (
        <div className="stack">
          <div className="muted">{o.supplierName} · {o.warehouseName} · {fmtDate(o.orderDate)}{o.expectedDate && ` · beklenen ${fmtDate(o.expectedDate)}`} · <Badge color={STATUS[o.status][1]}>{STATUS[o.status][0]}</Badge></div>
          {o.notes && <div>{o.notes}</div>}
          {o.cancelReason && <div className="warn-box">İptal gerekçesi: {o.cancelReason}</div>}
          <table className="dt"><thead><tr><th>#</th><th>Stok</th><th style={{ textAlign: 'right' }}>Sipariş</th><th style={{ textAlign: 'right' }}>Teslim alınan</th><th style={{ textAlign: 'right' }}>Birim fiyat</th><th style={{ textAlign: 'right' }}>KDV %</th><th style={{ textAlign: 'right' }}>Tutar</th></tr></thead>
            <tbody>{d.data!.lines.map(l => <tr key={l.id}><td>{l.lineNo}</td><td>{l.itemCode} · {l.itemName}</td><td className="num">{fmtQty(l.quantity)} {l.unit}</td>
              <td className="num">{fmtQty(l.receivedQty)}</td><td className="num">{fmtMoney(l.unitCost)}</td><td className="num">{l.vatRate}</td><td className="num">{fmtMoney(l.amount)}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={6} className="num">Toplam (KDV dahil)</td><td className="num"><b>{fmtMoney(o.total)}</b></td></tr></tfoot></table>
          {o.status !== 'received' && o.status !== 'cancelled' && can('purchase.manage') && (
            <div className="row">
              <input className="input" style={{ flex: 1 }} placeholder="İptal gerekçesi" value={reason} onChange={e => setReason(e.target.value)} />
              <button className="btn danger" disabled={!reason.trim() || cancel.busy} onClick={async () => { if (await cancel.run() !== undefined) onClose(); }}><XCircle /> Siparişi iptal et</button>
            </div>
          )}
          <ErrorBox error={send.error ?? cancel.error} />
        </div>
      )}
      {receive && d.data && <StockDocumentModal kind="receipt" order={d.data} onClose={() => { setReceive(false); void d.refetch(); }} />}
    </Modal>
  );
}

interface Line { itemId: string; qty: string; cost: string; vat: string }

function OrderEditModal({ detail, onClose }: { detail?: Detail; onClose: () => void }) {
  const qc = useQueryClient();
  const wh = useWarehouses();
  const sup = useSuppliers();
  const items = useStockItems();
  const [f, setF] = useState({ supplierId: detail?.order.supplierId ?? '', warehouseId: detail?.order.warehouseId ?? '', expectedDate: detail?.order.expectedDate ?? '', notes: detail?.order.notes ?? '' });
  const [lines, setLines] = useState<Line[]>(detail ? detail.lines.map(l => ({ itemId: l.itemId, qty: fmtQty(l.quantity), cost: String(Number(l.unitCost)).replace('.', ','), vat: l.vatRate }))
    : [{ itemId: '', qty: '', cost: '', vat: '' }]);
  const setLine = (i: number, p: Partial<Line>) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const parsed = lines.filter(l => l.itemId).map(l => ({ itemId: l.itemId, quantity: parseDecimal(l.qty, 3), unitCost: parseDecimal(l.cost, 4), vatRate: parseDecimal(l.vat || '0', 2) }));
  const valid = !!f.supplierId && !!f.warehouseId && parsed.length > 0 && parsed.every(l => l.quantity && Number(l.quantity) > 0 && l.unitCost !== null && l.vatRate !== null && Number(l.vatRate) <= 100)
    && new Set(parsed.map(l => l.itemId)).size === parsed.length;
  const total = parsed.reduce((s, l) => s + Number(l.quantity ?? 0) * Number(l.unitCost ?? 0) * (1 + Number(l.vatRate ?? 0) / 100), 0);
  const save = useAction(async (key: string) => {
    const body = { supplierId: f.supplierId, warehouseId: f.warehouseId, expectedDate: f.expectedDate || null, notes: f.notes.trim() || null, lines: parsed, version: detail?.order.version };
    if (detail) await put(`/api/v1/purchase-orders/${detail.order.id}`, body, key); else await post('/api/v1/purchase-orders', body, key);
    await qc.invalidateQueries({ queryKey: ['stock'] });
  }, { success: 'Sipariş kaydedildi (taslak).' });
  return (
    <Modal title={detail ? `Sipariş ${detail.order.orderNo} · düzenle` : 'Yeni satın alma siparişi'} size="xl" onClose={onClose} footer={<>
      <span className="muted">Toplam (KDV dahil): <b>{fmtMoney(total.toFixed(2))}</b></span><span className="spacer" />
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!valid || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button>
    </>}>
      <div className="stack">
        <div className="form-grid">
          <Field label="Tedarikçi" required className="span-2"><select className="input" value={f.supplierId} onChange={e => setF(s => ({ ...s, supplierId: e.target.value }))}><option value="">Seçin</option>{sup.data?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Teslim deposu" required><select className="input" value={f.warehouseId} onChange={e => setF(s => ({ ...s, warehouseId: e.target.value }))}><option value="">Seçin</option>{wh.data?.filter(w => w.isActive).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
          <Field label="Beklenen teslim"><input type="date" className="input" value={f.expectedDate} onChange={e => setF(s => ({ ...s, expectedDate: e.target.value }))} /></Field>
          <Field label="Not" className="span-4"><input className="input" value={f.notes} onChange={e => setF(s => ({ ...s, notes: e.target.value }))} /></Field>
        </div>
        {(sup.data ?? []).length === 0 && <div className="warn-box">Tedarikçi tanımlı değil. Stok → Depolar ve tedarikçiler sekmesinden ekleyin.</div>}
        <div className="table-wrap" style={{ maxHeight: 360 }}>
          <table className="dt"><thead><tr><th>Stok kartı</th><th style={{ width: 120 }}>Miktar</th><th style={{ width: 130 }}>Birim fiyat</th><th style={{ width: 80 }}>KDV %</th><th style={{ textAlign: 'right', width: 120 }}>Tutar</th><th style={{ width: 40 }} /></tr></thead>
            <tbody>{lines.map((l, i) => {
              const it = items.data?.find(x => x.id === l.itemId);
              const q = parseDecimal(l.qty, 3), c = parseDecimal(l.cost, 4), v = parseDecimal(l.vat || '0', 2);
              return (
                <tr key={i}>
                  <td><ItemPicker key={l.itemId || `n${i}`} items={items.data ?? []} value={l.itemId} onChange={id => { const x = items.data?.find(y => y.id === id); setLine(i, { itemId: id, vat: l.vat || x?.vatRate || '' }); }} /></td>
                  <td><input className="input num" value={l.qty} placeholder={it?.unit} onChange={e => setLine(i, { qty: e.target.value })} inputMode="decimal" /></td>
                  <td><input className="input num" value={l.cost} onChange={e => setLine(i, { cost: e.target.value })} inputMode="decimal" /></td>
                  <td><input className="input num" value={l.vat} onChange={e => setLine(i, { vat: e.target.value })} inputMode="decimal" /></td>
                  <td className="num">{q && c && v !== null ? fmtMoney((Number(q) * Number(c) * (1 + Number(v) / 100)).toFixed(2)) : ''}</td>
                  <td><button className="btn sm ghost icon" title="Satırı sil" onClick={() => setLines(ls => ls.length === 1 ? [{ itemId: '', qty: '', cost: '', vat: '' }] : ls.filter((_, j) => j !== i))}><Trash2 /></button></td>
                </tr>
              );
            })}</tbody></table>
        </div>
        <div><button className="btn sm" onClick={() => setLines(ls => [...ls, { itemId: '', qty: '', cost: '', vat: '' }])}><Plus /> Satır ekle</button></div>
        <ItemDatalist items={items.data ?? []} />
        <ErrorBox error={save.error} />
      </div>
    </Modal>
  );
}
