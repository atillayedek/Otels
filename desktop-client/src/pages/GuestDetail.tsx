import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Crown, Save, ShieldCheck } from 'lucide-react';
import { api, get } from '../lib/api';
import type { GuestProfile } from '../lib/types';
import { fmtDate, fmtDateTime, fmtMoney, STATUS_BADGE, STATUS_LABEL } from '../lib/format';
import { useSession } from '../lib/session';
import { PageHead, useAction } from '../components/common';
import { Badge, Empty, ErrorBox, Field, Modal, Spinner, Tabs } from '../components/ui';
import { draftToBody, GuestFields, guestToDraft, type GuestDraft } from '../components/GuestFields';

export default function GuestDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { can } = useSession();
  const [tab, setTab] = useState<'card' | 'stays' | 'folios'>('card');
  const [draft, setDraft] = useState<GuestDraft | null>(null);
  const [black, setBlack] = useState(false);
  const p = useQuery({ queryKey: ['guest', id], queryFn: () => get<GuestProfile>(`/api/v1/guests/${id}`) });
  useEffect(() => { if (p.data) setDraft(guestToDraft(p.data.guest)); }, [p.data]);

  const save = useAction(async () => {
    await api('PUT', `/api/v1/guests/${id}`, draftToBody(draft!, p.data!.guest.version));
    await qc.invalidateQueries({ queryKey: ['guest'] });
    await qc.invalidateQueries({ queryKey: ['guests'] });
  }, { success: 'Misafir kartı kaydedildi.' });

  if (p.isLoading || !draft) return <div className="page"><Spinner /></div>;
  if (p.error) return <div className="page"><ErrorBox error={p.error} /></div>;
  const g = p.data!.guest;

  return (
    <div className="page">
      <PageHead title={<>{g.isVip && <Crown size={18} color="var(--warning)" />} {g.firstName} {g.lastName}</>} sub={<>
        {g.isBlacklisted && <Badge color="red">Kara listede: {g.blacklistReason}</Badge>}
        {g.migrationSource && <Badge color="gray">Aktarım: {g.migrationSource}</Badge>}
        <span>Kayıt {fmtDateTime(g.createdAt)} · Toplam gelir {fmtMoney(p.data!.totalRevenue)}</span>
      </>} actions={<>
        <button className="btn ghost" onClick={() => nav(-1)}><ArrowLeft /> Geri</button>
        {can('guest.blacklist') && <button className="btn" onClick={() => setBlack(true)}>{g.isBlacklisted ? <ShieldCheck /> : <Ban />} {g.isBlacklisted ? 'Kara listeden çıkar' : 'Kara listeye al'}</button>}
        {can('guest.edit') && tab === 'card' && <button className="btn primary" disabled={save.busy} onClick={() => void save.run()}><Save /> Kaydet</button>}
      </>} />
      <Tabs value={tab} onChange={setTab} items={[{ key: 'card', label: 'Misafir kartı' }, { key: 'stays', label: 'Konaklamalar', count: p.data!.stays.length }, { key: 'folios', label: 'Folyolar', count: p.data!.folios.length }]} />
      <div className="card"><div className="card-body">
        {tab === 'card' && <><GuestFields value={draft} onChange={setDraft} /><ErrorBox error={save.error} /></>}
        {tab === 'stays' && (p.data!.stays.length === 0 ? <Empty title="Konaklama kaydı yok" /> : (
          <table className="dt"><thead><tr><th>Rez. No</th><th>Giriş</th><th>Çıkış</th><th>Oda</th><th style={{ textAlign: 'right' }}>Gecelik</th><th>Durum</th></tr></thead>
            <tbody>{p.data!.stays.map(s => (
              <tr key={s.id} className="clickable" onClick={() => nav(`/reservations/${s.id}`)}>
                <td className="mono">{s.reservationNumber}</td><td>{fmtDate(s.arrival)}</td><td>{fmtDate(s.departure)}</td><td>{s.roomNumber ?? s.roomTypeCode}</td>
                <td className="num">{fmtMoney(s.nightlyRate, s.currency)}</td><td><Badge color={STATUS_BADGE[s.status]}>{STATUS_LABEL[s.status]}</Badge></td>
              </tr>))}</tbody></table>
        ))}
        {tab === 'folios' && (p.data!.folios.length === 0 ? <Empty title="Folyo yok" /> : (
          <table className="dt"><thead><tr><th>Folyo</th><th>Durum</th><th style={{ textAlign: 'right' }}>Borç</th><th style={{ textAlign: 'right' }}>Ödeme</th><th style={{ textAlign: 'right' }}>Bakiye</th></tr></thead>
            <tbody>{p.data!.folios.map(f => <tr key={f.id}><td className="mono">{f.folioNumber}</td><td>{f.status === 'open' ? 'Açık' : 'Kapalı'}</td><td className="num">{fmtMoney(f.totalCharges)}</td><td className="num">{fmtMoney(f.totalPayments)}</td><td className="num">{fmtMoney(f.balance)}</td></tr>)}</tbody></table>
        ))}
      </div></div>
      {black && <BlacklistModal id={g.id} current={g.isBlacklisted} version={g.version} onClose={() => setBlack(false)} />}
    </div>
  );
}

function BlacklistModal({ id, current, version, onClose }: { id: string; current: boolean; version: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const act = useAction(async () => {
    await api('POST', `/api/v1/guests/${id}/blacklist`, { isBlacklisted: !current, reason: reason || null, version });
    await qc.invalidateQueries({ queryKey: ['guest'] });
  }, { success: current ? 'Kara listeden çıkarıldı.' : 'Kara listeye alındı.' });
  return (
    <Modal title={current ? 'Kara listeden çıkar' : 'Kara listeye al'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className={`btn ${current ? 'primary' : 'danger'}`} disabled={(!current && !reason.trim()) || act.busy} onClick={async () => { if (await act.run() !== undefined) onClose(); }}>Onayla</button>
    </>}>
      <Field label="Gerekçe" required={!current}><textarea className="input" rows={3} value={reason} onChange={e => setReason(e.target.value)} autoFocus /></Field>
      <ErrorBox error={act.error} />
    </Modal>
  );
}
