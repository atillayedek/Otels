import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api, del } from '../../lib/api';
import type { ReservationCode } from '../../lib/types';
import { MEAL_LABEL } from '../../lib/format';
import { useReservationCodes } from '../../lib/queries';
import { PageHead, useAction } from '../../components/common';
import { Badge, DataTable, Empty, ErrorBox, Field, Modal, useConfirm, useToast, type Column } from '../../components/ui';

const KIND_LABEL: Record<ReservationCode['kind'], string> = { market: 'Market', segment: 'Segment' };

/** Rezervasyon kodları: market ve segment tanımları. Rezervasyon formunda listeden seçilir, "Market ve Segment Üretimi" raporunda gruplanır. */
export default function ReservationCodesPage() {
  const codes = useReservationCodes();
  const [edit, setEdit] = useState<ReservationCode | { kind: ReservationCode['kind'] } | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const remove = async (c: ReservationCode) => {
    if (!await confirm({ title: 'Kodu sil', message: `${KIND_LABEL[c.kind]} kodu ${c.code} · ${c.name} silinecek.`, confirmText: 'Sil', danger: true })) return;
    try { await del(`/api/v1/reservation-codes/${c.id}`); await qc.invalidateQueries({ queryKey: ['reservationCodes'] }); toast.ok('Kod silindi.'); } catch (e) { toast.error(e); }
  };
  const cols: Column<ReservationCode>[] = [
    { key: 'code', header: 'Kod', width: 110 }, { key: 'name', header: 'Ad' },
    { key: 'usedCount', header: 'Rezervasyon', width: 100, value: c => String(c.usedCount) },
    { key: 'sortOrder', header: 'Sıra', width: 60, value: c => String(c.sortOrder) },
    { key: 'isActive', header: '', width: 70, render: c => c.isActive ? <Badge color="green">Aktif</Badge> : <Badge color="gray">Pasif</Badge> },
    { key: 'del', header: '', width: 44, render: c => c.usedCount === 0 ? <button className="btn sm ghost icon" title="Sil" onClick={e => { e.stopPropagation(); void remove(c); }}><Trash2 /></button> : null },
  ];
  const list = (kind: ReservationCode['kind']) => (codes.data ?? []).filter(c => c.kind === kind);
  return (
    <div className="page">
      <PageHead title="Rezervasyon Kodları" sub="Market ve segment kodları rezervasyonda listeden seçilir; Raporlar > Market ve Segment Üretimi bu kodlara göre gruplanır" />
      <ErrorBox error={codes.error} />
      <div className="grid cols-2">
        {(['market', 'segment'] as const).map(kind => (
          <div className="card" key={kind}>
            <div className="card-head"><h3>{KIND_LABEL[kind]} kodları</h3><button className="btn sm primary" style={{ marginLeft: 'auto' }} onClick={() => setEdit({ kind })}><Plus /> Yeni</button></div>
            <div className="card-body tight">
              <DataTable rows={list(kind)} columns={cols} rowKey={c => c.id} onRowClick={c => setEdit(c)}
                empty={<Empty title={`${KIND_LABEL[kind]} kodu yok`} text={kind === 'market' ? 'Örnek: YERLI · Yerli pazar, AVRUPA · Avrupa, RUSYA · Rusya' : 'Örnek: BIREYSEL · Bireysel, KURUMSAL · Kurumsal, GRUP · Grup, OTA · Online acente'} />} />
            </div>
          </div>
        ))}
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head"><h3>Pansiyon kodları</h3><span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>Sabit liste; rezervasyonda ve fiyat planında seçilir</span></div>
        <div className="card-body"><div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>{Object.entries(MEAL_LABEL).map(([k, l]) => <Badge key={k} color="gray">{l}</Badge>)}</div></div>
      </div>
      {edit && <CodeModal c={'id' in edit ? edit : undefined} kind={edit.kind} onClose={() => setEdit(null)} />}
    </div>
  );
}

function CodeModal({ c, kind, onClose }: { c?: ReservationCode; kind: ReservationCode['kind']; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: c?.code ?? '', name: c?.name ?? '', sortOrder: String(c?.sortOrder ?? 0), isActive: c?.isActive ?? true });
  const used = (c?.usedCount ?? 0) > 0;
  const save = useAction(async () => {
    const body = { kind, code: f.code.trim().toUpperCase(), name: f.name.trim(), sortOrder: Number(f.sortOrder) || 0, isActive: f.isActive, version: c?.version ?? null };
    if (c) await api('PUT', `/api/v1/reservation-codes/${c.id}`, body); else await api('POST', '/api/v1/reservation-codes', body);
    await qc.invalidateQueries({ queryKey: ['reservationCodes'] });
  }, { success: 'Kod kaydedildi.' });
  return (
    <Modal title={c ? `${KIND_LABEL[kind]} kodu · ${c.code}` : `Yeni ${KIND_LABEL[kind].toLocaleLowerCase('tr-TR')} kodu`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={!f.code.trim() || !f.name.trim() || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button></>}>
      <div className="form-grid">
        <Field label="Kod" required hint={used ? 'Rezervasyonlarda kullanıldığı için değiştirilemez' : 'Harf, rakam, - ve _'}>
          <input className="input mono" value={f.code} disabled={used} maxLength={20} autoFocus={!c} onChange={e => setF(s => ({ ...s, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') }))} />
        </Field>
        <Field label="Ad" required className="span-2"><input className="input" value={f.name} maxLength={60} autoFocus={!!c} onChange={e => setF(s => ({ ...s, name: e.target.value }))} /></Field>
        <Field label="Sıra"><input className="input" value={f.sortOrder} onChange={e => setF(s => ({ ...s, sortOrder: e.target.value.replace(/\D/g, '') }))} /></Field>
        <div className="span-4"><label className="check"><input type="checkbox" checked={f.isActive} onChange={e => setF(s => ({ ...s, isActive: e.target.checked }))} /> Aktif (pasif kod yeni rezervasyonda listelenmez)</label></div>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}
