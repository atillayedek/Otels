import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { save } from '@tauri-apps/plugin-dialog';
import { FileSpreadsheet, FileText, Play, Printer } from 'lucide-react';
import { download, get, qs } from '../lib/api';
import type { ReportInfo, ReportResult } from '../lib/types';

interface GlAccount { code: string; name: string; isActive: boolean }
import { addDays, fmtDate, fmtDateTime, fmtMoney } from '../lib/format';
import { useSession } from '../lib/session';
import { PageHead } from '../components/common';
import { Empty, ErrorBox, Field, Spinner, useToast } from '../components/ui';

function cellText(v: unknown, type: string) {
  if (v === null || v === undefined || v === '') return '';
  if (type === 'money') return fmtMoney(String(v));
  if (type === 'date') return fmtDate(String(v));
  if (type === 'datetime') return fmtDateTime(String(v));
  if (type === 'bool') return v ? 'Evet' : 'Hayır';
  if (type === 'decimal') return String(v).replace('.', ',');
  return String(v);
}

export default function ReportsPage() {
  const { name } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { property } = useSession();
  const bd = property?.businessDate ?? '';
  const defs = useQuery({ queryKey: ['reports', 'defs'], queryFn: () => get<ReportInfo[]>('/api/v1/reports') });
  const def = defs.data?.find(d => d.name === name);
  const [params, setParams] = useState<Record<string, string>>({});
  const [runKey, setRunKey] = useState(0);
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!def) return;
    const p: Record<string, string> = {};
    for (const x of def.params) p[x.key] = x.key === 'from' ? addDays(bd, -6) : x.key === 'to' || x.key === 'date' ? bd : '';
    setParams(p);
    setRunKey(1);
  }, [def, bd]);
  const query = qs(params);
  // Zorunlu (tarih dışı) alan boşken rapor çalıştırılmaz; kullanıcıya ne seçmesi gerektiği gösterilir.
  const missing = def?.params.filter(p => p.required && p.type !== 'date' && !params[p.key]?.trim()) ?? [];
  const result = useQuery({ queryKey: ['report', name, query, runKey], queryFn: () => get<ReportResult>(`/api/v1/reports/${name}${query}`), enabled: !!def && runKey > 0 && missing.length === 0 });
  const needsAccounts = def?.params.some(p => p.type === 'account') ?? false;
  const accounts = useQuery({ queryKey: ['accounting', 'accounts'], queryFn: () => get<GlAccount[]>('/api/v1/accounting/accounts'), enabled: needsAccounts });

  const grouped = useMemo(() => {
    const m = new Map<string, ReportInfo[]>();
    for (const d of defs.data ?? []) { if (!m.has(d.category)) m.set(d.category, []); m.get(d.category)!.push(d); }
    return [...m.entries()];
  }, [defs.data]);

  const exportAs = async (format: 'xlsx' | 'csv') => {
    const path = await save({ defaultPath: `${name}-${bd}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    if (!path) return;
    try { await download(`/api/v1/reports/${name}/export${qs({ ...params, format })}`, path); toast.ok('Rapor kaydedildi.', path); } catch (e) { toast.error(e); }
  };

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <PageHead title={def?.title ?? 'Raporlar'} />
      <div className="split wide">
        <div className="card"><div className="card-body tight">
          {defs.isLoading ? <Spinner /> : grouped.map(([cat, list]) => (
            <div key={cat} style={{ marginBottom: 8 }}>
              <div className="section-title" style={{ padding: '8px 12px 4px' }}>{cat}</div>
              {list.map(d => <button key={d.name} className="btn ghost" style={{ width: '100%', justifyContent: 'flex-start', ...(d.name === name ? { background: 'var(--primary-50)', color: 'var(--primary)', fontWeight: 600 } : {}) }} onClick={() => nav(`/reports/${d.name}`)}><FileText /> {d.title}</button>)}
            </div>
          ))}
        </div></div>
        <div className="stack">
          {!def ? <div className="card"><Empty icon={<FileText />} title="Soldan bir rapor seçin" text="Raporlar ekranda görüntülenir, yazdırılır veya Excel/CSV olarak kaydedilir." /></div> : (
            <>
              <div className="card"><div className="card-body row wrap" style={{ alignItems: 'flex-end' }}>
                {def.params.map(p => (
                  <Field key={p.key} label={p.label} required={p.required}>
                    {p.type === 'account'
                      ? <select className="input" style={{ width: 280 }} value={params[p.key] ?? ''} onChange={e => { const v = e.target.value; setParams(s => ({ ...s, [p.key]: v })); setRunKey(k => k + 1); }}>
                          <option value="">Hesap seçin</option>
                          {accounts.data?.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                        </select>
                      : <input type={p.type === 'date' ? 'date' : 'text'} className="input" style={{ width: 160 }} value={params[p.key] ?? ''} onChange={e => setParams(s => ({ ...s, [p.key]: e.target.value }))} />}
                  </Field>
                ))}
                <button className="btn primary" disabled={missing.length > 0} onClick={() => setRunKey(k => k + 1)}><Play /> Çalıştır</button>
                <span className="spacer" />
                <button className="btn" disabled={!result.data} onClick={() => { setPrinting(true); setTimeout(() => { window.print(); setPrinting(false); }, 50); }}><Printer /> Yazdır</button>
                <button className="btn" onClick={() => void exportAs('xlsx')}><FileSpreadsheet /> Excel</button>
                <button className="btn" onClick={() => void exportAs('csv')}>CSV</button>
              </div></div>
              {missing.length > 0 ? <div className="card"><Empty icon={<FileText />} title={`${missing.map(m => m.label).join(', ')} seçin`} text="Rapor, seçiminizden sonra hazırlanır." /></div>
                : result.isFetching ? <Spinner label="Rapor hazırlanıyor…" /> : result.error ? <ErrorBox error={result.error} /> : result.data && (
                <ReportTable r={result.data} />
              )}
            </>
          )}
        </div>
      </div>
      {printing && result.data && createPortal(
        <div className="doc">
          <div className="doc-head"><div><h1>{result.data.title}</h1><div>{property?.name}</div></div><div style={{ textAlign: 'right' }}>{Object.entries(params).filter(([, v]) => v).map(([k, v]) => <div key={k}>{def?.params.find(p => p.key === k)?.label}: {def?.params.find(p => p.key === k)?.type === 'date' ? fmtDate(v) : def?.params.find(p => p.key === k)?.type === 'account' ? `${v} ${accounts.data?.find(a => a.code === v)?.name ?? ''}` : v}</div>)}<div>Oluşturma: {fmtDateTime(result.data.generatedAt)}</div></div></div>
          <ReportTable r={result.data} print />
        </div>, document.getElementById('print-root')!)}
    </div>
  );
}

function ReportTable({ r, print }: { r: ReportResult; print?: boolean }) {
  const right = (t: string) => ['money', 'int', 'decimal'].includes(t);
  const table = (
    <table className={print ? '' : 'dt'}>
      <thead><tr>{r.columns.map(c => <th key={c.key} style={{ textAlign: right(c.type) ? 'right' : undefined }}>{c.header}</th>)}</tr></thead>
      <tbody>{r.rows.map((row, i) => <tr key={i}>{r.columns.map(c => <td key={c.key} className={right(c.type) ? 'num r' : ''}>{cellText(row[c.key], c.type)}</td>)}</tr>)}</tbody>
      {Object.keys(r.totals ?? {}).length > 0 && <tfoot><tr>{r.columns.map((c, i) => <td key={c.key} className={right(c.type) ? 'num r' : ''}><b>{i === 0 && r.totals[c.key] === undefined ? 'Toplam' : cellText(r.totals[c.key], c.type)}</b></td>)}</tr></tfoot>}
    </table>
  );
  if (print) return table;
  return (
    <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 280px)' }}>
      {table}
      {r.rows.length === 0 && <Empty title="Seçilen ölçütlere uyan kayıt bulunmuyor" />}
    </div>
  );
}
