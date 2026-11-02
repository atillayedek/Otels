import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { save } from '@tauri-apps/plugin-dialog';
import { Bookmark, Columns3, FileSpreadsheet, FileText, Filter, Play, Printer, Trash2 } from 'lucide-react';
import { download, get, qs } from '../lib/api';
import type { ReportInfo, ReportResult } from '../lib/types';

interface GlAccount { code: string; name: string; isActive: boolean }
import { addDays, fmtDate, fmtDateTime, fmtMoney } from '../lib/format';
import { useSession } from '../lib/session';
import { PageHead } from '../components/common';
import { DocFooter, DocHeader } from '../components/PrintDoc';
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
  // Gösterilecek sütunlar (rapor başına bu bilgisayarda hatırlanır) ve sütun bazında arama (AmonRa'daki gibi).
  const colKey = `pms-report-cols-${name}`;
  const [hidden, setHidden] = useState<string[]>([]);
  const [colMenu, setColMenu] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  useEffect(() => {
    try { setHidden(JSON.parse(localStorage.getItem(colKey) ?? '[]')); } catch { setHidden([]); }
    setFilters({}); setColMenu(false);
  }, [colKey]);
  // Kayıtlı görünümler: tarih dışındaki parametreler (firma, hesap vb.), gizlenen sütunlar ve sütun aramaları bir adla saklanır.
  // Tarihler kaydedilmez; görünüm açıldığında güncel iş gününe göre kalır.
  type Preset = { name: string; params: Record<string, string>; hidden: string[]; filters: Record<string, string> };
  const presetKey = `pms-report-presets-${name}`;
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState<string | null>(null);
  useEffect(() => { try { setPresets(JSON.parse(localStorage.getItem(presetKey) ?? '[]')); } catch { setPresets([]); } }, [presetKey]);
  const storePresets = (next: Preset[]) => { setPresets(next); try { localStorage.setItem(presetKey, JSON.stringify(next)); } catch { /* depolama kapalı */ } };
  const savePreset = () => {
    const n = presetName?.trim(); if (!n || !def) return;
    const keep = Object.fromEntries(Object.entries(params).filter(([k]) => def.params.find(x => x.key === k)?.type !== 'date'));
    storePresets([...presets.filter(x => x.name !== n), { name: n, params: keep, hidden, filters }]);
    setPresetName(null); toast.ok(`"${n}" görünümü kaydedildi.`);
  };
  const applyPreset = (n: string) => {
    const x = presets.find(p => p.name === n); if (!x) return;
    setParams(s => ({ ...s, ...x.params })); setHidden(x.hidden);
    try { localStorage.setItem(colKey, JSON.stringify(x.hidden)); } catch { /* yok say */ }
    setFilters(x.filters ?? {}); setShowFilters(Object.values(x.filters ?? {}).some(Boolean)); setRunKey(k => k + 1);
  };
  const toggleCol = (k: string) => setHidden(h => {
    const next = h.includes(k) ? h.filter(x => x !== k) : [...h, k];
    try { localStorage.setItem(colKey, JSON.stringify(next)); } catch { /* tarayıcı depolaması kapalı olabilir */ }
    return next;
  });
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

  // Polis (KBS) toplu konaklayan Excel'i: KBS'nin kendi şablonu doldurulur; KBS ekranında "Toplu Konaklayan Ekle" ile yüklenir.
  const exportPolice = async () => {
    const path = await save({ defaultPath: `KBS-Toplu-Konaklayan-${params.arrival || bd}.xlsx`, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (!path) return;
    try { await download(`/api/v1/reports/kbs-guests/police-xlsx${qs({ arrival: params.arrival || null })}`, path); toast.ok('Polis Excel dosyası kaydedildi. KBS ekranında "Toplu Konaklayan Ekle" ile yükleyin.', path); } catch (e) { toast.error(e); }
  };
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
                <button className="btn" disabled={!result.data} onClick={() => {
                  setPrinting(true);
                  // Yatay raporlar (ör. polis listesi) A4 yatay basılır; sayfa yönü yalnız bu yazdırma için değişir.
                  const page = def.landscape ? Object.assign(document.createElement('style'), { textContent: '@page { size: A4 landscape; margin: 0; }' }) : null;
                  if (page) document.head.appendChild(page);
                  setTimeout(() => { window.print(); page?.remove(); setPrinting(false); }, 50);
                }}><Printer /> Yazdır{def.landscape ? ' (yatay)' : ''}</button>
                {name === 'kbs-guests' && <button className="btn primary" onClick={() => void exportPolice()}><FileSpreadsheet /> Polis Excel'i indir</button>}
                <span style={{ position: 'relative' }}>
                  <button className="btn" disabled={!result.data} onClick={() => setColMenu(m => !m)} title="Gösterilecek bilgileri seç"><Columns3 /> Sütunlar{hidden.length ? ` (${(result.data?.columns.length ?? 0) - hidden.length})` : ''}</button>
                  {colMenu && result.data && <>
                    <div className="ql-backdrop" onMouseDown={() => setColMenu(false)} />
                    <div className="col-menu">
                      <div className="col-menu-head"><b>Gösterilecek bilgiler</b>
                        <button className="btn sm ghost" onClick={() => { setHidden([]); try { localStorage.removeItem(colKey); } catch { /* yok say */ } }}>Tümü</button></div>
                      <div className="col-menu-list">{result.data.columns.map(c => (
                        <label key={c.key} className="check"><input type="checkbox" checked={!hidden.includes(c.key)} onChange={() => toggleCol(c.key)} /> {c.header}</label>
                      ))}</div>
                    </div>
                  </>}
                </span>
                <button className={`btn ${showFilters ? 'active' : ''}`} disabled={!result.data} onClick={() => { setShowFilters(f => !f); setFilters({}); }} title="Sütunlarda ara"><Filter /> Ara</button>
                {presets.length > 0 && <select className="input" style={{ width: 170 }} value="" onChange={e => { if (e.target.value) applyPreset(e.target.value); }} title="Kayıtlı görünüm">
                  <option value="">Kayıtlı görünümler…</option>{presets.map(x => <option key={x.name} value={x.name}>{x.name}</option>)}
                </select>}
                {presetName === null
                  ? <button className="btn" onClick={() => setPresetName('')} title="Süzgeç, sütun ve aramaları bir adla kaydet"><Bookmark /> Görünümü kaydet</button>
                  : <span className="row" style={{ gap: 4 }}>
                      <input className="input" style={{ width: 150 }} autoFocus placeholder="Görünüm adı" value={presetName} onChange={e => setPresetName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') savePreset(); if (e.key === 'Escape') setPresetName(null); }} />
                      <button className="btn primary sm" disabled={!presetName.trim()} onClick={savePreset}>Kaydet</button>
                      {presets.some(x => x.name === presetName.trim()) && <button className="btn sm danger" title="Bu adlı görünümü sil" onClick={() => { storePresets(presets.filter(x => x.name !== presetName.trim())); setPresetName(null); }}><Trash2 /></button>}
                      <button className="btn sm ghost" onClick={() => setPresetName(null)}>Vazgeç</button>
                    </span>}
                <button className="btn" onClick={() => void exportAs('xlsx')}><FileSpreadsheet /> Excel</button>
                <button className="btn" onClick={() => void exportAs('csv')}>CSV</button>
              </div></div>
              {name === 'kbs-guests' && (
                <div className="info-box" style={{ fontSize: 13 }}>
                  <b>Polis Excel'i indir</b> düğmesi, Emniyet KBS'nin <b>Toplu Konaklayan Ekle</b> şablonunu bu listedeki kişilerle doldurur; dosyayı KBS ekranından yükleyin, tek tek girmeniz gerekmez.
                  Tarih boşsa şu an konaklayanların hepsi, tarih seçilirse o gün giriş yapanlar yazılır. <b>Eksik bilgi</b> sütununda yazanlar dosyada boş kalır; misafir kartından tamamlayın.
                  KKTC uyruklu misafirlerin uyruğu (kod 2) dosyada elle seçilmelidir.
                </div>)}
              {name === 'police-list' && (
                <div className="info-box" style={{ fontSize: 13 }}>
                  Polis listesi ana ve ek misafirlerin hepsini kimlik ve aile bilgileriyle yatay A4 olarak basar. Emniyet'e (KBS) yüklenecek Excel dosyası ayrı rapordur: <b>KBS Toplu Konaklayan Excel'i</b>.
                </div>)}
              {missing.length > 0 ? <div className="card"><Empty icon={<FileText />} title={`${missing.map(m => m.label).join(', ')} seçin`} text="Rapor, seçiminizden sonra hazırlanır." /></div>
                : result.isFetching ? <Spinner label="Rapor hazırlanıyor…" /> : result.error ? <ErrorBox error={result.error} /> : result.data && (
                <ReportTable r={result.data} hidden={hidden} filters={showFilters ? filters : undefined} onFilter={(k, v) => setFilters(f => ({ ...f, [k]: v }))} />
              )}
            </>
          )}
        </div>
      </div>
      {printing && result.data && createPortal(
        <div className={`doc folio-doc report-doc ${result.data.columns.length > 7 ? 'dense' : ''} ${def?.landscape ? 'landscape' : ''}`}>
          <DocHeader kind={def?.category ?? 'Rapor'} no={result.data.title} lines={[
            ...Object.entries(params).filter(([, v]) => v).map(([k, v]) => {
              const p = def?.params.find(x => x.key === k);
              return `${p?.label}: ${p?.type === 'date' ? fmtDate(v) : p?.type === 'account' ? `${v} ${accounts.data?.find(a => a.code === v)?.name ?? ''}` : v}`;
            }),
            `Oluşturma: ${fmtDateTime(result.data.generatedAt)}`]} />
          <ReportTable r={result.data} print hidden={hidden} filters={showFilters ? filters : undefined} />
          <DocFooter note={`${result.data.rows.length} kayıt.`} />
        </div>, document.getElementById('print-root')!)}
    </div>
  );
}

function ReportTable({ r, print, hidden = [], filters, onFilter }: {
  r: ReportResult; print?: boolean; hidden?: string[]; filters?: Record<string, string>; onFilter?: (key: string, value: string) => void;
}) {
  const right = (t: string) => ['money', 'int', 'decimal'].includes(t);
  const cols = r.columns.filter(c => !hidden.includes(c.key));
  const lc = (x: string) => x.toLocaleLowerCase('tr-TR');
  const active = Object.entries(filters ?? {}).filter(([, v]) => v.trim());
  const rows = active.length ? r.rows.filter(row => active.every(([k, v]) => lc(cellText(row[k], r.columns.find(c => c.key === k)?.type ?? 'text')).includes(lc(v.trim())))) : r.rows;
  const table = (
    <table className={print ? 'fd-table' : 'dt'}>
      <thead>
        <tr>{cols.map(c => <th key={c.key} style={{ textAlign: right(c.type) ? 'right' : undefined }}>{c.header}</th>)}</tr>
        {filters && !print && <tr className="col-filters">{cols.map(c => <th key={c.key}><input className="input sm" placeholder="Ara…" value={filters[c.key] ?? ''} onChange={e => onFilter?.(c.key, e.target.value)} /></th>)}</tr>}
      </thead>
      <tbody>{rows.map((row, i) => <tr key={i}>{cols.map(c => <td key={c.key} className={right(c.type) ? 'num r' : ''}>{cellText(row[c.key], c.type)}</td>)}</tr>)}</tbody>
      {!active.length && Object.keys(r.totals ?? {}).length > 0 && <tfoot><tr>{cols.map((c, i) => <td key={c.key} className={right(c.type) ? 'num r' : ''}><b>{i === 0 && r.totals[c.key] === undefined ? 'Toplam' : cellText(r.totals[c.key], c.type)}</b></td>)}</tr></tfoot>}
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
