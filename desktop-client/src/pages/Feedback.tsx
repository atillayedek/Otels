import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, MessageSquareText, Plus, Star } from 'lucide-react';
import { get, newKey, post, qs } from '../lib/api';
import { fmtDate, fmtDateTime } from '../lib/format';
import type { GuestFeedback, GuestListItem, GuestProfile, KeyCardInUse } from '../lib/types';
import { PageHead } from '../components/common';
import { GuestSearch } from '../components/GuestSearch';
import { useOpenReservation } from '../components/Windows';
import { Badge, Empty, ErrorBox, Field, Modal, Spinner, useToast } from '../components/ui';

export const FEEDBACK_KIND: Record<GuestFeedback['kind'], string> = { compliment: 'Övgü', complaint: 'Şikâyet', suggestion: 'Öneri', other: 'Diğer' };
const KIND_BADGE: Record<GuestFeedback['kind'], string> = { compliment: 'green', complaint: 'red', suggestion: 'blue', other: 'gray' };
export const FEEDBACK_DEPT: Record<string, string> = {
  front_office: 'Ön büro', housekeeping: 'Kat hizmetleri', maintenance: 'Teknik servis', restaurant: 'Restoran', accounting: 'Muhasebe', management: 'Yönetim', other: 'Diğer',
};
const SOURCE: Record<string, string> = { in_person: 'Yüz yüze', phone: 'Telefon', email: 'E-posta', survey: 'Anket', online: 'İnternet', other: 'Diğer' };
const STATUS: Record<GuestFeedback['status'], string> = { open: 'Açık', resolved: 'Çözüldü', closed: 'Kapatıldı' };

/** Misafir yorumları: övgü, şikâyet ve öneriler; şikâyetler çözülene kadar açık listede kalır. */
export default function FeedbackPage() {
  const [status, setStatus] = useState<'open' | ''>('open');
  const [kind, setKind] = useState('');
  const [creating, setCreating] = useState(false);
  const [resolving, setResolving] = useState<GuestFeedback | null>(null);
  const openRes = useOpenReservation();
  const list = useQuery({ queryKey: ['guests', 'feedback', status, kind], queryFn: () => get<GuestFeedback[]>(`/api/v1/guest-feedback${qs({ status, kind })}`) });
  const rated = (list.data ?? []).filter(f => f.rating);
  const avg = rated.length ? (rated.reduce((s, f) => s + (f.rating ?? 0), 0) / rated.length).toFixed(1) : null;
  return (
    <div className="page">
      <PageHead title="Misafir Yorumları" sub="Övgü, şikâyet ve öneriler; şikâyetin çözümü kaydedilir"
        actions={<button className="btn primary" onClick={() => setCreating(true)}><Plus /> Yorum ekle</button>} />
      <div className="toolbar">
        <div className="seg">
          <button className={status === 'open' ? 'active' : ''} onClick={() => setStatus('open')}>Açık</button>
          <button className={status === '' ? 'active' : ''} onClick={() => setStatus('')}>Tümü</button>
        </div>
        <div className="seg">
          <button className={kind === '' ? 'active' : ''} onClick={() => setKind('')}>Tüm türler</button>
          {Object.entries(FEEDBACK_KIND).map(([k, v]) => <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>{v}</button>)}
        </div>
        <span className="spacer" />
        <span className="count">{list.data?.length ?? 0} kayıt{avg && ` · ortalama puan ${avg}`}</span>
      </div>
      <div className="card" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
        {list.isLoading ? <Spinner /> : list.error ? <ErrorBox error={list.error} /> : !list.data?.length
          ? <Empty icon={<MessageSquareText />} title={status === 'open' ? 'Açık yorum yok' : 'Yorum yok'} />
          : (
            <div className="table-wrap"><table className="dt">
              <thead><tr><th>No</th><th>Tarih</th><th>Tür</th><th>Misafir</th><th>Oda</th><th>Bölüm</th><th>Puan</th><th>Yorum</th><th>Durum</th><th /></tr></thead>
              <tbody>{list.data.map(f => (
                <tr key={f.id}>
                  <td>{f.feedbackNo}</td>
                  <td className="nowrap">{fmtDateTime(f.createdAt)}<div className="muted" style={{ fontSize: 11 }}>{SOURCE[f.source]} · {f.createdBy}</div></td>
                  <td><Badge color={KIND_BADGE[f.kind]}>{FEEDBACK_KIND[f.kind]}</Badge></td>
                  <td>{f.guestName}</td>
                  <td>{f.reservationId ? <button className="link" onClick={() => openRes(f.reservationId!)}>{f.roomNumber ?? f.reservationNumber}</button> : '—'}</td>
                  <td>{FEEDBACK_DEPT[f.department]}</td>
                  <td className="nowrap">{f.rating ? <Stars n={f.rating} /> : '—'}</td>
                  <td className="wrap">{f.comment}{f.resolution && <div className="muted" style={{ fontSize: 12 }}>→ {f.resolution} ({f.resolvedBy})</div>}</td>
                  <td>{STATUS[f.status]}</td>
                  <td className="r">{f.status === 'open' && <button className="btn sm" onClick={() => setResolving(f)}>Kapat</button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
      </div>
      {creating && <FeedbackModal onClose={() => setCreating(false)} />}
      {resolving && <ResolveModal f={resolving} onClose={() => setResolving(null)} />}
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return <span className="stars" title={`${n} / 5`}>{[1, 2, 3, 4, 5].map(i => <Star key={i} size={13} className={i <= n ? 'on' : ''} />)}</span>;
}

/** Yorum ekleme: misafir aranır; misafirin konaklamalarından biri (varsa) seçilir. */
export function FeedbackModal({ guest: initialGuest, reservationId, onClose }: { guest?: { id: string; name: string }; reservationId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [guest, setGuest] = useState(initialGuest ?? null);
  const [resId, setResId] = useState(reservationId ?? '');
  const [kind, setKind] = useState<GuestFeedback['kind']>('complaint');
  const [dept, setDept] = useState('front_office');
  const [source, setSource] = useState('in_person');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const stays = useQuery({ queryKey: ['guest', guest?.id, 'stays'], enabled: !!guest && !reservationId,
    queryFn: () => get<GuestProfile>(`/api/v1/guests/${guest!.id}`).then(d => d.stays) });
  const save = async () => {
    setBusy(true);
    try {
      await post('/api/v1/guest-feedback', { guestId: guest!.id, reservationId: resId || null, kind, department: dept, rating: rating || null, source, comment: comment.trim() }, newKey());
      await qc.invalidateQueries({ queryKey: ['guests', 'feedback'] });
      toast.ok('Yorum kaydedildi.'); onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal title="Misafir yorumu" size="lg" onClose={onClose} footer={<>
      {guest && !initialGuest && <button className="btn" onClick={() => { setGuest(null); setResId(''); }}>Başka misafir</button>}
      <span className="spacer" />
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!guest || !comment.trim() || busy} onClick={() => void save()}>Kaydet</button>
    </>}>
      {!guest ? <GuestSearch onPick={(g: GuestListItem) => setGuest({ id: g.id, name: `${g.firstName} ${g.lastName}` })} actionLabel="Seç" /> : (
        <div className="stack">
          <div><b>{guest.name}</b></div>
          {!reservationId && (
            <Field label="Konaklama">
              <select className="input" value={resId} onChange={e => setResId(e.target.value)}>
                <option value="">Konaklamaya bağlı değil</option>
                {(stays.data ?? []).filter(r => r.status !== 'cancelled').map(r => <option key={r.id} value={r.id}>{r.reservationNumber} · {r.roomNumber ?? '—'} · {fmtDate(r.arrival)} – {fmtDate(r.departure)}</option>)}
              </select>
            </Field>
          )}
          <div className="grid cols-3">
            <Field label="Tür"><select className="input" value={kind} onChange={e => setKind(e.target.value as GuestFeedback['kind'])}>{Object.entries(FEEDBACK_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Bölüm"><select className="input" value={dept} onChange={e => setDept(e.target.value)}>{Object.entries(FEEDBACK_DEPT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Kaynak"><select className="input" value={source} onChange={e => setSource(e.target.value)}>{Object.entries(SOURCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          </div>
          <Field label="Puan (isteğe bağlı)">
            <span className="stars pick">{[1, 2, 3, 4, 5].map(i => <button key={i} type="button" onClick={() => setRating(rating === i ? 0 : i)} aria-label={`${i} puan`}><Star size={20} className={i <= rating ? 'on' : ''} /></button>)}</span>
          </Field>
          <Field label="Yorum" required><textarea className="input" rows={4} maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} autoFocus /></Field>
        </div>
      )}
    </Modal>
  );
}

function ResolveModal({ f, onClose }: { f: GuestFeedback; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<'resolved' | 'closed'>('resolved');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await post(`/api/v1/guest-feedback/${f.id}/resolve`, { status, resolution: text.trim() || null });
      await qc.invalidateQueries({ queryKey: ['guests', 'feedback'] });
      toast.ok('Yorum kapatıldı.'); onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Yorum #${f.feedbackNo} · ${f.guestName}`} onClose={onClose} footer={<>
      <span className="spacer" />
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={busy || (status === 'resolved' && !text.trim())} onClick={() => void save()}>Kaydet</button>
    </>}>
      <div className="stack">
        <div className="info-box">{f.comment}</div>
        <div className="seg">
          <button className={status === 'resolved' ? 'active' : ''} onClick={() => setStatus('resolved')}>Çözüldü</button>
          <button className={status === 'closed' ? 'active' : ''} onClick={() => setStatus('closed')}>İşlem gerekmiyor</button>
        </div>
        <Field label={status === 'resolved' ? 'Yapılan işlem' : 'Açıklama'} required={status === 'resolved'}>
          <textarea className="input" rows={3} maxLength={1000} value={text} onChange={e => setText(e.target.value)} autoFocus />
        </Field>
      </div>
    </Modal>
  );
}

/** Kullanımdaki kartlar: konaklayanlara verilmiş oda kartları (kart kilidi programındaki kayıtlarla karşılaştırmak için). */
export function KeyCardsPage() {
  const openRes = useOpenReservation();
  const list = useQuery({ queryKey: ['reservations', 'key-cards'], queryFn: () => get<KeyCardInUse[]>('/api/v1/key-cards/in-use') });
  return (
    <div className="page">
      <PageHead title="Kullanımdaki Kartlar" sub="Konaklayan misafirlere verilmiş oda kartları (Folyo Detayı → misafir satırı → Kart Ver ile kaydedilir)" />
      <div className="card">
        {list.isLoading ? <Spinner /> : list.error ? <ErrorBox error={list.error} /> : !list.data?.length
          ? <Empty icon={<KeyRound />} title="Kayıtlı kart yok" />
          : (
            <div className="table-wrap"><table className="dt">
              <thead><tr><th>Oda</th><th>Misafir</th><th>Kart no</th><th>Çıkış</th><th>Durum</th></tr></thead>
              <tbody>{list.data.map(c => (
                <tr key={`${c.reservationId}-${c.keyCardNo}-${c.guestName}`} className="clickable" onClick={() => openRes(c.reservationId)}>
                  <td><b>{c.roomNumber ?? '—'}</b></td>
                  <td>{c.guestName}{c.isPrimary && <span className="muted"> (ana misafir)</span>}</td>
                  <td className="mono">{c.keyCardNo}</td>
                  <td>{fmtDate(c.departure)}</td>
                  <td>{c.isActive ? 'Aktif' : <span className="muted">Pasif</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
      </div>
    </div>
  );
}
