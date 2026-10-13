import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, History, Pencil } from 'lucide-react';
import { api, get, post, qs } from '../lib/api';
import type { ExchangeRate, ExchangeRatesView, TcmbImportResult } from '../lib/types';
import { fmtDate, fmtDateTime, fmtRate, parseRate } from '../lib/format';
import { useSession } from '../lib/session';
import { PageHead, useAction } from '../components/common';
import { Badge, Empty, ErrorBox, Field, Modal, Spinner } from '../components/ui';

export default function ExchangeRatesPage() {
  const { can } = useSession();
  const qc = useQueryClient();
  const view = useQuery({ queryKey: ['exchangeRates'], queryFn: () => get<ExchangeRatesView>('/api/v1/exchange-rates') });
  const [edit, setEdit] = useState<string | null>(null);
  const [hist, setHist] = useState<string | null>(null);
  const tcmb = useAction(async (key: string) => {
    const r = await post<TcmbImportResult>('/api/v1/exchange-rates/tcmb', {}, key);
    await qc.invalidateQueries({ queryKey: ['exchangeRates'] });
    return r;
  }, { success: r => `TCMB ${r.bulletinDate} bülteninden ${r.rateType} kurları kaydedildi${r.missing.length ? ` (bulunamayan: ${r.missing.join(', ')})` : ''}.` });

  if (view.isLoading) return <div className="page"><Spinner /></div>;
  if (view.error) return <div className="page"><ErrorBox error={view.error} /></div>;
  const v = view.data!;
  const manage = can('exchange_rate.manage');
  const rows = v.currencies.map(c => ({ currency: c, rate: v.rates.find(r => r.currency === c) }));

  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <PageHead title="Döviz Kurları" sub={`İş günü ${fmtDate(v.businessDate)} · 1 birim dövizin ${v.baseCurrency} karşılığı`} actions={
        manage && v.tcmbAvailable ? <button className="btn" disabled={tcmb.busy} onClick={() => void tcmb.run()}><Download /> {tcmb.busy ? 'Alınıyor…' : 'TCMB kurlarını al'}</button> : undefined} />
      <ErrorBox error={tcmb.error} />
      <div className="card"><div className="card-body tight">
        {rows.length === 0 ? <Empty title="Tanımlı döviz yok" text="Yönetim → İşlem Kodları ve Ödeme Tipleri ekranındaki döviz ayarlarından ekleyin." /> : (
          <table className="dt">
            <thead><tr><th>Döviz</th><th style={{ textAlign: 'right' }}>Kur ({v.baseCurrency})</th><th>Kur tarihi</th><th>Kaynak</th><th>Giren</th><th /></tr></thead>
            <tbody>{rows.map(({ currency, rate }) => {
              const stale = rate && rate.rateDate !== v.businessDate;
              return (
                <tr key={currency}>
                  <td><b>{currency}</b></td>
                  <td className="num">{rate ? <b>{fmtRate(rate.rate)}</b> : <span className="muted">Girilmemiş</span>}</td>
                  <td>{rate ? <>{fmtDate(rate.rateDate)} {stale && <Badge color="orange">Bugün girilmedi</Badge>}</> : ''}</td>
                  <td>{rate ? (rate.source === 'tcmb' ? 'TCMB' : 'Elle') : ''}</td>
                  <td className="muted">{rate ? `${rate.username ?? ''} · ${fmtDateTime(rate.createdAt)}` : ''}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {manage && <button className="btn sm" onClick={() => setEdit(currency)}><Pencil /> Kur gir</button>}
                    <button className="btn sm ghost" onClick={() => setHist(currency)}><History /> Geçmiş</button>
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div></div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Dövizli tahsilatta o günün kuru kullanılır; bugün kur girilmemişse son girilen kur kullanılır (resmî tatiller için en fazla 10 gün; 3 günden eskiyse gece denetimi uyarır). Alınan döviz ve uygulanan kur folyo satırında saklanır,
        kur sonradan değişse de eski tahsilatlar etkilenmez.{!v.tcmbAvailable && ' TCMB kurları yalnız tesis para birimi TRY iken alınabilir.'}
      </div>
      {edit && <RateModal currency={edit} base={v.baseCurrency} current={v.rates.find(r => r.currency === edit)} onClose={() => setEdit(null)} />}
      {hist && <HistoryModal currency={hist} base={v.baseCurrency} onClose={() => setHist(null)} />}
    </div>
  );
}

function RateModal({ currency, base, current, onClose }: { currency: string; base: string; current?: ExchangeRate; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState(current ? fmtRate(current.rate) : '');
  const rate = parseRate(text);
  const save = useAction(async () => {
    await api('PUT', `/api/v1/exchange-rates/${currency}`, { rate });
    await qc.invalidateQueries({ queryKey: ['exchangeRates'] });
  }, { success: `${currency} kuru kaydedildi.` });
  return (
    <Modal title={`${currency} kuru`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!rate || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button></>}>
      <Field label={`1 ${currency} = ? ${base}`} required hint="En fazla 6 ondalık. Kur bugünkü iş gününe kaydedilir.">
        <input className="input num" value={text} onChange={e => setText(e.target.value)} inputMode="decimal" autoFocus />
      </Field>
      {text && !rate && <div className="error-box">Geçerli bir kur girin (ör. 37,5421).</div>}
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function HistoryModal({ currency, base, onClose }: { currency: string; base: string; onClose: () => void }) {
  const h = useQuery({ queryKey: ['exchangeRates', 'history', currency], queryFn: () => get<ExchangeRate[]>(`/api/v1/exchange-rates/history${qs({ currency })}`) });
  return (
    <Modal title={`${currency} kur geçmişi`} onClose={onClose} footer={<button className="btn" onClick={onClose}>Kapat</button>}>
      {h.isLoading ? <Spinner /> : h.error ? <ErrorBox error={h.error} /> : (h.data ?? []).length === 0 ? <Empty title="Kayıt yok" /> : (
        <div className="table-wrap" style={{ maxHeight: 380 }}>
          <table className="dt"><thead><tr><th>Tarih</th><th style={{ textAlign: 'right' }}>Kur ({base})</th><th>Kaynak</th><th>Giren</th></tr></thead>
            <tbody>{h.data!.map(r => <tr key={r.rateDate}><td>{fmtDate(r.rateDate)}</td><td className="num">{fmtRate(r.rate)}</td><td>{r.source === 'tcmb' ? 'TCMB' : 'Elle'}</td><td className="muted">{r.username}</td></tr>)}</tbody></table>
        </div>
      )}
    </Modal>
  );
}
