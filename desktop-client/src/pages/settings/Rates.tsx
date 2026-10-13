import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api, del, get } from '../../lib/api';
import type { RatePlan, RatePrice } from '../../lib/types';
import { fmtDate, fmtMoney, MEAL_LABEL } from '../../lib/format';
import { useRatePlans, useRoomTypes } from '../../lib/queries';
import { PageHead, useAction } from '../../components/common';
import { Badge, DataTable, Empty, ErrorBox, Field, Modal, MoneyInput, useConfirm, useToast, type Column } from '../../components/ui';

export default function RatesSettingsPage() {
  const plans = useRatePlans();
  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState<RatePlan | 'new' | null>(null);
  const plan = plans.data?.find(p => p.id === (sel ?? plans.data?.[0]?.id));
  const cols: Column<RatePlan>[] = [
    { key: 'code', header: 'Kod', width: 90 }, { key: 'name', header: 'Ad' }, { key: 'mealPlan', header: 'Pansiyon', width: 110 },
    { key: 'isActive', header: '', width: 70, render: p => p.isActive ? <Badge color="green">Aktif</Badge> : <Badge color="gray">Pasif</Badge> },
  ];
  return (
    <div className="page">
      <PageHead title="Fiyat Planları" sub="Plan seçilmezse rezervasyonda oda tipinin varsayılan fiyatı kullanılır" actions={<button className="btn primary" onClick={() => setEdit('new')}><Plus /> Fiyat planı</button>} />
      <div className="split wide">
        <div className="card"><div className="card-body tight">
          <DataTable rows={plans.data ?? []} columns={cols} rowKey={p => p.id} selectedKey={plan?.id} onRowClick={p => setSel(p.id)} empty={<Empty title="Henüz fiyat planı yok" />} />
          {plan && <div style={{ padding: 8 }}><button className="btn sm" onClick={() => setEdit(plan)}>Seçili planı düzenle</button></div>}
        </div></div>
        {plan ? <Prices plan={plan} /> : <div className="card"><Empty title="Fiyat girmek için bir plan seçin" /></div>}
      </div>
      {edit && <PlanModal p={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function Prices({ plan }: { plan: RatePlan }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const types = useRoomTypes();
  const prices = useQuery({ queryKey: ['ratePrices', plan.id], queryFn: () => get<RatePrice[]>(`/api/v1/rate-plans/${plan.id}/prices`) });
  const [f, setF] = useState({ roomTypeId: '', dateFrom: '', dateTo: '', price: '', minStay: '' });
  const add = useAction(async () => {
    await api('POST', `/api/v1/rate-plans/${plan.id}/prices`, { roomTypeId: f.roomTypeId, dateFrom: f.dateFrom, dateTo: f.dateTo, price: f.price, minStay: f.minStay ? Number(f.minStay) : null });
    await qc.invalidateQueries({ queryKey: ['ratePrices'] });
    setF(s => ({ ...s, price: '', minStay: '' }));
  }, { success: 'Fiyat eklendi.' });
  const remove = async (p: RatePrice) => {
    if (!await confirm({ title: 'Fiyat aralığını kaldır', message: `${p.roomTypeCode} · ${fmtDate(p.dateFrom)}–${fmtDate(p.dateTo)} · ${fmtMoney(p.price)} kaldırılacak. Mevcut rezervasyonların fiyatları değişmez.`, confirmText: 'Kaldır', danger: true })) return;
    try { await del(`/api/v1/rate-plans/${plan.id}/prices/${p.id}`); await qc.invalidateQueries({ queryKey: ['ratePrices'] }); } catch (e) { toast.error(e); }
  };
  return (
    <div className="card">
      <div className="card-head"><h3>{plan.code} · {plan.name} · {MEAL_LABEL[plan.mealPlan]}</h3></div>
      <div className="card-body stack">
        <div className="form-grid" style={{ gridTemplateColumns: '1.2fr 1fr 1fr 1fr 0.7fr auto', alignItems: 'end' }}>
          <Field label="Oda tipi"><select className="input" value={f.roomTypeId} onChange={e => setF(s => ({ ...s, roomTypeId: e.target.value }))}><option value="">Seçin</option>{types.data?.map(t => <option key={t.id} value={t.id}>{t.code}</option>)}</select></Field>
          <Field label="Başlangıç"><input type="date" className="input" value={f.dateFrom} onChange={e => setF(s => ({ ...s, dateFrom: e.target.value }))} /></Field>
          <Field label="Bitiş (dahil değil)"><input type="date" className="input" value={f.dateTo} onChange={e => setF(s => ({ ...s, dateTo: e.target.value }))} /></Field>
          <Field label="Gecelik fiyat"><MoneyInput value={f.price} onChange={v => setF(s => ({ ...s, price: v }))} /></Field>
          <Field label="Min. gece"><input className="input" value={f.minStay} onChange={e => setF(s => ({ ...s, minStay: e.target.value.replace(/\D/g, '') }))} /></Field>
          <button className="btn primary" disabled={!f.roomTypeId || !f.dateFrom || !f.dateTo || !f.price || add.busy} onClick={() => void add.run()}><Plus /> Ekle</button>
        </div>
        <ErrorBox error={add.error} />
        <table className="dt">
          <thead><tr><th>Oda tipi</th><th>Başlangıç</th><th>Bitiş</th><th style={{ textAlign: 'right' }}>Fiyat</th><th>Min. gece</th><th /></tr></thead>
          <tbody>{prices.data?.map(p => <tr key={p.id}><td>{p.roomTypeCode}</td><td>{fmtDate(p.dateFrom)}</td><td>{fmtDate(p.dateTo)}</td><td className="num">{fmtMoney(p.price)}</td><td>{p.minStay ?? ''}</td><td style={{ textAlign: 'right' }}><button className="btn sm ghost icon" title="Kaldır" onClick={() => void remove(p)}><Trash2 /></button></td></tr>)}</tbody>
        </table>
        {prices.data?.length === 0 && <Empty title="Bu planda tanımlı fiyat yok" />}
      </div>
    </div>
  );
}

function PlanModal({ p, onClose }: { p?: RatePlan; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: p?.code ?? '', name: p?.name ?? '', mealPlan: p?.mealPlan ?? 'BB', description: p?.description ?? '', isActive: p?.isActive ?? true });
  const save = useAction(async () => {
    const body = { ...f, code: f.code.trim().toUpperCase(), description: f.description || null, version: p?.version ?? null };
    if (p) await api('PUT', `/api/v1/rate-plans/${p.id}`, body); else await api('POST', '/api/v1/rate-plans', body);
    await qc.invalidateQueries({ queryKey: ['ratePlans'] });
  }, { success: 'Fiyat planı kaydedildi.' });
  return (
    <Modal title={p ? `Fiyat planı · ${p.code}` : 'Yeni fiyat planı'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={!f.code.trim() || !f.name.trim() || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button></>}>
      <div className="form-grid">
        <Field label="Kod" required><input className="input" value={f.code} onChange={e => setF(s => ({ ...s, code: e.target.value }))} maxLength={20} autoFocus /></Field>
        <Field label="Ad" required className="span-3"><input className="input" value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} /></Field>
        <Field label="Pansiyon" className="span-2"><select className="input" value={f.mealPlan} onChange={e => setF(s => ({ ...s, mealPlan: e.target.value }))}>{Object.entries(MEAL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <div className="span-2" style={{ alignSelf: 'end' }}><label className="check"><input type="checkbox" checked={f.isActive} onChange={e => setF(s => ({ ...s, isActive: e.target.checked }))} /> Aktif</label></div>
        <Field label="Açıklama" className="span-4"><input className="input" value={f.description} onChange={e => setF(s => ({ ...s, description: e.target.value }))} /></Field>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}
