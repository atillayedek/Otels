import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { api, get, post, qs } from '../lib/api';
import { fmtDate, fmtDateTime, fmtMoney } from '../lib/format';
import { useSession } from '../lib/session';
import { PageHead, useAction } from '../components/common';
import { Badge, DataTable, Empty, ErrorBox, Field, Modal, MoneyInput, Spinner, Tabs, type Column } from '../components/ui';

interface GlAccount { code: string; name: string; kind: string; isSystem: boolean; isActive: boolean; debit: string; credit: string }
interface GlMapping { key: string; accountCode: string; accountName: string }
interface CodeAccount { id: string; code: string; name: string; category: string; glAccount?: string }
interface GlEntry { id: string; entryNo: number; entryDate: string; kind: 'day' | 'manual' | 'reversal'; businessDate?: string; description: string; reversalOf?: string; reversedByNo?: number; total: string; username?: string; createdAt: string }
interface GlLine { lineNo: number; accountCode: string; accountName: string; debit: string; credit: string; description?: string }

const KIND: Record<string, string> = { asset: 'Aktif', liability: 'Pasif', equity: 'Özkaynak', revenue: 'Gelir', expense: 'Gider' };
const ENTRY_KIND: Record<string, [string, string]> = { day: ['Gün sonu', 'blue'], manual: ['Elle', 'gray'], reversal: ['Ters fiş', 'orange'] };
const MAPPING_LABEL: Record<string, string> = {
  'cash.cash': 'Nakit tahsilat (TL)', 'cash.fx': 'Nakit tahsilat (döviz)', 'cash.credit_card': 'Kredi kartı tahsilatı', 'cash.bank_transfer': 'Havale / EFT', 'cash.other': 'Diğer tahsilat',
  'receivable.guest': 'Misafir alacakları', 'receivable.account': 'Şirket / acente carileri',
  'revenue.room': 'Konaklama geliri', 'revenue.food_beverage': 'Yiyecek-içecek geliri', 'revenue.minibar': 'Minibar geliri', 'revenue.laundry': 'Çamaşırhane geliri',
  'revenue.telephone': 'Telefon geliri', 'revenue.spa': 'Spa geliri', 'revenue.transfer': 'Transfer geliri', 'revenue.misc': 'Diğer gelirler', 'revenue.package': 'Paket gelirleri',
  'tax.accommodation': 'Konaklama vergisi', 'vat.output': 'Hesaplanan KDV (ana hesap)', 'vat.input': 'İndirilecek KDV (ana hesap)', discount: 'Satış iskontoları',
  'stock.inventory': 'Stok (malzeme)', 'stock.consumption': 'Stok tüketimi (maliyet)', 'stock.payable': 'Satıcılar', 'fx.gain': 'Kur farkı karı', 'fx.loss': 'Kur farkı zararı',
};

type Tab = 'entries' | 'accounts' | 'mappings';

/** Muhasebe: yevmiye fişleri, hesap planı ve otomatik fiş eşlemeleri. Mizan ve ekstre raporları Raporlar ekranındadır. */
export default function AccountingPage() {
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('entries');
  return (
    <div className="page">
      <PageHead title="Muhasebe" sub="Gün sonu fişleri gece denetiminde otomatik oluşur" actions={<>
        <button className="btn" onClick={() => nav('/reports/trial_balance')}><FileSpreadsheet /> Mizan</button>
        <button className="btn" onClick={() => nav('/reports/account_statement')}><FileSpreadsheet /> Hesap ekstresi</button>
        <button className="btn" onClick={() => nav('/reports/journal')}><FileSpreadsheet /> Yevmiye</button>
      </>} />
      <Tabs value={tab} onChange={setTab} items={[{ key: 'entries', label: 'Fişler' }, { key: 'accounts', label: 'Hesap planı' }, { key: 'mappings', label: 'Otomatik fiş eşlemeleri' }]} />
      {tab === 'entries' && <EntriesTab />}
      {tab === 'accounts' && <AccountsTab />}
      {tab === 'mappings' && <MappingsTab />}
    </div>
  );
}

const useAccounts = () => useQuery({ queryKey: ['accounting', 'accounts'], queryFn: () => get<GlAccount[]>('/api/v1/accounting/accounts') });

function AccountSelect({ value, onChange, accounts, allowEmpty }: { value: string; onChange: (v: string) => void; accounts: GlAccount[]; allowEmpty?: string }) {
  return (
    <select className="input" value={value} onChange={e => onChange(e.target.value)}>
      {allowEmpty !== undefined ? <option value="">{allowEmpty}</option> : <option value="">Seçin</option>}
      {accounts.filter(a => a.isActive || a.code === value).map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
    </select>
  );
}

function EntriesTab() {
  const { property, can } = useSession();
  const bd = property?.businessDate ?? '';
  const [from, setFrom] = useState(bd ? `${bd.slice(0, 8)}01` : '');
  const [to, setTo] = useState(bd);
  const [kind, setKind] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [gen, setGen] = useState(false);
  const list = useQuery({ queryKey: ['accounting', 'entries', from, to, kind], queryFn: () => get<GlEntry[]>(`/api/v1/accounting/entries${qs({ from: from || null, to: to || null, kind: kind || null })}`) });
  const cols: Column<GlEntry>[] = [
    { key: 'entryNo', header: 'Fiş', width: 70, align: 'right' },
    { key: 'entryDate', header: 'Tarih', width: 100, render: e => fmtDate(e.entryDate) },
    { key: 'kind', header: 'Tür', width: 110, value: e => ENTRY_KIND[e.kind][0], render: e => <Badge color={ENTRY_KIND[e.kind][1]}>{ENTRY_KIND[e.kind][0]}</Badge> },
    { key: 'description', header: 'Açıklama', filter: true, render: e => <>{e.description}{e.reversedByNo && <Badge color="red">#{e.reversedByNo} ile ters çevrildi</Badge>}</> },
    { key: 'total', header: 'Tutar', align: 'right', width: 130, value: e => Number(e.total), render: e => fmtMoney(e.total) },
    { key: 'username', header: 'Kullanıcı', width: 110 },
  ];
  return (
    <>
      <div className="toolbar">
        <input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} /> – <input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} />
        <select className="input" style={{ width: 150 }} value={kind} onChange={e => setKind(e.target.value)}><option value="">Tüm fişler</option>{Object.entries(ENTRY_KIND).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
        {can('accounting.manage') && <button className="btn primary" onClick={() => setManual(true)}><Plus /> Elle fiş</button>}
        {can('accounting.manage') && <button className="btn" onClick={() => setGen(true)}>Geçmiş günlerin fişlerini oluştur</button>}
        <span className="count">{list.data?.length ?? 0} fiş</span>
      </div>
      {list.error ? <ErrorBox error={list.error} /> : (
        <DataTable rows={list.data ?? []} columns={cols} rowKey={e => e.id} onRowClick={e => setSel(e.id)} maxHeight="calc(100vh - 290px)"
          empty={<Empty title={list.isLoading ? 'Yükleniyor…' : 'Bu aralıkta fiş yok'} text="Gün sonu fişi her gece denetiminde oluşur." />} />
      )}
      {sel && <EntryModal id={sel} onClose={() => setSel(null)} />}
      {manual && <ManualEntryModal onClose={() => setManual(false)} />}
      {gen && <GenerateModal onClose={() => setGen(false)} />}
    </>
  );
}

function EntryModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const d = useQuery({ queryKey: ['accounting', 'entry', id], queryFn: () => get<{ entry: GlEntry; lines: GlLine[] }>(`/api/v1/accounting/entries/${id}`) });
  const [reason, setReason] = useState('');
  const reverse = useAction(async (key: string) => { await post(`/api/v1/accounting/entries/${id}/reverse`, { reason }, key); await qc.invalidateQueries({ queryKey: ['accounting'] }); },
    { success: 'Ters fiş kesildi.' });
  const e = d.data?.entry;
  const dr = d.data?.lines.reduce((s, l) => s + Number(l.debit), 0) ?? 0;
  const cr = d.data?.lines.reduce((s, l) => s + Number(l.credit), 0) ?? 0;
  return (
    <Modal title={e ? `Fiş #${e.entryNo} · ${e.description}` : 'Fiş'} size="xl" onClose={onClose} footer={<button className="btn" onClick={onClose}>Kapat</button>}>
      {!d.data || !e ? <Spinner /> : (
        <div className="stack">
          <div className="muted">{fmtDate(e.entryDate)} · {ENTRY_KIND[e.kind][0]} · {e.username} {fmtDateTime(e.createdAt)}</div>
          <div className="table-wrap" style={{ maxHeight: 400 }}>
            <table className="dt"><thead><tr><th>Hesap</th><th>Hesap adı</th><th>Açıklama</th><th style={{ textAlign: 'right' }}>Borç</th><th style={{ textAlign: 'right' }}>Alacak</th></tr></thead>
              <tbody>{d.data.lines.map(l => <tr key={l.lineNo}><td className="mono">{l.accountCode}</td><td>{l.accountName}</td><td className="muted">{l.description}</td>
                <td className="num">{Number(l.debit) ? fmtMoney(l.debit) : ''}</td><td className="num">{Number(l.credit) ? fmtMoney(l.credit) : ''}</td></tr>)}</tbody>
              <tfoot><tr><td colSpan={3}>Toplam</td><td className="num"><b>{fmtMoney(dr.toFixed(2))}</b></td><td className="num"><b>{fmtMoney(cr.toFixed(2))}</b></td></tr></tfoot></table>
          </div>
          {can('accounting.manage') && e.kind !== 'reversal' && !e.reversedByNo && (
            <div className="row">
              <input className="input" style={{ flex: 1 }} placeholder="Ters fiş gerekçesi" value={reason} onChange={x => setReason(x.target.value)} />
              <button className="btn danger" disabled={!reason.trim() || reverse.busy} onClick={async () => { if (await reverse.run() !== undefined) onClose(); }}><RotateCcw /> Ters fiş kes</button>
            </div>
          )}
          <ErrorBox error={reverse.error} />
        </div>
      )}
    </Modal>
  );
}

interface MLine { accountCode: string; debit: string; credit: string; description: string }

function ManualEntryModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { property } = useSession();
  const accounts = useAccounts();
  const [date, setDate] = useState(property?.businessDate ?? '');
  const [desc, setDesc] = useState('');
  const [lines, setLines] = useState<MLine[]>([{ accountCode: '', debit: '', credit: '', description: '' }, { accountCode: '', debit: '', credit: '', description: '' }]);
  const setLine = (i: number, p: Partial<MLine>) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const dr = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const cr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const filled = lines.filter(l => l.accountCode && (Number(l.debit) > 0) !== (Number(l.credit) > 0));
  const valid = desc.trim() && filled.length >= 2 && filled.length === lines.filter(l => l.accountCode || l.debit || l.credit).length && Math.abs(dr - cr) < 0.005 && dr > 0;
  const save = useAction(async (key: string) => {
    await post('/api/v1/accounting/entries', { entryDate: date, description: desc.trim(), lines: filled.map(l => ({ accountCode: l.accountCode, debit: l.debit || '0', credit: l.credit || '0', description: l.description.trim() || null })) }, key);
    await qc.invalidateQueries({ queryKey: ['accounting'] });
  }, { success: 'Fiş kaydedildi.' });
  return (
    <Modal title="Elle muhasebe fişi" size="xl" onClose={onClose} footer={<>
      <span className={Math.abs(dr - cr) >= 0.005 ? 'amount-neg' : 'muted'}>Borç {fmtMoney(dr.toFixed(2))} · Alacak {fmtMoney(cr.toFixed(2))}{Math.abs(dr - cr) >= 0.005 ? ` · Fark ${fmtMoney((dr - cr).toFixed(2))}` : ''}</span><span className="spacer" />
      <button className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={!valid || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button></>}>
      {!accounts.data ? <Spinner /> : (
        <div className="stack">
          <div className="form-grid">
            <Field label="Tarih" required><input type="date" className="input" value={date} max={property?.businessDate} onChange={e => setDate(e.target.value)} /></Field>
            <Field label="Açıklama" required className="span-3"><input className="input" value={desc} onChange={e => setDesc(e.target.value)} maxLength={300} autoFocus /></Field>
          </div>
          <table className="dt"><thead><tr><th>Hesap</th><th style={{ width: 140 }}>Borç</th><th style={{ width: 140 }}>Alacak</th><th>Satır açıklaması</th><th style={{ width: 40 }} /></tr></thead>
            <tbody>{lines.map((l, i) => (
              <tr key={i}>
                <td><AccountSelect value={l.accountCode} onChange={v => setLine(i, { accountCode: v })} accounts={accounts.data!} /></td>
                <td><MoneyInput value={l.debit} onChange={v => setLine(i, { debit: v, credit: v ? '' : l.credit })} /></td>
                <td><MoneyInput value={l.credit} onChange={v => setLine(i, { credit: v, debit: v ? '' : l.debit })} /></td>
                <td><input className="input" value={l.description} onChange={e => setLine(i, { description: e.target.value })} maxLength={200} /></td>
                <td>{lines.length > 2 && <button className="btn sm ghost icon" title="Satırı sil" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}><Trash2 /></button>}</td>
              </tr>))}</tbody></table>
          <div><button className="btn sm" onClick={() => setLines(ls => [...ls, { accountCode: '', debit: '', credit: '', description: '' }])}><Plus /> Satır ekle</button></div>
          <ErrorBox error={save.error} />
        </div>
      )}
    </Modal>
  );
}

function GenerateModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { property } = useSession();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(property?.businessDate ?? '');
  const gen = useAction(async (key: string) => {
    const r = await post<{ created: number; days: number }>('/api/v1/accounting/generate', { from, to }, key);
    await qc.invalidateQueries({ queryKey: ['accounting'] });
    return r;
  }, { success: r => (r.created ? `${r.created} günün fişi oluşturuldu.` : 'Fişi eksik gün bulunamadı.') });
  return (
    <Modal title="Geçmiş günlerin gün sonu fişleri" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Kapat</button>
      <button className="btn primary" disabled={!from || !to || gen.busy} onClick={async () => { if (await gen.run() !== undefined) onClose(); }}>Oluştur</button></>}>
      <div className="stack">
        <div className="muted" style={{ fontSize: 12 }}>Muhasebe modülü kurulmadan önce gece denetimi yapılmış günler için fiş oluşturur. Fişi olan günlere dokunulmaz.</div>
        <div className="form-grid">
          <Field label="Başlangıç" required className="span-2"><input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} /></Field>
          <Field label="Bitiş" required className="span-2"><input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} /></Field>
        </div>
        <ErrorBox error={gen.error} />
      </div>
    </Modal>
  );
}

function AccountsTab() {
  const { can } = useSession();
  const accounts = useAccounts();
  const [edit, setEdit] = useState<GlAccount | 'new' | null>(null);
  const cols: Column<GlAccount>[] = [
    { key: 'code', header: 'Hesap', width: 110, render: a => <span className="mono" style={{ paddingLeft: (a.code.split('.').length - 1) * 14 }}>{a.code}</span> },
    { key: 'name', header: 'Hesap adı', filter: true, render: a => <>{a.name}{!a.isActive && <Badge color="gray">Pasif</Badge>}</> },
    { key: 'kind', header: 'Tür', width: 100, value: a => KIND[a.kind] },
    { key: 'debit', header: 'Toplam borç', align: 'right', width: 130, value: a => Number(a.debit), render: a => fmtMoney(a.debit) },
    { key: 'credit', header: 'Toplam alacak', align: 'right', width: 130, value: a => Number(a.credit), render: a => fmtMoney(a.credit) },
    { key: 'balance', header: 'Bakiye', align: 'right', width: 140, value: a => Number(a.debit) - Number(a.credit), render: a => { const b = Number(a.debit) - Number(a.credit); return b === 0 ? '' : `${fmtMoney(Math.abs(b).toFixed(2))} ${b > 0 ? 'B' : 'A'}`; } },
  ];
  return (
    <>
      <div className="toolbar">
        {can('accounting.manage') && <button className="btn primary" onClick={() => setEdit('new')}><Plus /> Hesap ekle</button>}
        <span className="muted" style={{ fontSize: 12 }}>Tek Düzen Hesap Planı. Alt hesapları mali müşavirinizin düzenine göre ekleyebilirsiniz.</span>
        <span className="count">{accounts.data?.length ?? 0} hesap</span>
      </div>
      {accounts.error ? <ErrorBox error={accounts.error} /> : (
        <DataTable rows={accounts.data ?? []} columns={cols} rowKey={a => a.code} onRowClick={a => can('accounting.manage') && setEdit(a)} maxHeight="calc(100vh - 290px)" empty={<Empty title="Hesap yok" />} />
      )}
      {edit && <AccountModal a={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function AccountModal({ a, onClose }: { a?: GlAccount; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: a?.code ?? '', name: a?.name ?? '', kind: a?.kind ?? 'revenue', isActive: a?.isActive ?? true });
  const save = useAction(async () => {
    if (a) await api('PUT', `/api/v1/accounting/accounts/${encodeURIComponent(a.code)}`, f); else await api('POST', '/api/v1/accounting/accounts', { ...f, code: f.code.trim() });
    await qc.invalidateQueries({ queryKey: ['accounting'] });
  }, { success: 'Hesap kaydedildi.' });
  return (
    <Modal title={a ? `Hesap · ${a.code}` : 'Yeni hesap'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!f.code.trim() || !f.name.trim() || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button></>}>
      <div className="form-grid">
        <Field label="Hesap kodu" required hint="ör. 600.05"><input className="input mono" value={f.code} disabled={!!a} onChange={e => setF(s => ({ ...s, code: e.target.value }))} autoFocus /></Field>
        <Field label="Hesap adı" required className="span-3"><input className="input" value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} /></Field>
        <Field label="Tür" className="span-2"><select className="input" value={f.kind} disabled={a?.isSystem} onChange={e => setF(s => ({ ...s, kind: e.target.value }))}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <div className="span-2" style={{ alignSelf: 'end' }}><label className="check"><input type="checkbox" checked={f.isActive} disabled={a?.isSystem} onChange={e => setF(s => ({ ...s, isActive: e.target.checked }))} /> Aktif</label></div>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function MappingsTab() {
  const { can } = useSession();
  const qc = useQueryClient();
  const accounts = useAccounts();
  const maps = useQuery({ queryKey: ['accounting', 'mappings'], queryFn: () => get<GlMapping[]>('/api/v1/accounting/mappings') });
  const codes = useQuery({ queryKey: ['accounting', 'codes'], queryFn: () => get<CodeAccount[]>('/api/v1/accounting/code-accounts') });
  const saveMap = useAction(async (_key: string, key: string, code: string) => { await api('PUT', `/api/v1/accounting/mappings/${key}`, { accountCode: code }); await qc.invalidateQueries({ queryKey: ['accounting'] }); }, { success: 'Eşleme kaydedildi.' });
  const saveCode = useAction(async (_key: string, id: string, code: string) => { await api('PUT', `/api/v1/accounting/code-accounts/${id}`, { accountCode: code || null }); await qc.invalidateQueries({ queryKey: ['accounting'] }); }, { success: 'İşlem kodu hesabı kaydedildi.' });
  if (!accounts.data || !maps.data || !codes.data) return <Spinner />;
  const editable = can('accounting.manage');
  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <div className="card"><div className="card-head"><h3>Otomatik fiş hesapları</h3></div><div className="card-body tight">
        <table className="dt"><tbody>{maps.data.map(m => (
          <tr key={m.key}><td>{MAPPING_LABEL[m.key] ?? m.key}</td>
            <td style={{ width: 280 }}>{editable ? <AccountSelect value={m.accountCode} accounts={accounts.data!} onChange={v => v && void saveMap.run(m.key, v)} /> : `${m.accountCode} · ${m.accountName}`}</td></tr>))}</tbody></table>
      </div></div>
      <div className="card"><div className="card-head"><h3>İşlem koduna özel gelir hesabı</h3></div><div className="card-body tight">
        <div className="muted" style={{ fontSize: 12, padding: '8px 12px' }}>Boş bırakılırsa işlem kodunun kategorisine ait eşleme kullanılır.</div>
        <table className="dt"><tbody>{codes.data.map(c => (
          <tr key={c.id}><td><span className="mono">{c.code}</span> · {c.name}</td>
            <td style={{ width: 280 }}>{editable ? <AccountSelect value={c.glAccount ?? ''} allowEmpty="Kategori eşlemesi" accounts={accounts.data!} onChange={v => void saveCode.run(c.id, v)} /> : c.glAccount ?? 'Kategori eşlemesi'}</td></tr>))}</tbody></table>
      </div></div>
      <ErrorBox error={saveMap.error ?? saveCode.error} />
    </div>
  );
}
