import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { AlertTriangle, ArrowLeft, ArrowRight, BedDouble, CheckCircle2, Database, FileSpreadsheet, FileText, ListChecks, Moon, Wallet, XCircle } from 'lucide-react';
import { api, download, get, post } from '../lib/api';
import { useSessionState } from '../lib/sessionState';
import type { NightAuditPreview, NightAuditResult, ReportResult, Setting } from '../lib/types';
import { fmtDate, fmtDateTime, fmtMoney, fmtQty } from '../lib/format';
import { useSession } from '../lib/session';
import { Kv, PageHead, useAction } from '../components/common';
import { useOpenReservation } from '../components/Windows';
import { Empty, ErrorBox, Spinner, useConfirm, useToast } from '../components/ui';

interface PendingCharge { reservationId: string; reservationNumber: string; room: string; guest: string; rate: string; rateCurrency?: string; fxAmount?: string }
interface RoomChargeStep { businessDate: string; pending: PendingCharge[]; postedCount: number; postedTotal: string }

/** Gün sonu adımları: sırayla ilerlenir, "Bir adım geri" ile önceki adıma dönülür. Devir (7) yapılmadan iş günü değişmez. */
const STEPS = ['Devir öncesi kontroller', 'Oda ücretlerini bas', 'Folyo bakiyeleri', 'Yedekleme', 'Gün sonu raporları', 'Raporları kaydet', 'Gün sonu devri', 'Yeni gün listeleri'];
// Gün sonu raporları (5. ve 6. adım): kapatılan günün tarihiyle açılır / kaydedilir. Kullanıcının yetkisi olmayanlar listelenmez.
const DAY_REPORTS: { name: string; title: string; perm: string; params: 'range' | 'date' | 'none' }[] = [
  { name: 'cashier', title: 'Kasa Raporu (ödeme tipine göre)', perm: 'financial_report.view', params: 'range' },
  { name: 'payments', title: 'Tahsilat Detayı', perm: 'financial_report.view', params: 'range' },
  { name: 'charges', title: 'Gelir / Masraf Dökümü', perm: 'financial_report.view', params: 'range' },
  { name: 'folio-balances', title: 'Açık Folyo Bakiyeleri', perm: 'financial_report.view', params: 'none' },
  { name: 'inhouse', title: 'Konaklayan Misafirler', perm: 'report.view', params: 'none' },
  { name: 'police-list', title: 'Polis Listesi', perm: 'kbs.manage', params: 'none' },
  { name: 'occupancy', title: 'Doluluk, ADR ve RevPAR', perm: 'financial_report.view', params: 'range' },
  { name: 'no-show-cancel', title: 'No-show ve İptaller', perm: 'report.view', params: 'range' },
  { name: 'cash-movements', title: 'Kasa Hareketleri', perm: 'financial_report.view', params: 'none' },
];
const reportQs = (r: (typeof DAY_REPORTS)[number], day: string) => (r.params === 'range' ? `from=${day}&to=${day}` : r.params === 'date' ? `date=${day}` : '');

interface History { id: string; businessDate: string; startedAt: string; completedAt: string; username: string; summary: Record<string, unknown> }

const SUMMARY_LABELS: [string, string, boolean][] = [
  ['roomChargesPosted', 'Oda ücreti', false], ['roomChargeTotal', 'Oda geliri', true], ['accommodationTax', 'Konaklama vergisi', true],
  ['roomsSold', 'Satılan oda', false], ['occupancyPct', 'Doluluk %', false], ['adr', 'ADR', true], ['revpar', 'RevPAR', true],
  ['otherRevenue', 'Diğer gelir', true], ['payments', 'Tahsilat', true], ['noShows', 'No-show', false], ['optionsCancelled', 'İptal edilen opsiyon', false],
];

function summaryText(s: Record<string, unknown>) {
  return SUMMARY_LABELS.filter(([k]) => s?.[k] !== undefined && s[k] !== null && !(Number(s[k]) === 0 && k !== 'roomChargesPosted'))
    .map(([k, label, money]) => `${label}: ${money ? fmtMoney(String(s[k])) : fmtQty(String(s[k]))}`).join(' · ');
}

export default function NightAuditPage() {
  const openRes = useOpenReservation();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { property, can } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [step, setStep] = useSessionState('nightAudit.step', 0);
  const [done, setDone] = useSessionState<number[]>('nightAudit.done', []);
  const mark = (i: number) => setDone(d => (d.includes(i) ? d : [...d, i]));
  // Adım ilerlemesi iş gününe bağlıdır: başka bir iş günü açıldığında (devir sonrası yeni gün) adımlar baştan başlar.
  const [stepDay, setStepDay] = useSessionState('nightAudit.day', '');
  const [autoNoShow, setAutoNoShow] = useState(false);
  const [cancelOptions, setCancelOptions] = useState(false);
  const settings = useQuery({ queryKey: ['settings', 'all'], queryFn: () => get<Setting[]>('/api/v1/property/settings') });
  const initialized = useRef(false);
  // Varsayılan seçim, Tesis Bilgileri → işleyiş kurallarındaki ayardan gelir.
  useEffect(() => {
    if (initialized.current || !settings.data) return;
    initialized.current = true;
    setAutoNoShow(settings.data.find(x => x.key === 'night_audit.auto_no_show')?.value === true);
    setCancelOptions(settings.data.find(x => x.key === 'night_audit.cancel_expired_options')?.value === true);
  }, [settings.data]);
  const [result, setResult] = useState<NightAuditResult | null>(null);
  const pv = useQuery({ queryKey: ['nightAudit', 'preview', autoNoShow, cancelOptions], queryFn: () => get<NightAuditPreview>(`/api/v1/night-audit/preview?autoNoShow=${autoNoShow}&cancelExpiredOptions=${cancelOptions}`) });
  const hist = useQuery({ queryKey: ['nightAudit', 'history'], queryFn: () => get<History[]>('/api/v1/night-audit/history') });
  const run = useAction(async (key: string) => {
    const r = await post<NightAuditResult>('/api/v1/night-audit/run', { businessDate: pv.data!.businessDate, autoNoShow, cancelExpiredOptions: cancelOptions }, key);
    setResult(r);
    mark(6);
    setStep(7);
    await qc.invalidateQueries();
    return r;
  }, { success: r => `Gün kapatıldı. Yeni iş günü ${fmtDate(r.newBusinessDate)}.` });

  const start = async () => {
    const p = pv.data!;
    if (!await confirm({ title: 'Gün sonunu başlat', message: <>İş günü <b>{fmtDate(p.businessDate)}</b> kapatılacak ve <b>{fmtDate(p.nextBusinessDate)}</b> açılacak. {p.roomChargesToPost} odaya toplam {fmtMoney(p.roomChargeTotal, property?.currency)} oda ücreti işlenecek. Bu işlem geri alınamaz.</>, confirmText: 'Günü kapat', requireText: 'GÜN SONU' })) return;
    await run.run();
  };

  const charges = useQuery({ queryKey: ['nightAudit', 'roomCharges'], queryFn: () => get<RoomChargeStep>('/api/v1/night-audit/room-charges'), enabled: step === 1 });
  const postCharges = useAction(async (key: string) => {
    const r = await post<{ posted: number; total: string }>('/api/v1/night-audit/room-charges', { businessDate: pv.data!.businessDate }, key);
    mark(1);
    await qc.invalidateQueries({ predicate: q => ['nightAudit', 'folios', 'reservations', 'roomStatus'].includes(String(q.queryKey[0])) });
    return r;
  }, { success: r => `${r.posted} odaya ${fmtMoney(r.total, property?.currency)} oda ücreti basıldı.` });
  const balances = useQuery({ queryKey: ['nightAudit', 'balances'], queryFn: () => get<ReportResult>('/api/v1/reports/inhouse'), enabled: step === 2 && can('report.view') });
  const backup = useAction(async () => { await api('POST', '/api/v1/backups'); mark(3); }, { success: 'Yedek alındı.' });
  // Gün sonu devrinden sonra kapatılan gün result.closedDate; öncesinde güncel iş günü.
  const day = result?.closedDate ?? pv.data?.businessDate ?? '';
  const reports = DAY_REPORTS.filter(r => can(r.perm));
  const [picked, setPicked] = useState<string[]>(() => DAY_REPORTS.map(r => r.name));
  const [saving, setSaving] = useState(false);
  const saveReports = async () => {
    const dir = await openDialog({ directory: true, title: 'Raporların kaydedileceği klasör' });
    if (!dir || Array.isArray(dir)) return;
    setSaving(true);
    let ok = 0;
    try {
      for (const r of reports.filter(r => picked.includes(r.name))) {
        const q = reportQs(r, day);
        await download(`/api/v1/reports/${r.name}/export?format=xlsx${q ? `&${q}` : ''}`, `${dir}\${day}-${r.name}.xlsx`);
        ok++;
      }
      mark(5);
      toast.ok(`${ok} rapor kaydedildi.`, String(dir));
    } catch (e) { toast.error(e); } finally { setSaving(false); }
  };
  useEffect(() => {
    const bdNow = pv.data?.businessDate;
    if (!bdNow || result) return;
    if (stepDay && stepDay !== bdNow) { setDone([]); setStep(0); }
    if (stepDay !== bdNow) setStepDay(bdNow);
  }, [pv.data?.businessDate, result]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = () => { mark(step); setStep(Math.min(STEPS.length - 1, step + 1)); };
  const blocked = (pv.data?.blockers.length ?? 0) > 0;
  const closed = !!result || !!pv.data?.alreadyClosed;

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <PageHead title="Gün Sonu" sub="Gün sonu kapanışı" />
      {pv.isLoading ? <Spinner /> : pv.error ? <ErrorBox error={pv.error} /> : (
        <div className="stack">
          <div className="na-steps">
            {STEPS.map((t, i) => (
              <button key={t} className={`na-step${step === i ? ' active' : ''}${done.includes(i) ? ' done' : ''}`} onClick={() => setStep(i)}>
                <span className="na-no">{done.includes(i) ? <CheckCircle2 size={14} /> : i + 1}</span>{t}
              </button>
            ))}
          </div>

          <div className="card"><div className="card-head"><h3>{step + 1}. {STEPS[step]}</h3><span className="muted" style={{ marginLeft: 8 }}>İş günü {fmtDate(day)}</span></div><div className="card-body stack">
            {step === 0 && <>
              <Kv items={[['Kapatılacak iş günü', <b key="d">{fmtDate(pv.data!.businessDate)}</b>], ['Sonraki iş günü', fmtDate(pv.data!.nextBusinessDate)], ['Konaklayan oda', pv.data!.inHouse],
                ['Basılacak oda ücreti', `${pv.data!.roomChargesToPost} oda · ${fmtMoney(pv.data!.roomChargeTotal, property?.currency)}`]]} />
              <label className="check"><input type="checkbox" checked={autoNoShow} onChange={e => setAutoNoShow(e.target.checked)} /> Gelmeyen bugünkü rezervasyonları devirde no-show yap</label>
              <label className="check"><input type="checkbox" checked={cancelOptions} onChange={e => setCancelOptions(e.target.checked)} /> Opsiyon süresi dolan rezervasyonları devirde iptal et</label>
              {pv.data!.blockers.length === 0 && pv.data!.warnings.length === 0 && <div className="ok-box row"><CheckCircle2 size={15} /> Engel veya uyarı yok.</div>}
              <ul className="list-plain">
                {pv.data!.blockers.map((b, i) => <li key={'b' + i}><XCircle size={15} color="var(--danger)" /><span>{b.message}</span><span className="spacer" />{b.reservationId && <button className="btn sm" onClick={() => openRes(b.reservationId!)}>Aç</button>}</li>)}
                {pv.data!.warnings.map((w, i) => <li key={'w' + i}><AlertTriangle size={15} color="var(--warning)" /><span>{w.message}</span><span className="spacer" />{w.reservationId && <button className="btn sm" onClick={() => openRes(w.reservationId!)}>Aç</button>}</li>)}
              </ul>
              {blocked && <div className="muted" style={{ fontSize: 12 }}>Kırmızı maddeler çözülmeden gün kapatılamaz; turuncu maddeler uyarıdır.</div>}
              {pv.data!.alreadyClosed && <div className="info-box">Bu iş günü zaten kapatılmış.</div>}
            </>}

            {step === 1 && <>
              <div className="muted">Bu gecenin oda ücretleri şimdi folyolara yazılır. Bu adım atlanırsa ücretler gün sonu devrinde yazılır; aynı gece iki kez yazılmaz.</div>
              {charges.isLoading ? <Spinner /> : charges.error ? <ErrorBox error={charges.error} /> : charges.data && <>
                <Kv items={[['Bu gece basılmış', `${charges.data.postedCount} oda · ${fmtMoney(charges.data.postedTotal, property?.currency)}`], ['Basılacak', `${charges.data.pending.length} oda`]]} />
                {charges.data.pending.length > 0 && (
                  <table className="dt"><thead><tr><th>Oda</th><th>Rez. no</th><th>Misafir</th><th style={{ textAlign: 'right' }}>Gecelik</th></tr></thead>
                    <tbody>{charges.data.pending.map(c => <tr key={c.reservationId}><td>{c.room}</td><td className="mono">{c.reservationNumber}</td><td>{c.guest}</td>
                      <td className="num">{c.rateCurrency ? `${fmtMoney(c.fxAmount ?? '0', c.rateCurrency)} (günün kuruyla)` : fmtMoney(c.rate, property?.currency)}</td></tr>)}</tbody></table>
                )}
                <div className="row">
                  <button className="btn primary" disabled={closed || charges.data.pending.length === 0 || postCharges.busy} onClick={() => void postCharges.run()}><BedDouble /> {postCharges.busy ? 'Basılıyor…' : 'Oda ücretlerini bas'}</button>
                  {charges.data.pending.length === 0 && <span className="muted">Basılacak oda ücreti kalmadı.</span>}
                </div>
                <ErrorBox error={postCharges.error} />
              </>}
            </>}

            {step === 2 && (!can('report.view') ? <div className="info-box">Bakiyeleri görmek için rapor yetkisi gerekir.</div> : balances.isLoading ? <Spinner /> : balances.error ? <ErrorBox error={balances.error} /> : balances.data && <>
              <div className="muted">Konaklayan odaların folyo bakiyeleri. Yarın çıkacak ve bakiyesi olanlar kalın gösterilir.</div>
              <table className="dt"><thead><tr><th>Oda</th><th>Misafir</th><th>Çıkış</th><th>Şirket/Acente</th><th style={{ textAlign: 'right' }}>Bakiye</th></tr></thead>
                <tbody>{balances.data.rows.map((r, i) => {
                  const due = Number(r.balance) !== 0 && String(r.departure) <= (pv.data?.nextBusinessDate ?? '');
                  return <tr key={i} style={due ? { fontWeight: 700 } : undefined}><td>{String(r.room ?? '')}</td><td>{String(r.guestName ?? '')}</td><td>{fmtDate(String(r.departure ?? ''))}</td><td>{String(r.account ?? '')}</td><td className="num">{fmtMoney(String(r.balance ?? '0'), property?.currency)}</td></tr>;
                })}</tbody></table>
              {balances.data.rows.length === 0 && <Empty title="Konaklayan misafir yok" />}
              <div className="row"><b>Toplam bakiye: {fmtMoney(String(balances.data.totals?.balance ?? '0'), property?.currency)}</b><span className="spacer" /><button className="btn sm" onClick={() => nav('/reports/folio-balances')}><Wallet size={14} /> Tüm açık folyolar</button></div>
            </>)}

            {step === 3 && <>
              <div className="muted">Gün kapatılmadan önce veritabanının yedeği alınır (Yönetim → Yedekleme ekranındaki klasöre).</div>
              <div className="row">
                <button className="btn primary" disabled={!can('backup.manage') || backup.busy} onClick={() => void backup.run()}><Database /> {backup.busy ? 'Yedek alınıyor…' : 'Şimdi yedek al'}</button>
                {!can('backup.manage') && <span className="muted">Yedek alma yetkiniz yok; bu adımı atlayabilirsiniz (zamanlanmış yedek ayrıca çalışır).</span>}
                {done.includes(3) && can('backup.manage') && <span className="row" style={{ color: 'var(--success)' }}><CheckCircle2 size={15} /> Yedek alındı</span>}
              </div>
              <ErrorBox error={backup.error} />
            </>}

            {step === 4 && <>
              <div className="muted">Kapatılan güne ait raporları açıp yazdırabilirsiniz.</div>
              <ul className="list-plain">{reports.map(r => <li key={r.name}><FileText size={15} /><span>{r.title}</span><span className="spacer" />
                <button className="btn sm" onClick={() => { mark(4); nav(`/reports/${r.name}${reportQs(r, day) ? `?${reportQs(r, day)}` : ''}`); }}>Aç</button></li>)}</ul>
            </>}

            {step === 5 && <>
              <div className="muted">Seçilen raporlar kapatılan günün tarihiyle Excel dosyası olarak seçtiğiniz klasöre kaydedilir (ör. {day}-cashier.xlsx).</div>
              <ul className="list-plain">{reports.map(r => <li key={r.name}><label className="check"><input type="checkbox" checked={picked.includes(r.name)}
                onChange={e => setPicked(p => e.target.checked ? [...p, r.name] : p.filter(x => x !== r.name))} /> {r.title}</label></li>)}</ul>
              <div className="row"><button className="btn primary" disabled={saving || !reports.some(r => picked.includes(r.name))} onClick={() => void saveReports()}><FileSpreadsheet /> {saving ? 'Kaydediliyor…' : 'Klasör seç ve kaydet'}</button></div>
            </>}

            {step === 6 && <>
              {result ? <div className="ok-box"><b>Gün sonu tamamlandı.</b> {fmtDate(result.closedDate)} kapatıldı, yeni iş günü {fmtDate(result.newBusinessDate)}. {result.roomChargesPosted} oda ücreti ({fmtMoney(result.roomChargeTotal)}) devirde işlendi{Number(result.accommodationTaxTotal) > 0 ? `, ${fmtMoney(result.accommodationTaxTotal)} konaklama vergisi ayrıldı` : ''}, {result.noShows} no-show{result.optionsCancelled > 0 ? `, ${result.optionsCancelled} opsiyon iptal edildi` : ''}.</div> : <>
                <div className="muted">İş günü kapatılır ve yeni iş günü açılır: basılmamış oda ücretleri yazılır, istatistik ve muhasebe fişi oluşur{autoNoShow ? ', gelmeyenler no-show yapılır' : ''}{cancelOptions ? ', süresi dolan opsiyonlar iptal edilir' : ''}. Bu işlem geri alınamaz.</div>
                <div className="row">
                  <button className="btn primary" disabled={!pv.data!.canRun || run.busy} onClick={() => void start()}><Moon /> {run.busy ? 'Gün kapatılıyor…' : 'Gün sonu devrini yap'}</button>
                  {blocked && <span className="muted">Önce 1. adımdaki engelleri giderin.</span>}
                </div>
                <ErrorBox error={run.error} />
              </>}
            </>}

            {step === 7 && <>
              <div className="muted">Yeni iş günü için listeler.</div>
              <ul className="list-plain">
                {[['Beklenen gelişler', '/reservations?view=arrivals'], ['Beklenen çıkışlar', '/reservations?view=departures'], ['Konaklayanlar', '/reservations?view=inhouse'],
                  ['Uyandırmalar', '/wakeups'], ['Oda durumları (kat hizmetleri)', '/housekeeping'], ['Oda rack', '/rack']].map(([t, to]) =>
                  <li key={to}><ListChecks size={15} /><span>{t}</span><span className="spacer" /><button className="btn sm" onClick={() => nav(to)}>Aç</button></li>)}
              </ul>
            </>}

            <div className="row na-nav">
              <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={14} /> Bir adım geri</button>
              <span className="spacer" />
              {step < 6 && <button className="btn primary" disabled={step === 0 && blocked && !closed} onClick={next}>Sonraki adım <ArrowRight size={14} /></button>}
              {step === 6 && result && <button className="btn primary" onClick={() => setStep(7)}>Yeni gün listeleri <ArrowRight size={14} /></button>}
              {step === 7 && <button className="btn" onClick={() => { setDone([]); setStep(0); setResult(null); }}>Bitir</button>}
            </div>
          </div></div>

          <div className="card"><div className="card-head"><h3>Geçmiş</h3></div><div className="card-body tight">
            {hist.data?.length === 0 ? <Empty title="Henüz gün sonu yapılmadı" /> : (
              <table className="dt"><thead><tr><th>İş günü</th><th>Başlangıç</th><th>Bitiş</th><th>Kullanıcı</th><th>Özet</th></tr></thead>
                <tbody>{hist.data?.map(h => <tr key={h.id}><td>{fmtDate(h.businessDate)}</td><td>{fmtDateTime(h.startedAt)}</td><td>{fmtDateTime(h.completedAt)}</td><td>{h.username}</td>
                  <td className="muted">{summaryText(h.summary ?? {})}</td></tr>)}</tbody></table>
            )}
          </div></div>
        </div>
      )}
    </div>
  );
}
