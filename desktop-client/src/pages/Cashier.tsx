import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Unlock, Wallet } from 'lucide-react';
import { get, post, qs } from '../lib/api';
import type { Shift, ShiftReport } from '../lib/types';
import { fmtDate, fmtDateTime, fmtMoney } from '../lib/format';
import { useSession } from '../lib/session';
import { Kv, PageHead, useAction } from '../components/common';
import { Badge, Empty, ErrorBox, Field, Modal, MoneyInput, Spinner } from '../components/ui';

export default function CashierPage() {
  const qc = useQueryClient();
  const { property } = useSession();
  const cur = useQuery({ queryKey: ['cashier', 'current'], queryFn: () => get<Shift | null>('/api/v1/cashier/current') });
  const [date, setDate] = useState(property?.businessDate ?? '');
  const shifts = useQuery({ queryKey: ['cashier', 'shifts', date], queryFn: () => get<Shift[]>(`/api/v1/cashier/shifts${qs({ date })}`) });
  const [sel, setSel] = useState<string | null>(null);
  const report = useQuery({ queryKey: ['cashier', 'shift', sel ?? cur.data?.id], queryFn: () => get<ShiftReport>(`/api/v1/cashier/shifts/${sel ?? cur.data!.id}`), enabled: !!(sel ?? cur.data?.id) });
  const [openDlg, setOpenDlg] = useState(false);
  const [closeDlg, setCloseDlg] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['cashier'] });

  return (
    <div className="page">
      <PageHead title="Kasa Vardiyası" sub="Nakit ve kart tahsilatları açık vardiyaya yazılır" actions={
        cur.data ? <button className="btn danger" onClick={() => setCloseDlg(true)}><Lock /> Vardiyayı kapat</button>
          : <button className="btn primary" onClick={() => setOpenDlg(true)}><Unlock /> Vardiya aç</button>} />
      {cur.isLoading ? <Spinner /> : (
        <div className="split wide">
          <div className="stack">
            <div className="card">
              <div className="card-head"><Wallet size={16} /><h3>Benim vardiyam</h3></div>
              <div className="card-body">
                {cur.data ? <Kv items={[['Vardiya', `#${cur.data.shiftNo}`], ['İş günü', fmtDate(cur.data.businessDate)], ['Açılış', fmtDateTime(cur.data.openedAt)], ['Açılış kasası', fmtMoney(cur.data.openingFloat, property?.currency)],
                  ['Beklenen nakit', report.data ? <b key="e">{fmtMoney(report.data.expectedCash, property?.currency)}</b> : '…']]} />
                  : <Empty title="Açık vardiyanız yok" text="Nakit ve kart tahsilatı için önce vardiya açın." />}
              </div>
            </div>
            <div className="card">
              <div className="card-head"><h3>Vardiyalar</h3><div className="right"><input type="date" className="input sm" value={date} onChange={e => setDate(e.target.value)} /></div></div>
              <div className="card-body tight">
                {shifts.data?.length === 0 ? <Empty title="Bu tarihte vardiya yok" /> : (
                  <table className="dt"><thead><tr><th>#</th><th>Kullanıcı</th><th>Durum</th><th style={{ textAlign: 'right' }}>Fark</th></tr></thead>
                    <tbody>{shifts.data?.map(s => (
                      <tr key={s.id} className={`clickable ${(sel ?? cur.data?.id) === s.id ? 'selected' : ''}`} onClick={() => setSel(s.id)}>
                        <td>{s.shiftNo}</td><td>{s.username}</td><td>{s.status === 'open' ? <Badge color="green">Açık</Badge> : <Badge color="gray">Kapalı</Badge>}</td>
                        <td className="num">{s.difference ? fmtMoney(s.difference) : '—'}</td>
                      </tr>))}</tbody></table>
                )}
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h3>Vardiya dökümü{report.data ? ` · #${report.data.shift.shiftNo} ${report.data.shift.username}` : ''}</h3></div>
            <div className="card-body">
              {!report.data ? <Empty title="Görüntülenecek vardiya seçin" /> : (
                <>
                  <table className="dt">
                    <thead><tr><th>Ödeme tipi</th><th style={{ textAlign: 'right' }}>Adet</th><th style={{ textAlign: 'right' }}>Tahsilat</th><th style={{ textAlign: 'right' }}>İade</th><th style={{ textAlign: 'right' }}>Net</th></tr></thead>
                    <tbody>{report.data.totals.map(t => <tr key={t.paymentMethod}><td>{t.paymentMethod}</td><td className="num">{t.count}</td><td className="num">{fmtMoney(t.collected)}</td><td className="num">{fmtMoney(t.refunded)}</td><td className="num"><b>{fmtMoney(t.net)}</b></td></tr>)}</tbody>
                  </table>
                  {report.data.totals.length === 0 && <Empty title="Bu vardiyada tahsilat yok" />}
                  <div style={{ marginTop: 12 }}>
                    <Kv items={[['Açılış kasası', fmtMoney(report.data.shift.openingFloat)], ['Beklenen nakit', fmtMoney(report.data.expectedCash)],
                      ...(report.data.shift.closedAt ? [['Sayılan nakit', fmtMoney(report.data.shift.countedCash)], ['Fark', <b key="d" className={report.data.shift.difference?.startsWith('-') ? 'amount-neg' : ''}>{fmtMoney(report.data.shift.difference)}</b>], ['Kapanış', fmtDateTime(report.data.shift.closedAt)], ['Not', report.data.shift.closeNote]] as [string, React.ReactNode][] : [])]} />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {openDlg && <OpenShiftModal onClose={() => setOpenDlg(false)} onDone={refresh} />}
      {closeDlg && cur.data && <CloseShiftModal expected={report.data?.expectedCash} onClose={() => setCloseDlg(false)} onDone={refresh} />}
    </div>
  );
}

function OpenShiftModal({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<unknown> }) {
  const [v, setV] = useState('0.00');
  const act = useAction(async (key: string) => { await post('/api/v1/cashier/open', { openingFloat: v || '0' }, key); await onDone(); }, { success: 'Vardiya açıldı.' });
  return (
    <Modal title="Vardiya aç" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={act.busy} onClick={async () => { if (await act.run() !== undefined) onClose(); }}>Aç</button></>}>
      <Field label="Açılış kasası (devir nakit)"><MoneyInput value={v} onChange={setV} autoFocus /></Field>
      <ErrorBox error={act.error} />
    </Modal>
  );
}

function CloseShiftModal({ expected, onClose, onDone }: { expected?: string; onClose: () => void; onDone: () => Promise<unknown> }) {
  const [v, setV] = useState('');
  const [note, setNote] = useState('');
  const act = useAction(async (key: string) => { await post('/api/v1/cashier/close', { countedCash: v, note: note || null }, key); await onDone(); }, { success: 'Vardiya kapatıldı.' });
  return (
    <Modal title="Vardiyayı kapat" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn danger" disabled={!v || act.busy} onClick={async () => { if (await act.run() !== undefined) onClose(); }}>Kapat</button></>}>
      <div className="stack">
        {expected && <div className="info-box">Sisteme göre beklenen nakit: <b>{fmtMoney(expected)}</b></div>}
        <Field label="Sayılan nakit" required><MoneyInput value={v} onChange={setV} autoFocus /></Field>
        <Field label="Not"><input className="input" value={note} onChange={e => setNote(e.target.value)} /></Field>
        <ErrorBox error={act.error} />
      </div>
    </Modal>
  );
}
