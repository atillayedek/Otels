import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { api, get } from '../../lib/api';
import type { Property, Setting } from '../../lib/types';
import { fmtDate } from '../../lib/format';
import { useSession } from '../../lib/session';
import { PageHead, useAction } from '../../components/common';
import { ErrorBox, Field, Spinner, useToast } from '../../components/ui';

const TOGGLES: [string, string, string][] = [
  ['finance.require_cashier_shift', 'Nakit ve kart tahsilatı için açık kasa vardiyası zorunlu', 'Kasa farklarının izlenebilmesi için önerilir.'],
  ['frontoffice.checkout_requires_zero_balance', 'Çıkışta folyo bakiyesi sıfır olmalı', 'Açık bakiyeli çıkışı engeller.'],
  ['frontoffice.allow_checkin_dirty_room', 'Temiz olmayan odaya giriş yapılabilir', 'Kapalıyken yalnız temiz veya kontrol edilmiş odaya giriş yapılır.'],
  ['guest.require_identity_on_checkin', 'Girişte kimlik bilgisi zorunlu', 'KBS bildirimi için gereklidir.'],
  ['night_audit.auto_no_show', 'Gece denetiminde gelmeyenleri varsayılan olarak no-show yap', ''],
  ['night_audit.block_on_open_shifts', 'Açık kasa vardiyası varken gece denetimini engelle', ''],
];

export default function PropertySettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { reloadClient } = useSession();
  const prop = useQuery({ queryKey: ['property', 'edit'], queryFn: () => get<Property>('/api/v1/property') });
  const zones = useQuery({ queryKey: ['property', 'zones'], queryFn: () => get<string[]>('/api/v1/property/time-zones') });
  const settings = useQuery({ queryKey: ['settings', 'all'], queryFn: () => get<Setting[]>('/api/v1/property/settings') });
  const [f, setF] = useState<Property | null>(null);
  useEffect(() => { if (prop.data) setF(prop.data); }, [prop.data]);
  const set = (k: keyof Property) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(s => (s ? { ...s, [k]: e.target.value } : s));
  const save = useAction(async () => {
    const n = (v?: string) => (v && v.trim() ? v.trim() : null);
    await api('PUT', '/api/v1/property', { name: f!.name, legalName: n(f!.legalName), taxOffice: n(f!.taxOffice), taxNumber: n(f!.taxNumber), address: n(f!.address), city: n(f!.city),
      country: f!.country, phone: n(f!.phone), email: n(f!.email), timeZone: f!.timeZone, checkInTime: f!.checkInTime.slice(0, 5) + ':00', checkOutTime: f!.checkOutTime.slice(0, 5) + ':00', version: f!.version });
    await qc.invalidateQueries({ queryKey: ['property'] });
    await reloadClient();
  }, { success: 'Tesis bilgileri kaydedildi.' });
  const toggle = async (key: string, value: boolean) => {
    try { await api('PUT', `/api/v1/property/settings/${key}`, value); await qc.invalidateQueries({ queryKey: ['settings'] }); toast.ok('Ayar kaydedildi.'); } catch (e) { toast.error(e); }
  };
  if (!f) return <div className="page"><Spinner /></div>;
  const val = (k: string) => settings.data?.find(s => s.key === k)?.value === true;

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <PageHead title="Tesis Bilgileri" sub={`İş günü ${fmtDate(f.businessDate)} · Para birimi ${f.currency}`} actions={<button className="btn primary" disabled={save.busy || !f.name.trim()} onClick={() => void save.run()}><Save /> Kaydet</button>} />
      <div className="card" style={{ marginBottom: 14 }}><div className="card-head"><h3>Tesis</h3></div><div className="card-body form-grid">
        <Field label="Otel adı" required className="span-2"><input className="input" value={f.name} onChange={set('name')} /></Field>
        <Field label="Ticari unvan" className="span-2"><input className="input" value={f.legalName ?? ''} onChange={set('legalName')} /></Field>
        <Field label="Vergi dairesi"><input className="input" value={f.taxOffice ?? ''} onChange={set('taxOffice')} /></Field>
        <Field label="Vergi no"><input className="input mono" value={f.taxNumber ?? ''} onChange={set('taxNumber')} /></Field>
        <Field label="Telefon"><input className="input" value={f.phone ?? ''} onChange={set('phone')} /></Field>
        <Field label="E-posta"><input className="input" value={f.email ?? ''} onChange={set('email')} /></Field>
        <Field label="Adres" className="span-2"><input className="input" value={f.address ?? ''} onChange={set('address')} /></Field>
        <Field label="Şehir"><input className="input" value={f.city ?? ''} onChange={set('city')} /></Field>
        <Field label="Ülke"><input className="input" value={f.country} onChange={set('country')} maxLength={2} /></Field>
        <Field label="Saat dilimi" className="span-2"><select className="input" value={f.timeZone} onChange={set('timeZone')}>{(zones.data ?? [f.timeZone]).map(z => <option key={z}>{z}</option>)}</select></Field>
        <Field label="Giriş saati"><input type="time" className="input" value={f.checkInTime.slice(0, 5)} onChange={set('checkInTime')} /></Field>
        <Field label="Çıkış saati"><input type="time" className="input" value={f.checkOutTime.slice(0, 5)} onChange={set('checkOutTime')} /></Field>
      </div></div>
      <ErrorBox error={save.error} />
      <div className="card"><div className="card-head"><h3>İşleyiş kuralları</h3></div><div className="card-body">
        <ul className="list-plain">
          {TOGGLES.map(([k, label, hint]) => (
            <li key={k}><label className="check"><input type="checkbox" checked={val(k)} onChange={e => void toggle(k, e.target.checked)} /> {label}</label>{hint && <span className="muted" style={{ fontSize: 12 }}>{hint}</span>}</li>
          ))}
        </ul>
      </div></div>
    </div>
  );
}
