import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, Pencil, Plus } from 'lucide-react';
import { get, newKey, post, put } from '../lib/api';
import { fmtDate, fmtQty } from '../lib/format';
import { useRatePlans, useRoomTypes } from '../lib/queries';
import { useSession } from '../lib/session';
import type { Promotion } from '../lib/types';
import { PageHead } from '../components/common';
import { Badge, Empty, ErrorBox, Field, Modal, Spinner, useToast } from '../components/ui';

const KIND: Record<Promotion['kind'], string> = { discount: '% indirim', early_booking: 'Erken rezervasyon', stay_pay: 'Kal / öde' };
const ruleText = (p: Promotion) => p.kind === 'stay_pay' ? `${p.stayNights} kal ${p.payNights} öde`
  : p.kind === 'early_booking' ? `%${fmtQty(p.discountPct)} · en az ${p.minDaysBefore} gün önce` : `%${fmtQty(p.discountPct)}`;

/** Aksiyon ve indirimler: plan / oda tipi fiyatına otomatik uygulanan kampanyalar. */
export default function PromotionsPage() {
  const { can } = useSession();
  const [edit, setEdit] = useState<Promotion | 'new' | null>(null);
  const list = useQuery({ queryKey: ['ratePlans', 'promotions'], queryFn: () => get<Promotion[]>('/api/v1/promotions') });
  return (
    <div className="page">
      <PageHead title="Aksiyon ve İndirimler" sub="Uygun kampanyalardan misafire en çok indirim sağlayan biri plan veya oda tipi fiyatına otomatik uygulanır; elle girilen fiyatta uygulanmaz"
        actions={can('rate.manage') && <button className="btn primary" onClick={() => setEdit('new')}><Plus /> Kampanya ekle</button>} />
      <div className="card">
        {list.isLoading ? <Spinner /> : list.error ? <ErrorBox error={list.error} /> : !list.data?.length
          ? <Empty icon={<BadgePercent />} title="Kampanya yok" text="Ör. 7 kal 6 öde, 30 gün önceden erken rezervasyon %15, kış indirimi %10." />
          : (
            <div className="table-wrap"><table className="dt">
              <thead><tr><th>Kod</th><th>Ad</th><th>Tür</th><th>Kural</th><th>Konaklama</th><th>Satış</th><th>Oda tipi / plan</th><th className="r">En az gece</th><th className="r">Kullanım</th><th>Durum</th><th /></tr></thead>
              <tbody>{list.data.map(p => (
                <tr key={p.id} className={p.isActive ? '' : 'muted'}>
                  <td><b>{p.code}</b></td><td>{p.name}</td><td>{KIND[p.kind]}</td><td>{ruleText(p)}</td>
                  <td className="nowrap">{fmtDate(p.stayFrom)} – {fmtDate(p.stayTo)}</td>
                  <td className="nowrap">{p.bookFrom || p.bookTo ? `${fmtDate(p.bookFrom) || '…'} – ${fmtDate(p.bookTo) || '…'}` : 'Her zaman'}</td>
                  <td>{p.roomTypeCode ?? 'Tüm tipler'}{p.ratePlanCode ? ` · ${p.ratePlanCode}` : ''}</td>
                  <td className="r">{p.minNights}</td><td className="r">{p.usedCount}</td>
                  <td>{p.isActive ? <Badge color="green">Aktif</Badge> : <Badge color="gray">Pasif</Badge>}</td>
                  <td className="r">{can('rate.manage') && <button className="btn sm ghost icon" title="Düzenle" onClick={() => setEdit(p)}><Pencil /></button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
      </div>
      {edit && <PromotionModal p={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function PromotionModal({ p, onClose }: { p: Promotion | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { property } = useSession();
  const types = useRoomTypes();
  const plans = useRatePlans();
  const bd = property?.businessDate ?? '';
  const [f, setF] = useState({
    code: p?.code ?? '', name: p?.name ?? '', kind: p?.kind ?? 'discount' as Promotion['kind'], discountPct: p?.discountPct ?? '', stayNights: String(p?.stayNights ?? ''),
    payNights: String(p?.payNights ?? ''), minDaysBefore: String(p?.minDaysBefore ?? ''), minNights: String(p?.minNights ?? 1), stayFrom: p?.stayFrom ?? bd,
    stayTo: p?.stayTo ?? bd, bookFrom: p?.bookFrom ?? '', bookTo: p?.bookTo ?? '', roomTypeId: p?.roomTypeId ?? '', ratePlanId: p?.ratePlanId ?? '', isActive: p?.isActive ?? true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(s => ({ ...s, [k]: v }));
  const [busy, setBusy] = useState(false);
  const num = (s: string) => (s.trim() ? Number(s) : null);
  const save = async () => {
    setBusy(true);
    const body = {
      code: f.code.trim().toUpperCase(), name: f.name.trim(), kind: f.kind, discountPct: f.kind === 'stay_pay' ? null : num(String(f.discountPct).replace(',', '.')),
      stayNights: f.kind === 'stay_pay' ? num(f.stayNights) : null, payNights: f.kind === 'stay_pay' ? num(f.payNights) : null,
      minDaysBefore: f.kind === 'early_booking' ? num(f.minDaysBefore) : null, minNights: num(f.minNights), stayFrom: f.stayFrom, stayTo: f.stayTo,
      bookFrom: f.bookFrom || null, bookTo: f.bookTo || null, roomTypeId: f.roomTypeId || null, ratePlanId: f.ratePlanId || null, isActive: f.isActive, version: p?.version,
    };
    try {
      if (p) await put(`/api/v1/promotions/${p.id}`, body); else await post('/api/v1/promotions', body, newKey());
      await qc.invalidateQueries({ queryKey: ['ratePlans', 'promotions'] });
      await qc.invalidateQueries({ queryKey: ['ratePrices'] });
      toast.ok('Kampanya kaydedildi.'); onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={p ? `Kampanya · ${p.code}` : 'Yeni kampanya'} size="lg" onClose={onClose} footer={<>
      <label className="check"><input type="checkbox" checked={f.isActive} onChange={e => set('isActive', e.target.checked)} /> Aktif</label>
      <span className="spacer" />
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={busy || !f.code.trim() || !f.name.trim()} onClick={() => void save()}>Kaydet</button>
    </>}>
      <div className="form-grid">
        <Field label="Kod" required><input className="input" maxLength={20} value={f.code} onChange={e => set('code', e.target.value.toUpperCase())} autoFocus placeholder="7KAL6" /></Field>
        <Field label="Ad" required className="span-3"><input className="input" maxLength={120} value={f.name} onChange={e => set('name', e.target.value)} placeholder="7 kal 6 öde" /></Field>
        <Field label="Tür" className="span-2"><select className="input" value={f.kind} onChange={e => set('kind', e.target.value as Promotion['kind'])}>
          {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        {f.kind === 'stay_pay' ? <>
          <Field label="Kalınan gece" required><input className="input" type="number" min={2} max={60} value={f.stayNights} onChange={e => set('stayNights', e.target.value)} /></Field>
          <Field label="Ödenen gece" required><input className="input" type="number" min={1} value={f.payNights} onChange={e => set('payNights', e.target.value)} /></Field>
        </> : <>
          <Field label="İndirim %" required><input className="input" inputMode="decimal" value={f.discountPct} onChange={e => set('discountPct', e.target.value)} /></Field>
          {f.kind === 'early_booking'
            ? <Field label="En az kaç gün önce" required><input className="input" type="number" min={1} max={730} value={f.minDaysBefore} onChange={e => set('minDaysBefore', e.target.value)} /></Field>
            : <div />}
        </>}
        <Field label="Konaklama başlangıç" required><input className="input" type="date" value={f.stayFrom} onChange={e => set('stayFrom', e.target.value)} /></Field>
        <Field label="Konaklama bitiş (dahil)" required><input className="input" type="date" min={f.stayFrom} value={f.stayTo} onChange={e => set('stayTo', e.target.value)} /></Field>
        <Field label="Satış başlangıç"><input className="input" type="date" value={f.bookFrom} onChange={e => set('bookFrom', e.target.value)} /></Field>
        <Field label="Satış bitiş"><input className="input" type="date" value={f.bookTo} onChange={e => set('bookTo', e.target.value)} /></Field>
        <Field label="Oda tipi" className="span-2"><select className="input" value={f.roomTypeId} onChange={e => set('roomTypeId', e.target.value)}>
          <option value="">Tüm oda tipleri</option>{types.data?.filter(t => t.isActive).map(t => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}</select></Field>
        <Field label="Fiyat planı" className="span-2"><select className="input" value={f.ratePlanId} onChange={e => set('ratePlanId', e.target.value)}>
          <option value="">Tüm planlar ve plansız fiyat</option>{plans.data?.filter(x => x.isActive).map(x => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</select></Field>
        <Field label="En az gece"><input className="input" type="number" min={1} max={365} value={f.minNights} onChange={e => set('minNights', e.target.value)} /></Field>
        <div className="span-3 muted" style={{ fontSize: 12, alignSelf: 'end' }}>
          {f.kind === 'stay_pay' ? 'Konaklama aralığındaki her tam blokta en ucuz geceler ücretsiz olur (ör. 7 kal 6 öde: 14 gecede 2 gece ücretsiz).'
            : f.kind === 'early_booking' ? 'Rezervasyon girişten en az belirtilen gün önce alındıysa uygulanır; sonradan yapılan düzenlemede alındığı gün esas alınır.'
              : 'Konaklama aralığına düşen gecelere uygulanır.'}
        </div>
      </div>
    </Modal>
  );
}
