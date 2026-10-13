import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Moon, XCircle } from 'lucide-react';
import { get, post } from '../lib/api';
import type { NightAuditPreview, NightAuditResult, Setting } from '../lib/types';
import { fmtDate, fmtDateTime, fmtMoney } from '../lib/format';
import { useSession } from '../lib/session';
import { Kv, PageHead, useAction } from '../components/common';
import { Empty, ErrorBox, Spinner, useConfirm } from '../components/ui';

interface History { id: string; businessDate: string; startedAt: string; completedAt: string; username: string; summary: Record<string, unknown> }

const SUMMARY_LABELS: [string, string, boolean][] = [
  ['roomChargesPosted', 'Oda ücreti', false], ['roomChargeTotal', 'Oda geliri', true], ['accommodationTax', 'Konaklama vergisi', true],
  ['roomsSold', 'Satılan oda', false], ['occupancyPct', 'Doluluk %', false], ['adr', 'ADR', true], ['revpar', 'RevPAR', true],
  ['otherRevenue', 'Diğer gelir', true], ['payments', 'Tahsilat', true], ['noShows', 'No-show', false], ['optionsCancelled', 'İptal edilen opsiyon', false],
];

function summaryText(s: Record<string, unknown>) {
  return SUMMARY_LABELS.filter(([k]) => s?.[k] !== undefined && s[k] !== null && !(Number(s[k]) === 0 && k !== 'roomChargesPosted'))
    .map(([k, label, money]) => `${label}: ${money ? fmtMoney(String(s[k])) : String(s[k])}`).join(' · ');
}

export default function NightAuditPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { property } = useSession();
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
    await qc.invalidateQueries();
    return r;
  }, { success: r => `Gün kapatıldı. Yeni iş günü ${fmtDate(r.newBusinessDate)}.` });

  const start = async () => {
    const p = pv.data!;
    if (!await confirm({ title: 'Gece denetimini başlat', message: <>İş günü <b>{fmtDate(p.businessDate)}</b> kapatılacak ve <b>{fmtDate(p.nextBusinessDate)}</b> açılacak. {p.roomChargesToPost} odaya toplam {fmtMoney(p.roomChargeTotal, property?.currency)} oda ücreti işlenecek. Bu işlem geri alınamaz.</>, confirmText: 'Günü kapat', requireText: 'GÜN SONU' })) return;
    await run.run();
  };

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <PageHead title="Gece Denetimi" sub="Gün sonu kapanışı" />
      {pv.isLoading ? <Spinner /> : pv.error ? <ErrorBox error={pv.error} /> : (
        <div className="stack">
          {result && <div className="ok-box"><b>Gün sonu tamamlandı.</b> {fmtDate(result.closedDate)} kapatıldı, yeni iş günü {fmtDate(result.newBusinessDate)}. {result.roomChargesPosted} oda ücreti ({fmtMoney(result.roomChargeTotal)}) işlendi{Number(result.accommodationTaxTotal) > 0 ? `, ${fmtMoney(result.accommodationTaxTotal)} konaklama vergisi ayrıldı` : ''}, {result.noShows} no-show{result.optionsCancelled > 0 ? `, ${result.optionsCancelled} opsiyon iptal edildi` : ''}.</div>}
          <div className="grid cols-2">
            <div className="card"><div className="card-head"><Moon size={16} /><h3>Özet</h3></div><div className="card-body">
              <Kv items={[['Kapatılacak iş günü', <b key="d">{fmtDate(pv.data!.businessDate)}</b>], ['Sonraki iş günü', fmtDate(pv.data!.nextBusinessDate)], ['Konaklayan oda', pv.data!.inHouse],
                ['İşlenecek oda ücreti', `${pv.data!.roomChargesToPost} oda · ${fmtMoney(pv.data!.roomChargeTotal, property?.currency)}`]]} />
              <label className="check" style={{ marginTop: 12 }}><input type="checkbox" checked={autoNoShow} onChange={e => setAutoNoShow(e.target.checked)} /> Gelmeyen bugünkü rezervasyonları no-show yap</label>
              <label className="check"><input type="checkbox" checked={cancelOptions} onChange={e => setCancelOptions(e.target.checked)} /> Opsiyon süresi dolan rezervasyonları iptal et</label>
              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn primary" disabled={!pv.data!.canRun || run.busy} onClick={() => void start()}><Moon /> {run.busy ? 'Gün kapatılıyor…' : 'Gece denetimini çalıştır'}</button>
                {pv.data!.alreadyClosed && <span className="muted">Bu iş günü zaten kapatılmış.</span>}
              </div>
              <ErrorBox error={run.error} />
            </div></div>
            <div className="card"><div className="card-head"><h3>Kontroller</h3></div><div className="card-body">
              {pv.data!.blockers.length === 0 && pv.data!.warnings.length === 0 && <div className="ok-box row"><CheckCircle2 size={15} /> Engel veya uyarı yok.</div>}
              <ul className="list-plain">
                {pv.data!.blockers.map((b, i) => <li key={'b' + i}><XCircle size={15} color="var(--danger)" /><span>{b.message}</span><span className="spacer" />{b.reservationId && <button className="btn sm" onClick={() => nav(`/reservations/${b.reservationId}`)}>Aç</button>}</li>)}
                {pv.data!.warnings.map((w, i) => <li key={'w' + i}><AlertTriangle size={15} color="var(--warning)" /><span>{w.message}</span><span className="spacer" />{w.reservationId && <button className="btn sm" onClick={() => nav(`/reservations/${w.reservationId}`)}>Aç</button>}</li>)}
              </ul>
              {pv.data!.blockers.length > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Kırmızı maddeler çözülmeden gün kapatılamaz.</div>}
            </div></div>
          </div>
          <div className="card"><div className="card-head"><h3>Geçmiş</h3></div><div className="card-body tight">
            {hist.data?.length === 0 ? <Empty title="Henüz gece denetimi yapılmadı" /> : (
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
