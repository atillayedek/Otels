import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { open, save } from '@tauri-apps/plugin-dialog';
import { ArrowLeft, CheckCircle2, Database, Download, FileUp, Play, RotateCcw, Save, ShieldAlert, Upload } from 'lucide-react';
import { api, download, get, qs, upload } from '../../lib/api';
import type { FieldMapping, ImportJob, InspectResponse, MappingProfile, Paged, SourceCapability, StagingRow, TargetField } from '../../lib/types';
import { fmtDateTime } from '../../lib/format';
import { PageHead, useAction } from '../../components/common';
import { Badge, DataTable, Empty, ErrorBox, Field, Modal, Spinner, Tabs, useConfirm, useToast, type Column } from '../../components/ui';

const ENTITIES: Record<string, string> = {
  guests: 'Misafirler', companies: 'Şirketler (cari kartlar)', agencies: 'Acenteler', room_types: 'Oda tipleri', rooms: 'Odalar',
  reservations: 'Rezervasyonlar', folio_history: 'Geçmiş folyo hareketleri', account_ledger: 'Cari hareketler (borç/alacak)',
};
const JOB_STATUS: Record<string, [string, string]> = {
  analyzed: ['İncelendi', 'blue'], staged: ['Hazırlandı', 'blue'], validated: ['Doğrulandı', 'teal'], importing: ['Aktarılıyor', 'violet'], completed: ['Tamamlandı', 'green'],
  completed_with_errors: ['Hatalarla tamamlandı', 'orange'], failed: ['Başarısız', 'red'], rolled_back: ['Geri alındı', 'gray'], cancelled: ['İptal', 'gray'],
};
const ROW_STATUS: Record<string, string> = { valid: 'Geçerli', invalid: 'Hatalı', needs_review: 'İnceleme bekliyor', imported: 'Aktarıldı', updated: 'Güncellendi', skipped: 'Atlandı', failed: 'Başarısız', pending: 'Bekliyor' };
const TRANSFORMS: Record<string, string> = { none: 'Olduğu gibi', fix_encoding: 'Türkçe karakter düzelt', upper: 'BÜYÜK HARF', lower: 'küçük harf', title: 'Baş Harfler Büyük', split_first: 'Ad soyaddan: ad', split_last: 'Ad soyaddan: soyad' };
const ENCODINGS = ['', 'utf-8', 'windows-1254', 'iso-8859-9'];
const DUP: Record<string, string> = { review: 'Mükerrerleri bana sor', skip: 'Mükerrerleri atla', update: 'Mevcut kaydı güncelle', create: 'Yine de yeni kayıt oluştur' };

/** Önerilen aktarım sırası: önce tanımlar, sonra kartlar, en son hareketler (eşleşmeler önceki adımlara dayanır). */
const ORDER: [string, string][] = [
  ['room_types', 'Oda tiplerinizi (Standart, Deluxe…) aktarın.'],
  ['rooms', 'Oda numaralarını ve oda tiplerini aktarın.'],
  ['companies', 'Anlaşmalı şirketleri, vergi numaralarıyla aktarın.'],
  ['agencies', 'Acenteleri, komisyon oranlarıyla aktarın.'],
  ['guests', 'Misafir kartlarını (T.C./pasaport, iletişim) aktarın.'],
  ['account_ledger', 'Şirket/acente cari borç-alacak hareketlerini aktarın.'],
  ['reservations', 'Gelecek tarihli rezervasyonları aktarın.'],
  ['folio_history', 'İsterseniz geçmiş folyo hareketlerini aktarın.'],
];

export default function ImportCenterPage() {
  const toast = useToast();
  const [jobId, setJobId] = useState<string | null>(null);
  const [inspect, setInspect] = useState<InspectResponse | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const jobs = useQuery({ queryKey: ['imports', 'list'], queryFn: () => get<ImportJob[]>('/api/v1/imports') });
  const done = (entity: string) => (jobs.data ?? []).filter(j => j.entity === entity && (j.status === 'completed' || j.status === 'completed_with_errors'));
  const template = async (entity: string) => {
    const path = await save({ defaultPath: `TSDMR-aktarim-sablonu-${entity}.xlsx`, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (!path) return;
    try { await download(`/api/v1/imports/template/${entity}`, path); toast.ok('Şablon kaydedildi.', path); } catch (e) { toast.error(e); }
  };

  if (jobId) return <JobView jobId={jobId} initial={inspect} onBack={() => { setJobId(null); setInspect(null); }} />;

  const cols: Column<ImportJob>[] = [
    { key: 'jobNo', header: 'No', width: 60 }, { key: 'createdAt', header: 'Tarih', width: 140, render: j => fmtDateTime(j.createdAt) },
    { key: 'entity', header: 'Veri', value: j => ENTITIES[j.entity] ?? j.entity }, { key: 'sourceLabel', header: 'Kaynak' },
    { key: 'status', header: 'Durum', width: 170, render: j => <Badge color={JOB_STATUS[j.status]?.[1]}>{JOB_STATUS[j.status]?.[0] ?? j.status}</Badge> },
    { key: 'totalRows', header: 'Satır', align: 'right', width: 80 }, { key: 'importedRows', header: 'Aktarılan', align: 'right', width: 90 },
    { key: 'updatedRows', header: 'Güncellenen', align: 'right', width: 100 }, { key: 'failedRows', header: 'Hatalı', align: 'right', width: 80 }, { key: 'createdBy', header: 'Kullanıcı', width: 110 },
  ];
  return (
    <div className="page">
      <PageHead title="Veri Aktarım Merkezi" sub="Eski otel programınızdaki (AmonRa, Elektra ve diğerleri) kayıtları adım adım aktarın" actions={<button className="btn primary" onClick={() => setStarting('guests')}><Upload /> Yeni aktarım</button>} />
      <div className="import-how">
        <div><b>1. Dışa aktarın</b><span>Eski programdan listeyi Excel veya CSV olarak alın. Alamıyorsanız aşağıdaki <b>şablonu</b> indirip doldurun ya da eski programın veritabanına salt okunur bağlanın.</span></div>
        <div><b>2. Eşleştirin</b><span>Dosyayı seçin; sütunlar otomatik eşleştirilir. Yanlış eşleşeni listeden düzeltin.</span></div>
        <div><b>3. Önizleyin ve aktarın</b><span>Hatalı ve mükerrer kayıtları görün, karar verin, aktarın. Sonuç beğenilmezse tek tıkla geri alınır.</span></div>
      </div>
      <div className="info-box" style={{ margin: '10px 0' }}>
        <ShieldAlert size={14} /> Eski programın verisi <b>değiştirilmez</b> (yalnız okunur). Her aktarımdan önce otomatik yedek alınır.
      </div>
      <div className="import-order">
        {ORDER.map(([entity, text], i) => {
          const d = done(entity);
          return (
            <div key={entity} className={`import-step ${d.length ? 'done' : ''}`}>
              <div className="import-no">{d.length ? <CheckCircle2 size={18} /> : i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}><b>{ENTITIES[entity]}</b><div className="muted" style={{ fontSize: 12 }}>{d.length ? `${d.reduce((s, j) => s + j.importedRows + j.updatedRows, 0)} kayıt aktarıldı` : text}</div></div>
              <button className="btn sm ghost" title="Boş Excel şablonu" onClick={() => void template(entity)}><Download /> Şablon</button>
              <button className={`btn sm ${d.length ? '' : 'primary'}`} onClick={() => setStarting(entity)}><Upload /> Aktar</button>
            </div>
          );
        })}
      </div>
      <h3 style={{ margin: '18px 0 8px' }}>Aktarım geçmişi</h3>
      <DataTable rows={jobs.data ?? []} columns={cols} rowKey={j => j.id} onRowClick={j => setJobId(j.id)} maxHeight="calc(100vh - 290px)" empty={<Empty icon={<FileUp />} title={jobs.isLoading ? 'Yükleniyor…' : 'Henüz aktarım yapılmadı.'} text="Yukarıdaki sıradan başlayın." />} />
      {starting && <StartModal initialEntity={starting} onClose={() => setStarting(null)} onStarted={r => { setStarting(null); setInspect(r); setJobId(r.job.id); }} />}
    </div>
  );
}

function StartModal({ initialEntity, onClose, onStarted }: { initialEntity: string; onClose: () => void; onStarted: (r: InspectResponse) => void }) {
  const caps = useQuery({ queryKey: ['imports', 'caps'], queryFn: () => get<{ sources: SourceCapability[] }>('/api/v1/imports/capabilities') });
  const [entity, setEntity] = useState(initialEntity);
  const [mode, setMode] = useState<'file' | 'db'>('file');
  const [db, setDb] = useState({ sourceType: 'sqlserver', host: '', port: '', database: '', username: '', password: '', dsn: '', filePath: '' });
  const go = useAction(async () => {
    if (mode === 'file') {
      const path = await open({ multiple: false, filters: [{ name: 'Veri dosyası', extensions: ['csv', 'txt', 'xlsx', 'xls', 'json', 'xml'] }] });
      if (!path || Array.isArray(path)) return undefined;
      return await upload<InspectResponse>('/api/v1/imports/file', path, { entity });
    }
    const n = (v: string) => (v.trim() ? v.trim() : null);
    return await api<InspectResponse>('POST', '/api/v1/imports/database', { entity, sourceType: db.sourceType, host: n(db.host), port: db.port ? Number(db.port) : null, database: n(db.database), username: n(db.username), password: db.password || null, dsn: n(db.dsn), filePath: n(db.filePath) });
  });
  const dbSources = caps.data?.sources.filter(s => ['postgresql', 'sqlserver', 'mysql', 'sqlite', 'odbc', 'access'].includes(s.type)) ?? [];
  const sel = dbSources.find(s => s.type === db.sourceType);
  const fileBased = db.sourceType === 'sqlite' || db.sourceType === 'access';
  return (
    <Modal title="Yeni veri aktarımı" size="lg" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={go.busy || (mode === 'db' && (!sel?.available || (fileBased ? !db.filePath : db.sourceType === 'odbc' ? !db.dsn : !db.host || !db.database)))}
        onClick={async () => { const r = await go.run(); if (r && typeof r === 'object') onStarted(r); }}>{go.busy ? 'Kaynak inceleniyor…' : mode === 'file' ? 'Dosya seç ve incele' : 'Bağlan ve incele'}</button>
    </>}>
      <div className="stack">
        <Field label="Aktarılacak veri"><select className="input" value={entity} onChange={e => setEntity(e.target.value)}>{Object.entries(ENTITIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <div className="info-box" style={{ fontSize: 12 }}>Önerilen sıra: oda tipleri → odalar → şirketler/acenteler → misafirler → cari hareketler → rezervasyonlar. Cari hareketler, ilgili şirket/acente kartı önceden aktarılmışsa eşleşir.</div>
        <div className="seg"><button className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')}><FileUp size={13} /> Dosyadan (Excel, CSV, JSON, XML)</button><button className={mode === 'db' ? 'active' : ''} onClick={() => setMode('db')}><Database size={13} /> Veritabanından (salt okunur)</button></div>
        {mode === 'file' ? <div className="muted">Eski programdan dışa aktardığınız dosyayı seçin. Türkçe karakter kodlaması (UTF-8, Windows-1254, ISO-8859-9) ve ayırıcı otomatik algılanır.</div> : (
          <div className="form-grid">
            <Field label="Veritabanı türü" className="span-2"><select className="input" value={db.sourceType} onChange={e => setDb(s => ({ ...s, sourceType: e.target.value }))}>{dbSources.map(s => <option key={s.type} value={s.type} disabled={!s.available}>{s.label}{!s.available ? ' (kullanılamıyor)' : ''}</option>)}</select></Field>
            <div className="span-2 muted" style={{ fontSize: 12, alignSelf: 'end' }}>{sel?.note}</div>
            {fileBased ? <Field label="Dosya yolu (sunucu bilgisayarında)" required className="span-4" hint="Örn. C:\AmonRa\Data\otel.mdb — dosya sunucu bilgisayarında bulunmalıdır"><input className="input" value={db.filePath} onChange={e => setDb(s => ({ ...s, filePath: e.target.value }))} /></Field>
              : db.sourceType === 'odbc' ? <Field label="ODBC veri kaynağı adı (DSN)" required className="span-2"><input className="input" value={db.dsn} onChange={e => setDb(s => ({ ...s, dsn: e.target.value }))} /></Field> : <>
                <Field label="Sunucu adresi" required className="span-2"><input className="input" value={db.host} onChange={e => setDb(s => ({ ...s, host: e.target.value }))} placeholder="Örn. 192.168.1.10\SQLEXPRESS" /></Field>
                <Field label="Port"><input className="input" value={db.port} onChange={e => setDb(s => ({ ...s, port: e.target.value.replace(/\D/g, '') }))} /></Field>
                <Field label="Veritabanı adı" required><input className="input" value={db.database} onChange={e => setDb(s => ({ ...s, database: e.target.value }))} /></Field>
              </>}
            {!fileBased && <>
              <Field label="Kullanıcı adı" className="span-2"><input className="input" value={db.username} onChange={e => setDb(s => ({ ...s, username: e.target.value }))} autoComplete="off" /></Field>
              <Field label="Parola" className="span-2"><input type="password" className="input" value={db.password} onChange={e => setDb(s => ({ ...s, password: e.target.value }))} autoComplete="new-password" /></Field>
            </>}
            <div className="span-4 muted" style={{ fontSize: 12 }}>Bağlantı bilgileri yalnız bu inceleme için kullanılır; diske veya kayıtlara yazılmaz. Mümkünse eski programda yalnız okuma yetkili bir kullanıcı kullanın.</div>
          </div>
        )}
        <ErrorBox error={go.error} />
      </div>
    </Modal>
  );
}

function JobView({ jobId, initial, onBack }: { jobId: string; initial: InspectResponse | null; onBack: () => void }) {
  const qc = useQueryClient();
  const job = useQuery({ queryKey: ['import', jobId], queryFn: () => get<ImportJob>(`/api/v1/imports/${jobId}`), refetchInterval: q => (q.state.data?.status === 'importing' ? 1000 : false) });
  const j = job.data;
  if (!j) return <div className="page"><Spinner /></div>;
  const step = ['analyzed'].includes(j.status) ? 'map' : ['staged', 'validated'].includes(j.status) ? 'review' : 'result';
  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <PageHead title={`Aktarım #${j.jobNo} · ${ENTITIES[j.entity] ?? j.entity}`} sub={<>{j.sourceLabel} · <Badge color={JOB_STATUS[j.status]?.[1]}>{JOB_STATUS[j.status]?.[0]}</Badge></>} actions={<button className="btn ghost" onClick={onBack}><ArrowLeft /> Aktarım listesi</button>} />
      <div className="wizard-steps">
        {[['map', '1. Kaynak ve eşleştirme'], ['review', '2. Önizleme ve inceleme'], ['result', '3. Aktarım ve rapor']].map(([k, l], i, all) => (
          <span key={k} className={k === step ? 'on' : all.findIndex(x => x[0] === step) > i ? 'done' : ''}>{l}</span>
        ))}
      </div>
      {step === 'map' && <MapStep job={j} initial={initial} onStaged={() => qc.invalidateQueries({ queryKey: ['import', jobId] })} />}
      {step === 'review' && <ReviewStep job={j} />}
      {step === 'result' && <ResultStep job={j} />}
    </div>
  );
}

function MapStep({ job, initial, onStaged }: { job: ImportJob; initial: InspectResponse | null; onStaged: () => void }) {
  const toast = useToast();
  const [ins, setIns] = useState<InspectResponse | null>(initial);
  const [opts, setOpts] = useState({ table: initial?.inspection.selectedTable ?? '', headerRow: 1, encoding: '', separator: '' });
  const [mapping, setMapping] = useState<Record<string, FieldMapping>>({});
  const [policy, setPolicy] = useState('review');
  const profiles = useQuery({ queryKey: ['imports', 'profiles', job.entity], queryFn: () => get<MappingProfile[]>(`/api/v1/import-profiles${qs({ entity: job.entity })}`) });

  const reinspect = useAction(async () => {
    const r = await api<InspectResponse>('POST', `/api/v1/imports/${job.id}/inspect`, { table: opts.table || null, headerRow: opts.headerRow, encoding: opts.encoding || null, separator: opts.separator || null });
    setIns(r);
    return r;
  });
  useEffect(() => { if (!ins) void reinspect.run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ins) return;
    const m: Record<string, FieldMapping> = {};
    for (const t of ins.targets) {
      const s = ins.suggestions.find(x => x.target === t.key);
      m[t.key] = { source: s?.source ?? null, target: t.key, transform: 'none', format: null, constant: null };
    }
    setMapping(m);
  }, [ins]);

  const stage = useAction(async () => {
    const list = Object.values(mapping).filter(m => m.source || m.constant);
    await api('POST', `/api/v1/imports/${job.id}/stage`, { source: { table: opts.table || null, headerRow: opts.headerRow, encoding: opts.encoding || null, separator: opts.separator || null }, mapping: list, duplicatePolicy: policy });
    onStaged();
  }, { success: 'Kayıtlar doğrulandı. Önizlemeyi kontrol edin.' });

  const [profileName, setProfileName] = useState<string | null>(null);
  const saveProfile = async (name: string) => {
    setProfileName(null);
    try { await api('POST', '/api/v1/import-profiles', { name, sourceType: job.sourceType, entity: job.entity, mapping: Object.values(mapping).filter(m => m.source || m.constant), options: { headerRow: opts.headerRow, encoding: opts.encoding || null, separator: opts.separator || null } }); toast.ok('Profil kaydedildi.'); }
    catch (e) { toast.error(e); }
  };
  const loadProfile = (id: string) => {
    const p = profiles.data?.find(x => x.id === id);
    if (!p) return;
    setMapping(m => { const n = { ...m }; for (const f of p.mapping) if (n[f.target]) n[f.target] = { ...f }; return n; });
  };

  if (!ins) return reinspect.error ? <ErrorBox error={reinspect.error} /> : <Spinner label="Kaynak inceleniyor…" />;
  const requiredMissing = ins.targets.filter(t => t.required && !mapping[t.key]?.source && !mapping[t.key]?.constant);
  const setM = (k: string, patch: Partial<FieldMapping>) => setMapping(m => ({ ...m, [k]: { ...m[k], ...patch } }));

  return (
    <div className="stack">
      <div className="card"><div className="card-head"><h3>Kaynak</h3></div><div className="card-body stack">
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          {ins.inspection.tables.length > 1 && <Field label="Tablo / sayfa"><select className="input" style={{ width: 240 }} value={opts.table} onChange={e => setOpts(s => ({ ...s, table: e.target.value }))}>{ins.inspection.tables.map(t => <option key={t.name} value={t.name}>{t.name}{t.rowCount != null ? ` (${t.rowCount})` : ''}</option>)}</select></Field>}
          <Field label="Başlık satırı"><input type="number" min={1} className="input" style={{ width: 90 }} value={opts.headerRow} onChange={e => setOpts(s => ({ ...s, headerRow: Number(e.target.value) || 1 }))} /></Field>
          {['csv', 'txt'].includes(job.sourceType) && <>
            <Field label="Karakter kodlaması"><select className="input" style={{ width: 170 }} value={opts.encoding} onChange={e => setOpts(s => ({ ...s, encoding: e.target.value }))}>{ENCODINGS.map(x => <option key={x} value={x}>{x || `Otomatik (${ins.inspection.detectedEncoding ?? '-'})`}</option>)}</select></Field>
            <Field label="Ayırıcı"><select className="input" style={{ width: 140 }} value={opts.separator} onChange={e => setOpts(s => ({ ...s, separator: e.target.value }))}><option value="">Otomatik ({ins.inspection.detectedSeparator === '\t' ? 'sekme' : ins.inspection.detectedSeparator ?? '-'})</option><option value=";">;</option><option value=",">,</option><option value={'\t'}>sekme</option><option value="|">|</option></select></Field>
          </>}
          <button className="btn" disabled={reinspect.busy} onClick={() => void reinspect.run()}>Yeniden incele</button>
        </div>
        {ins.inspection.warnings.map((w, i) => <div key={i} className="warn-box">{w}</div>)}
        {ins.inspection.mojibakeCells > 0 && <div className="warn-box">{ins.inspection.mojibakeCells} hücrede bozuk Türkçe karakter (Ã¼, Ä± gibi) görüldü. İlgili alanlarda "Türkçe karakter düzelt" dönüşümünü seçin veya kodlamayı değiştirin.</div>}
        <div className="table-wrap" style={{ maxHeight: 220 }}>
          <table className="dt"><thead><tr>{ins.inspection.columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{ins.inspection.preview.slice(0, 8).map((r, i) => <tr key={i}>{r.map((v, k) => <td key={k}>{v}</td>)}</tr>)}</tbody></table>
        </div>
      </div></div>

      <div className="card"><div className="card-head"><h3>Alan eşleştirme</h3><div className="right row">
        {(profiles.data?.length ?? 0) > 0 && <select className="input sm" defaultValue="" onChange={e => loadProfile(e.target.value)}><option value="" disabled>Profil yükle</option>{profiles.data!.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        <button className="btn sm" onClick={() => setProfileName('')}><Save /> Profil olarak kaydet</button>
      </div></div><div className="card-body tight">
        <table className="dt">
          <thead><tr><th>PMS alanı</th><th>Kaynak sütun</th><th>Dönüşüm</th><th>Biçim</th><th>Sabit değer</th><th>Örnek</th></tr></thead>
          <tbody>{ins.targets.map((t: TargetField) => {
            const m = mapping[t.key];
            const col = m?.source ? ins.inspection.columns.indexOf(m.source) : -1;
            const sugg = ins.suggestions.find(s => s.target === t.key);
            return (
              <tr key={t.key}>
                <td><b>{t.label}</b>{t.required && <span style={{ color: 'var(--danger)' }}> *</span>}<br /><span className="muted" style={{ fontSize: 11 }}>{t.type}{t.note ? ` · ${t.note}` : ''}</span></td>
                <td><select className="input sm" value={m?.source ?? ''} onChange={e => setM(t.key, { source: e.target.value || null })}><option value="">—</option>{ins.inspection.columns.map(c => <option key={c} value={c}>{c}</option>)}</select>
                  {sugg?.source && m?.source === sugg.source && <span className="muted" style={{ fontSize: 11 }}> öneri %{sugg.confidence}</span>}</td>
                <td><select className="input sm" value={m?.transform ?? 'none'} onChange={e => setM(t.key, { transform: e.target.value })}>{Object.entries(TRANSFORMS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                <td>{['date', 'decimal'].includes(t.type) && <input className="input sm" style={{ width: 110 }} placeholder={t.type === 'date' ? 'dd.MM.yyyy' : 'tr / en'} value={m?.format ?? ''} onChange={e => setM(t.key, { format: e.target.value || null })} />}</td>
                <td><input className="input sm" style={{ width: 120 }} value={m?.constant ?? ''} onChange={e => setM(t.key, { constant: e.target.value || null })} /></td>
                <td className="muted" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{col >= 0 ? ins.inspection.preview[0]?.[col] : m?.constant}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div></div>

      <div className="card"><div className="card-body row wrap">
        <Field label="Mükerrer kayıtlar"><select className="input" style={{ width: 240 }} value={policy} onChange={e => setPolicy(e.target.value)}>{Object.entries(DUP).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <span className="spacer" />
        {requiredMissing.length > 0 && <span className="muted">Zorunlu alanlar eşleştirilmeli: {requiredMissing.map(t => t.label).join(', ')}</span>}
        <button className="btn primary" disabled={requiredMissing.length > 0 || stage.busy} onClick={() => void stage.run()}><Play /> {stage.busy ? 'Doğrulanıyor…' : 'Doğrula ve önizle'}</button>
      </div></div>
      <ErrorBox error={stage.error} />
      {profileName !== null && (
        <Modal title="Eşleştirme profili" onClose={() => setProfileName(null)} footer={<><button className="btn" onClick={() => setProfileName(null)}>Vazgeç</button><button className="btn primary" disabled={!profileName.trim()} onClick={() => void saveProfile(profileName.trim())}>Kaydet</button></>}>
          <Field label="Profil adı" hint="Aynı programdan sonraki aktarımlarda bu eşleştirmeyi tek tıkla yükleyebilirsiniz."><input className="input" value={profileName} onChange={e => setProfileName(e.target.value)} autoFocus placeholder="Örn. AmonRa misafir listesi" /></Field>
        </Modal>
      )}
    </div>
  );
}

function ReviewStep({ job }: { job: ImportJob }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState(job.reviewRows > 0 ? 'needs_review' : job.failedRows > 0 ? 'invalid' : '');
  const [page, setPage] = useState(1);
  const rows = useQuery({ queryKey: ['import', job.id, 'rows', status, page], queryFn: () => get<Paged<StagingRow>>(`/api/v1/imports/${job.id}/rows${qs({ status, page, pageSize: 100 })}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['import', job.id] });
  const decide = async (rowNo: number | null, decision: string) => {
    try {
      if (rowNo === null) await api('POST', `/api/v1/imports/${job.id}/decisions`, { decision, rowNos: null });
      else await api('POST', `/api/v1/imports/${job.id}/rows/${rowNo}/decision`, { decision });
      await refresh();
    } catch (e) { toast.error(e); }
  };
  const exec = useAction(async () => { await api('POST', `/api/v1/imports/${job.id}/execute`); await refresh(); }, { success: 'Aktarım başladı.' });
  const cancel = async () => {
    if (!await confirm({ title: 'Aktarımı iptal et', message: 'Hazırlanan aktarım iptal edilecek. PMS verisine dokunulmaz.', confirmText: 'İptal et' })) return;
    try { await api('POST', `/api/v1/imports/${job.id}/cancel`); await refresh(); } catch (e) { toast.error(e); }
  };
  const csv = async () => {
    const p = await save({ defaultPath: `aktarim-${job.jobNo}-hatalar.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (p) { try { await download(`/api/v1/imports/${job.id}/errors.csv`, p); toast.ok('Hata listesi kaydedildi.'); } catch (e) { toast.error(e); } }
  };
  const columns = useMemo<Column<StagingRow>[]>(() => {
    const keys = Object.keys(rows.data?.items[0]?.mapped ?? {}).slice(0, 6);
    return [
      { key: 'rowNo', header: 'Satır', width: 60 },
      { key: 'status', header: 'Durum', width: 140, render: r => <Badge color={r.status === 'valid' ? 'green' : r.status === 'invalid' ? 'red' : 'orange'}>{ROW_STATUS[r.status] ?? r.status}</Badge> },
      ...keys.map(k => ({ key: k, header: k, value: (r: StagingRow) => r.mapped?.[k] ?? '' })),
      { key: 'dup', header: 'Mükerrer', value: r => (r.duplicateOf ? `%${r.duplicateScore} · ${r.duplicateReason ?? ''}` : '') },
      { key: 'errors', header: 'Hata', render: r => <span style={{ color: 'var(--danger)' }}>{r.errors}</span> },
      { key: 'decision', header: 'Karar', width: 230, render: r => r.status === 'needs_review' ? (
        <div className="row">{(['skip', 'create', ...(r.duplicateOf ? ['update'] : [])] as const).map(d => (
          <button key={d} className={`btn sm ${r.reviewDecision === d ? 'primary' : ''}`} onClick={() => void decide(r.rowNo, d)}>{d === 'skip' ? 'Atla' : d === 'create' ? 'Yeni' : 'Güncelle'}</button>))}</div>
      ) : null },
    ];
  }, [rows.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const undecided = job.reviewRows;
  return (
    <div className="stack">
      <div className="grid cols-6">
        {[['Toplam', job.totalRows], ['Geçerli', job.validRows], ['İnceleme', job.reviewRows], ['Mükerrer', job.duplicateRows], ['Hatalı', job.failedRows], ['Atlanacak', job.skippedRows]].map(([l, v]) => (
          <div key={l as string} className="card"><div className="kpi"><div className="label">{l}</div><div className="value" style={{ fontSize: 24 }}>{v}</div></div></div>
        ))}
      </div>
      <div className="row wrap">
        <Tabs value={status} onChange={v => { setStatus(v); setPage(1); }} items={[{ key: '', label: 'Tümü' }, { key: 'needs_review', label: 'İnceleme' }, { key: 'invalid', label: 'Hatalı' }, { key: 'valid', label: 'Geçerli' }, { key: 'skipped', label: 'Atlanacak' }]} />
        <span className="spacer" />
        {job.reviewRows > 0 && <><button className="btn sm" onClick={() => void decide(null, 'skip')}>Kalan incelemeleri atla</button><button className="btn sm" onClick={() => void decide(null, 'update')}>Kalanları güncelle</button></>}
        {job.failedRows > 0 && <button className="btn sm" onClick={() => void csv()}>Hata listesini indir (CSV)</button>}
      </div>
      <DataTable rows={rows.data?.items ?? []} columns={columns} rowKey={r => String(r.rowNo)} maxHeight="calc(100vh - 430px)" empty={<Empty title={rows.isLoading ? 'Yükleniyor…' : 'Bu grupta satır yok'} />} />
      {rows.data && rows.data.total > 100 && <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Önceki</button><span className="muted">{page}</span><button className="btn sm" disabled={page * 100 >= rows.data.total} onClick={() => setPage(p => p + 1)}>Sonraki</button></div>}
      <div className="card"><div className="card-body row wrap">
        <span className="muted">Aktarım başlamadan önce PMS veritabanının yedeği otomatik alınır. Hatalı satırlar aktarılmaz.</span>
        <span className="spacer" />
        <button className="btn" onClick={() => void cancel()}>Aktarımı iptal et</button>
        <button className="btn primary" disabled={undecided > 0 || exec.busy || job.validRows + job.reviewRows === 0} title={undecided > 0 ? 'İnceleme bekleyen satırlar için karar verin' : ''} onClick={() => void exec.run()}><Play /> Aktarımı başlat</button>
      </div></div>
      <ErrorBox error={exec.error} />
    </div>
  );
}

interface Report { entities: { table: string; action: string; count: number }[]; statuses: { status: string; count: number }[]; topErrors: { reason: string; count: number }[]; durationSeconds?: number }

function ResultStep({ job }: { job: ImportJob }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const rep = useQuery({ queryKey: ['import', job.id, 'report', job.status], queryFn: () => get<Report>(`/api/v1/imports/${job.id}/report`), enabled: job.status !== 'importing' });
  const rollback = async () => {
    if (!await confirm({ title: 'Aktarımı geri al', message: 'Bu aktarımla eklenen kayıtlar kaldırılacak, güncellenen kayıtlar eski hâline döndürülecek. Aktarımdan sonra değiştirilmiş veya başka kayıtlarca kullanılan kayıtlar varsa geri alma engellenir.', confirmText: 'Geri al', danger: true, requireText: 'GERİ AL' })) return;
    try { await api('POST', `/api/v1/imports/${job.id}/rollback`); toast.ok('Aktarım geri alındı.'); await qc.invalidateQueries({ queryKey: ['import', job.id] }); await qc.invalidateQueries({ queryKey: ['imports'] }); } catch (e) { toast.error(e); }
  };
  const purge = async () => {
    if (!await confirm({ title: 'Ham veriyi temizle', message: 'Aktarım için saklanan ham kaynak satırları (kişisel veri) silinecek. Özet sayılar ve aktarılan kayıtlar korunur.', confirmText: 'Temizle' })) return;
    try { await api('POST', `/api/v1/imports/${job.id}/purge`); toast.ok('Ham veri temizlendi.'); } catch (e) { toast.error(e); }
  };
  if (job.status === 'importing') return <div className="card"><Spinner label={`Aktarılıyor… ${job.importedRows + job.updatedRows} / ${job.validRows} satır`} /></div>;
  return (
    <div className="stack">
      <div className={job.status === 'completed' ? 'ok-box' : job.status === 'rolled_back' ? 'info-box' : 'warn-box'}>
        <b>{JOB_STATUS[job.status]?.[0]}</b> · {job.importedRows} kayıt eklendi, {job.updatedRows} güncellendi, {job.skippedRows} atlandı, {job.failedRows} hatalı.
        {rep.data?.durationSeconds != null && ` Süre ${Math.round(rep.data.durationSeconds)} sn.`}{job.error && ` ${job.error}`}
      </div>
      <div className="grid cols-2">
        <div className="card"><div className="card-head"><h3>Kayıtlar</h3></div><div className="card-body">
          <ul className="list-plain">{rep.data?.entities.map(e => <li key={e.table + e.action}><span>{e.table}</span><span className="muted">{e.action === 'insert' ? 'eklendi' : e.action === 'update' ? 'güncellendi' : e.action}</span><span className="spacer" /><b>{e.count}</b></li>)}</ul>
          {rep.data?.entities.length === 0 && <Empty title="Kayıt yok" />}
        </div></div>
        <div className="card"><div className="card-head"><h3>En sık hatalar</h3></div><div className="card-body">
          <ul className="list-plain">{rep.data?.topErrors.map(e => <li key={e.reason}><span>{e.reason}</span><span className="spacer" /><b>{e.count}</b></li>)}</ul>
          {rep.data?.topErrors.length === 0 && <Empty title="Hata yok" />}
        </div></div>
      </div>
      <div className="row">
        {['completed', 'completed_with_errors'].includes(job.status) && <button className="btn danger" onClick={() => void rollback()}><RotateCcw /> Aktarımı geri al</button>}
        <button className="btn" onClick={() => void purge()}>Ham kaynak verisini temizle</button>
      </div>
    </div>
  );
}
