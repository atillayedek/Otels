import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, IdCard, Printer } from 'lucide-react';
import { get, post } from '../lib/api';
import { fmtDate, fmtDateTime, KBS_STATUS } from '../lib/format';
import { useSession } from '../lib/session';
import { useAction } from './common';
import { ID_TYPES } from './GuestFields';
import { Badge, ErrorBox, Field, Modal, Spinner, useToast } from './ui';

interface FormGuest {
  guestId: string; isPrimary: boolean; firstName: string; lastName: string; gender?: string; birthDate?: string; birthPlace?: string; fatherName?: string;
  motherName?: string; nationality?: string; identityType?: string; identityNumber?: string; identityCountry?: string; identityExpiry?: string;
  reportId?: string; reportStatus?: string; manualReference?: string; missing: string[];
}
interface KbsFormData {
  reservation: { reservationId: string; reservationNumber: string; roomNumber?: string; arrival: string; departure: string; checkedInAt?: string; status: string; propertyName: string; propertyAddress?: string; propertyCity?: string };
  guests: FormGuest[];
  automaticSendingAvailable: boolean;
  identityVisible: boolean;
}

const GENDER: Record<string, string> = { male: 'Erkek', female: 'Kadın', other: 'Diğer' };
const DONE = ['accepted', 'reported_manually', 'superseded'];

/** Check-in sonrası: "KBS'ye bildirilsin mi?" sorusu. */
export function KbsPromptModal({ reservationId, onClose }: { reservationId: string; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const st = useQuery({ queryKey: ['kbs', 'status'], queryFn: () => get<{ configured: boolean; message: string }>('/api/v1/kbs/status') });
  if (open) return <KbsFormModal reservationId={reservationId} onClose={onClose} />;
  return (
    <Modal title="Kimlik bildirimi" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Şimdi değil</button>
      <button className="btn primary" onClick={() => setOpen(true)}><IdCard /> Evet, KBS'ye bildir</button>
    </>}>
      <div className="stack">
        <div>Giriş tamamlandı. Odadaki misafirler KBS'ye bildirilsin mi?</div>
        {st.data && !st.data.configured && (
          <div className="info-box">Resmi KBS bağlantısı yapılandırılmamış. "Evet" derseniz oda numarası ve tüm misafir bilgileri dolu bildirim formu açılır; bilgileri resmi KBS ekranına girip verilen referans numarasını kaydedersiniz.</div>
        )}
        <div className="muted" style={{ fontSize: 12 }}>"Şimdi değil" derseniz bildirim kuyrukta bekler; Resepsiyon → Kimlik Bildirimi (KBS) ekranından sonra yapabilirsiniz.</div>
      </div>
    </Modal>
  );
}

/** Konaklamanın KBS bildirim formu: alanlar hazır doldurulur, kopyalanabilir/yazdırılabilir; referans girilince odanın tüm bildirimleri işaretlenir. */
export function KbsFormModal({ reservationId, onClose }: { reservationId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useSession();
  const form = useQuery({ queryKey: ['kbs', 'form', reservationId], queryFn: () => get<KbsFormData>(`/api/v1/kbs/reservations/${reservationId}/form`) });
  const [ref, setRef] = useState('');
  const [printing, setPrinting] = useState(false);
  const save = useAction(async (key: string) => {
    const r = await post<{ count: number }>(`/api/v1/kbs/reservations/${reservationId}/manual`, { reference: ref.trim(), reason: 'Resmi KBS ekranından bildirildi' }, key);
    await qc.invalidateQueries({ queryKey: ['kbs'] });
    return r;
  }, { success: r => `${r.count} misafirin bildirimi kaydedildi.` });

  const copy = async (text?: string) => {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); toast.info('Kopyalandı.'); } catch { toast.error('Panoya kopyalanamadı.'); }
  };

  if (form.isLoading) return <Modal title="KBS bildirim formu" onClose={onClose}><Spinner /></Modal>;
  if (form.error || !form.data) return <Modal title="KBS bildirim formu" onClose={onClose}><ErrorBox error={form.error} /></Modal>;
  const f = form.data;
  const r = f.reservation;
  const pending = f.guests.filter(g => g.reportStatus && !DONE.includes(g.reportStatus));
  const missingAny = f.guests.some(g => g.missing.length > 0);

  const row = (label: string, value?: string) => (
    <tr key={label}><td className="muted" style={{ width: 150 }}>{label}</td><td>{value || <span style={{ color: 'var(--danger)' }}>boş</span>}</td>
      <td style={{ width: 36 }}>{value && <button className="btn sm ghost icon" title="Kopyala" onClick={() => void copy(value)}><Copy /></button>}</td></tr>
  );

  return (
    <Modal title={`KBS bildirim formu · Oda ${r.roomNumber ?? '—'}`} size="xl" onClose={onClose} footer={<>
      <button className="btn" onClick={() => { setPrinting(true); setTimeout(() => { window.print(); setPrinting(false); }, 50); }}><Printer /> Yazdır</button>
      <span className="spacer" />
      <button className="btn" onClick={onClose}>Kapat</button>
    </>}>
      <div className="stack">
        <div className="row wrap">
          <b>{r.propertyName}</b><span className="muted">Oda <b>{r.roomNumber ?? '—'}</b> · Giriş {fmtDate(r.arrival)} · Çıkış {fmtDate(r.departure)} · Rez. {r.reservationNumber}{r.checkedInAt ? ` · Giriş saati ${fmtDateTime(r.checkedInAt)}` : ''}</span>
        </div>
        {f.automaticSendingAvailable
          ? <div className="ok-box">KBS bağlantısı etkin; bildirimler otomatik gönderilir. Durumları aşağıda görebilirsiniz.</div>
          : <div className="info-box">Resmi KBS bağlantısı yapılandırılmamış. Aşağıdaki bilgileri resmi KBS ekranına girin, bildirim sonrası verilen referans numarasını en altta kaydedin.</div>}
        {!f.identityVisible && <div className="warn-box">Kimlik numaralarını maskesiz görme yetkiniz yok; numaralar maskeli gösteriliyor.</div>}
        {missingAny && <div className="warn-box">Bazı misafirlerde boş alanlar var. Misafir kartından tamamlayıp formu yeniden açın.</div>}

        <div className="grid cols-2">
          {f.guests.map((g, i) => (
            <div key={g.guestId} className="card">
              <div className="card-head">
                <h3>{i + 1}. {g.firstName} {g.lastName}</h3>
                {g.isPrimary && <Badge color="blue">Ana misafir</Badge>}
                <div className="right">{g.reportStatus ? <Badge color={DONE.includes(g.reportStatus) ? 'green' : 'orange'}>{KBS_STATUS[g.reportStatus] ?? g.reportStatus}</Badge> : <Badge color="gray">Bildirim kaydı yok</Badge>}</div>
              </div>
              <div className="card-body tight">
                <table className="dt"><tbody>
                  {row('Oda no', r.roomNumber)}
                  {row('Ad', g.firstName)}
                  {row('Soyad', g.lastName)}
                  {row('Uyruk', g.nationality)}
                  {row('Kimlik türü', g.identityType ? ID_TYPES[g.identityType] ?? g.identityType : undefined)}
                  {row('Kimlik / pasaport no', g.identityNumber)}
                  {row('Doğum tarihi', g.birthDate ? fmtDate(g.birthDate) : undefined)}
                  {row('Cinsiyet', g.gender ? GENDER[g.gender] ?? g.gender : undefined)}
                  {row('Doğum yeri', g.birthPlace)}
                  {row('Baba adı', g.fatherName)}
                  {row('Anne adı', g.motherName)}
                  {g.identityCountry && row('Belgeyi veren ülke', g.identityCountry)}
                  {g.identityExpiry && row('Belge geçerlilik', fmtDate(g.identityExpiry))}
                  {row('Giriş tarihi', fmtDate(r.arrival))}
                  {row('Çıkış tarihi', fmtDate(r.departure))}
                </tbody></table>
                {g.manualReference && <div className="muted" style={{ padding: 8 }}>Referans: {g.manualReference}</div>}
              </div>
            </div>
          ))}
        </div>

        {!f.automaticSendingAvailable && can('kbs.manage') && (
          pending.length === 0
            ? <div className="ok-box row"><CheckCircle2 size={15} /> Bu konaklamanın bekleyen kimlik bildirimi yok.</div>
            : (
              <div className="card"><div className="card-body row wrap" style={{ alignItems: 'flex-end' }}>
                <Field label="Resmi KBS referans numarası" required hint={`${pending.length} misafirin bildirimi bu referansla kaydedilir.`}>
                  <input className="input" style={{ width: 260 }} value={ref} onChange={e => setRef(e.target.value)} maxLength={100} />
                </Field>
                <button className="btn primary" disabled={!ref.trim() || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}><CheckCircle2 /> Bildirildi olarak kaydet</button>
              </div></div>
            )
        )}
        <ErrorBox error={save.error} />
      </div>
      {printing && createPortal(
        <div className="doc">
          <div className="doc-head"><div><h1>Kimlik Bildirim Formu</h1><div>{r.propertyName}</div><div>{r.propertyAddress} {r.propertyCity}</div></div>
            <div style={{ textAlign: 'right' }}><div>Oda {r.roomNumber ?? '—'}</div><div>{fmtDate(r.arrival)} – {fmtDate(r.departure)}</div><div>Rez. {r.reservationNumber}</div></div></div>
          <table>
            <thead><tr><th>Ad soyad</th><th>Uyruk</th><th>Kimlik türü / no</th><th>Doğum tarihi</th><th>Cinsiyet</th><th>Baba / anne adı</th></tr></thead>
            <tbody>{f.guests.map(g => <tr key={g.guestId}><td>{g.firstName} {g.lastName}</td><td>{g.nationality}</td><td>{g.identityType ? ID_TYPES[g.identityType] ?? g.identityType : ''} {g.identityNumber}</td>
              <td>{fmtDate(g.birthDate)}</td><td>{g.gender ? GENDER[g.gender] ?? '' : ''}</td><td>{[g.fatherName, g.motherName].filter(Boolean).join(' / ')}</td></tr>)}</tbody>
          </table>
          <div className="fine">Yazdırma: {fmtDateTime(new Date().toISOString())}. Bu belge kişisel veri içerir; işi bitince güvenli biçimde imha edin.</div>
        </div>, document.getElementById('print-root')!)}
    </Modal>
  );
}
