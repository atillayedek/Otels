import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save } from 'lucide-react';
import { api, get } from '../../lib/api';
import type { PaymentMethod, Setting, TransactionCode } from '../../lib/types';
import { useSession } from '../../lib/session';
import { fmtMoney } from '../../lib/format';
import { usePaymentMethods, useTransactionCodes } from '../../lib/queries';
import { PageHead, useAction } from '../../components/common';
import { Badge, DataTable, Empty, ErrorBox, Field, Modal, MoneyInput, type Column } from '../../components/ui';

const CATS: Record<string, string> = { room: 'Oda', food_beverage: 'Yiyecek-içecek', minibar: 'Minibar', laundry: 'Çamaşırhane', telephone: 'Telefon', spa: 'Spa', transfer: 'Transfer', misc: 'Diğer', tax: 'Vergi', package: 'Paket' };
const KINDS: Record<string, string> = { cash: 'Nakit', credit_card: 'Kredi kartı', bank_transfer: 'Havale/EFT', city_ledger: 'Cari hesaba aktar', company: 'Şirkete aktar', agency: 'Acenteye aktar', other: 'Diğer' };

export default function FinanceSettingsPage() {
  const codes = useTransactionCodes();
  const methods = usePaymentMethods();
  const [code, setCode] = useState<TransactionCode | 'new' | null>(null);
  const [method, setMethod] = useState<PaymentMethod | 'new' | null>(null);
  const ccols: Column<TransactionCode>[] = [
    { key: 'code', header: 'Kod', width: 90 }, { key: 'name', header: 'Ad' }, { key: 'category', header: 'Kategori', width: 130, value: c => CATS[c.category] ?? c.category },
    { key: 'defaultPrice', header: 'Fiyat', align: 'right', width: 110, render: c => c.defaultPrice ? fmtMoney(c.defaultPrice) : '' },
    { key: 'vatRate', header: 'KDV %', align: 'right', width: 70 },
    { key: 'isActive', header: '', width: 110, render: c => <>{c.isSystem && <Badge color="blue">Sistem</Badge>} {!c.isActive && <Badge color="gray">Pasif</Badge>}</> },
  ];
  const mcols: Column<PaymentMethod>[] = [
    { key: 'code', header: 'Kod', width: 90 }, { key: 'name', header: 'Ad' }, { key: 'kind', header: 'Tür', width: 150, value: m => KINDS[m.kind] ?? m.kind },
    { key: 'requiresReference', header: 'Referans', width: 90, value: m => (m.requiresReference ? 'Zorunlu' : '') },
    { key: 'isActive', header: '', width: 110, render: m => <>{m.isSystem && <Badge color="blue">Sistem</Badge>} {!m.isActive && <Badge color="gray">Pasif</Badge>}</> },
  ];
  return (
    <div className="page">
      <PageHead title="İşlem Kodları ve Ödeme Tipleri" />
      <CurrencyTaxCard />
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card"><div className="card-head"><h3>İşlem kodları (masraflar)</h3><div className="right"><button className="btn sm primary" onClick={() => setCode('new')}><Plus /> Ekle</button></div></div>
          <div className="card-body tight"><DataTable rows={codes.data ?? []} columns={ccols} rowKey={c => c.id} onRowClick={setCode} empty={<Empty title="İşlem kodu yok" />} /></div></div>
        <div className="card"><div className="card-head"><h3>Ödeme tipleri</h3><div className="right"><button className="btn sm primary" onClick={() => setMethod('new')}><Plus /> Ekle</button></div></div>
          <div className="card-body tight"><DataTable rows={methods.data ?? []} columns={mcols} rowKey={m => m.id} onRowClick={setMethod} empty={<Empty title="Ödeme tipi yok" />} /></div></div>
      </div>
      {code && <CodeModal c={code === 'new' ? undefined : code} onClose={() => setCode(null)} />}
      {method && <MethodModal m={method === 'new' ? undefined : method} onClose={() => setMethod(null)} />}
    </div>
  );
}

const RATE_TYPES: Record<string, string> = { BanknoteBuying: 'Efektif alış', BanknoteSelling: 'Efektif satış', ForexBuying: 'Döviz alış', ForexSelling: 'Döviz satış' };

/** Döviz listesi, TCMB kur türü ve konaklama vergisi ayarları. */
function CurrencyTaxCard() {
  const qc = useQueryClient();
  const { property } = useSession();
  const settings = useQuery({ queryKey: ['settings', 'all'], queryFn: () => get<Setting[]>('/api/v1/property/settings') });
  const val = (k: string) => settings.data?.find(s => s.key === k)?.value;
  const [f, setF] = useState<{ currencies: string; rateType: string; kvRate: string; kvIncluded: boolean } | null>(null);
  useEffect(() => {
    if (!settings.data || f) return;
    setF({
      currencies: ((val('finance.currencies') as string[] | undefined) ?? []).join(', '),
      rateType: String(val('finance.tcmb_rate_type') ?? 'BanknoteBuying'),
      kvRate: String(val('tax.accommodation_rate') ?? '0'),
      kvIncluded: val('tax.accommodation_included') !== false,
    });
  }, [settings.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAction(async () => {
    const list = f!.currencies.split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    const rate = Number(f!.kvRate.replace(',', '.'));
    await api('PUT', '/api/v1/property/settings/finance.currencies', list);
    await api('PUT', '/api/v1/property/settings/finance.tcmb_rate_type', f!.rateType);
    await api('PUT', '/api/v1/property/settings/tax.accommodation_rate', Number.isFinite(rate) ? rate : -1);
    await api('PUT', '/api/v1/property/settings/tax.accommodation_included', f!.kvIncluded);
    await qc.invalidateQueries({ queryKey: ['settings'] });
    await qc.invalidateQueries({ queryKey: ['exchangeRates'] });
  }, { success: 'Döviz ve vergi ayarları kaydedildi.' });
  if (!f) return null;
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head"><h3>Döviz ve konaklama vergisi</h3><div className="right"><button className="btn sm primary" disabled={save.busy} onClick={() => void save.run()}><Save /> Kaydet</button></div></div>
      <div className="card-body">
        <div className="form-grid">
          <Field label="Kabul edilen dövizler" className="span-2" hint={`ISO kodları, virgülle (ör. EUR, USD, GBP). Tesis para birimi: ${property?.currency ?? ''}`}>
            <input className="input" value={f.currencies} onChange={e => setF(s => ({ ...s!, currencies: e.target.value }))} />
          </Field>
          <Field label="TCMB'den alınacak kur" className="span-2" hint="Ön Kasa → Döviz Kurları ekranındaki 'TCMB kurlarını al' bu kuru kaydeder">
            <select className="input" value={f.rateType} onChange={e => setF(s => ({ ...s!, rateType: e.target.value }))}>{Object.entries(RATE_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Field>
          <Field label="Konaklama vergisi %" hint="0 ise uygulanmaz">
            <input className="input num" value={f.kvRate} onChange={e => setF(s => ({ ...s!, kvRate: e.target.value }))} inputMode="decimal" />
          </Field>
          <Field label="Fiyatlara göre" className="span-3">
            <select className="input" value={f.kvIncluded ? '1' : '0'} onChange={e => setF(s => ({ ...s!, kvIncluded: e.target.value === '1' }))}>
              <option value="1">Gecelik fiyatlara dahil (gece denetiminde fiyattan ayrıştırılır)</option>
              <option value="0">Gecelik fiyatın üstüne eklenir</option>
            </select>
          </Field>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Konaklama vergisi gece denetiminde oda ücretinden ayrı bir satır olarak ("KV" işlem kodu) yazılır. Hesap KDV hariç oda bedeli üzerinden yapılır ve vergi KDV matrahına dahil edilir;
          oda KDV oranı "ROOM" işlem kodundan alınır. Oranı ve uygulamayı mali müşavirinizle teyit edin.
        </div>
        <ErrorBox error={save.error} />
      </div>
    </div>
  );
}

function CodeModal({ c, onClose }: { c?: TransactionCode; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: c?.code ?? '', name: c?.name ?? '', category: c?.category ?? 'misc', defaultPrice: c?.defaultPrice ?? '', vatRate: c?.vatRate ?? '20', isActive: c?.isActive ?? true });
  const save = useAction(async () => {
    const body = { ...f, code: f.code.trim().toUpperCase(), defaultPrice: f.defaultPrice || null };
    if (c) await api('PUT', `/api/v1/finance/transaction-codes/${c.id}`, body); else await api('POST', '/api/v1/finance/transaction-codes', body);
    await qc.invalidateQueries({ queryKey: ['settings'] });
  }, { success: 'Kaydedildi.' });
  return (
    <Modal title={c ? `İşlem kodu · ${c.code}` : 'Yeni işlem kodu'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={!f.code.trim() || !f.name.trim() || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button></>}>
      <div className="form-grid">
        <Field label="Kod" required><input className="input" value={f.code} disabled={c?.isSystem} onChange={e => setF(s => ({ ...s, code: e.target.value }))} autoFocus /></Field>
        <Field label="Ad" required className="span-3"><input className="input" value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} /></Field>
        <Field label="Kategori" className="span-2"><select className="input" value={f.category} disabled={c?.isSystem} onChange={e => setF(s => ({ ...s, category: e.target.value }))}>{Object.entries(CATS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Varsayılan fiyat"><MoneyInput value={f.defaultPrice} onChange={v => setF(s => ({ ...s, defaultPrice: v }))} /></Field>
        <Field label="KDV %"><input className="input num" value={f.vatRate} onChange={e => setF(s => ({ ...s, vatRate: e.target.value.replace(',', '.') }))} /></Field>
        <div className="span-4"><label className="check"><input type="checkbox" checked={f.isActive} onChange={e => setF(s => ({ ...s, isActive: e.target.checked }))} /> Aktif</label></div>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function MethodModal({ m, onClose }: { m?: PaymentMethod; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: m?.code ?? '', name: m?.name ?? '', kind: m?.kind ?? 'credit_card', requiresReference: m?.requiresReference ?? false, isActive: m?.isActive ?? true });
  const save = useAction(async () => {
    const body = { ...f, code: f.code.trim().toUpperCase() };
    if (m) await api('PUT', `/api/v1/finance/payment-methods/${m.id}`, body); else await api('POST', '/api/v1/finance/payment-methods', body);
    await qc.invalidateQueries({ queryKey: ['settings'] });
  }, { success: 'Kaydedildi.' });
  return (
    <Modal title={m ? `Ödeme tipi · ${m.code}` : 'Yeni ödeme tipi'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={!f.code.trim() || !f.name.trim() || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button></>}>
      <div className="form-grid">
        <Field label="Kod" required><input className="input" value={f.code} disabled={m?.isSystem} onChange={e => setF(s => ({ ...s, code: e.target.value }))} autoFocus /></Field>
        <Field label="Ad" required className="span-3"><input className="input" value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} /></Field>
        <Field label="Tür" className="span-2"><select className="input" value={f.kind} disabled={m?.isSystem} onChange={e => setF(s => ({ ...s, kind: e.target.value }))}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <div className="span-2 stack" style={{ alignSelf: 'end', gap: 4 }}>
          <label className="check"><input type="checkbox" checked={f.requiresReference} onChange={e => setF(s => ({ ...s, requiresReference: e.target.checked }))} /> Referans (slip/dekont no) zorunlu</label>
          <label className="check"><input type="checkbox" checked={f.isActive} onChange={e => setF(s => ({ ...s, isActive: e.target.checked }))} /> Aktif</label>
        </div>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}
