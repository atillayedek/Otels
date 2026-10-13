import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Search } from 'lucide-react';
import { api, get, qs } from '../lib/api';
import type { Account } from '../lib/types';
import { useSession } from '../lib/session';
import { PageHead, useAction } from '../components/common';
import { DataTable, Empty, ErrorBox, Field, Modal, Money, MoneyInput, type Column } from '../components/ui';

export default function AccountsPage({ kind }: { kind: 'companies' | 'agencies' }) {
  const nav = useNavigate();
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [inactive, setInactive] = useState(false);
  const [edit, setEdit] = useState<Account | 'new' | null>(null);
  const label = kind === 'companies' ? 'Şirket' : 'Acente';
  const list = useQuery({ queryKey: ['accounts', kind, 'all', inactive], queryFn: () => get<Account[]>(`/api/v1/${kind}${qs({ active: inactive ? null : true })}`) });
  const rows = (list.data ?? []).filter(a => !q.trim() || `${a.name} ${a.code ?? ''} ${a.taxNumber ?? ''}`.toLocaleLowerCase('tr-TR').includes(q.trim().toLocaleLowerCase('tr-TR')));

  const cols: Column<Account>[] = [
    { key: 'code', header: 'Kod', width: 90 },
    { key: 'name', header: label, render: a => <>{a.name}{!a.isActive && <span className="badge gray" style={{ marginLeft: 6 }}>Pasif</span>}{a.isCityLedger && <span className="badge blue" style={{ marginLeft: 6 }}>Cari</span>}</> },
    { key: 'taxNumber', header: 'Vergi no', render: a => <span className="mono">{a.taxNumber}</span> },
    { key: 'taxOffice', header: 'Vergi dairesi' },
    { key: 'city', header: 'Şehir' },
    { key: 'phone', header: 'Telefon' },
    ...(kind === 'agencies' ? [{ key: 'commissionRate', header: 'Komisyon %', align: 'right' as const, width: 100 }] : [{ key: 'creditLimit', header: 'Kredi limiti', align: 'right' as const, width: 120, render: (a: Account) => <Money value={a.creditLimit} /> }]),
    { key: 'balance', header: 'Cari bakiye', align: 'right', width: 130, render: a => <Money value={a.balance} colored /> },
  ];

  return (
    <div className="page">
      <PageHead title={kind === 'companies' ? 'Şirketler' : 'Acenteler'} actions={<>
        <button className="btn" onClick={() => nav(`/reports/${kind === 'companies' ? 'company-ledger' : 'agency-ledger'}`)}>Cari raporu</button>
        {can('company.manage') && <button className="btn primary" onClick={() => setEdit('new')}><Plus /> Yeni {label.toLocaleLowerCase('tr-TR')}</button>}
      </>} />
      <div className="toolbar">
        <Search size={15} className="muted" /><input className="input" style={{ width: 280 }} placeholder="Ad, kod, vergi no" value={q} onChange={e => setQ(e.target.value)} />
        <label className="check"><input type="checkbox" checked={inactive} onChange={e => setInactive(e.target.checked)} /> Pasifleri de göster</label>
        <span className="count">{rows.length} kayıt</span>
      </div>
      {list.error ? <ErrorBox error={list.error} /> : (
        <DataTable rows={rows} columns={cols} rowKey={a => a.id} onRowClick={a => can('company.manage') && setEdit(a)} maxHeight="calc(100vh - 250px)"
          empty={<Empty icon={<Building2 />} title={list.isLoading ? 'Yükleniyor…' : `Henüz ${label.toLocaleLowerCase('tr-TR')} kaydı bulunmuyor.`} text="Eski programınızdaki cari kartları Veri Aktarım Merkezi'nden alabilirsiniz." />} />
      )}
      {edit && <AccountModal kind={kind} account={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function AccountModal({ kind, account: a, onClose }: { kind: 'companies' | 'agencies'; account?: Account; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    code: a?.code ?? '', name: a?.name ?? '', taxOffice: a?.taxOffice ?? '', taxNumber: a?.taxNumber ?? '', address: a?.address ?? '', city: a?.city ?? '', country: a?.country ?? 'TR',
    phone: a?.phone ?? '', email: a?.email ?? '', contactName: a?.contactName ?? '', creditLimit: a?.creditLimit ?? '', commissionRate: a?.commissionRate ?? '',
    isCityLedger: a?.isCityLedger ?? kind === 'companies', notes: a?.notes ?? '', isActive: a?.isActive ?? true,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF(s => ({ ...s, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
  const save = useAction(async (key: string) => {
    const n = (v: string) => (v.trim() === '' ? null : v.trim());
    const body = { ...f, code: n(f.code), taxOffice: n(f.taxOffice), taxNumber: n(f.taxNumber), address: n(f.address), city: n(f.city), country: n(f.country)?.toUpperCase() ?? null, phone: n(f.phone), email: n(f.email),
      contactName: n(f.contactName), creditLimit: n(f.creditLimit), commissionRate: n(f.commissionRate), notes: n(f.notes), version: a?.version ?? null };
    if (a) await api('PUT', `/api/v1/${kind}/${a.id}`, body); else await api('POST', `/api/v1/${kind}`, body, { key });
    await qc.invalidateQueries({ queryKey: ['accounts'] });
  }, { success: 'Kaydedildi.' });
  return (
    <Modal title={a ? a.name : kind === 'companies' ? 'Yeni şirket' : 'Yeni acente'} size="lg" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!f.name.trim() || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button>
    </>}>
      <div className="form-grid">
        <Field label="Kod"><input className="input" value={f.code} onChange={set('code')} maxLength={30} /></Field>
        <Field label="Unvan" required className="span-3"><input className="input" value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Vergi dairesi" className="span-2"><input className="input" value={f.taxOffice} onChange={set('taxOffice')} /></Field>
        <Field label="Vergi no / T.C. no" className="span-2"><input className="input mono" value={f.taxNumber} onChange={set('taxNumber')} maxLength={20} /></Field>
        <Field label="Adres" className="span-2"><input className="input" value={f.address} onChange={set('address')} /></Field>
        <Field label="Şehir"><input className="input" value={f.city} onChange={set('city')} /></Field>
        <Field label="Ülke"><input className="input" value={f.country} onChange={set('country')} maxLength={2} /></Field>
        <Field label="Telefon"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="E-posta"><input className="input" value={f.email} onChange={set('email')} /></Field>
        <Field label="Yetkili kişi" className="span-2"><input className="input" value={f.contactName} onChange={set('contactName')} /></Field>
        {kind === 'companies' ? <Field label="Kredi limiti"><MoneyInput value={f.creditLimit} onChange={v => setF(s => ({ ...s, creditLimit: v }))} /></Field>
          : <Field label="Komisyon %"><input className="input num" value={f.commissionRate} onChange={set('commissionRate')} inputMode="decimal" /></Field>}
        <div className="span-3 row wrap" style={{ alignSelf: 'end' }}>
          <label className="check"><input type="checkbox" checked={f.isCityLedger} onChange={set('isCityLedger')} /> Cari hesap (city ledger) çalışır</label>
          <label className="check"><input type="checkbox" checked={f.isActive} onChange={set('isActive')} /> Aktif</label>
        </div>
        <Field label="Notlar" className="span-4"><textarea className="input" rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}
