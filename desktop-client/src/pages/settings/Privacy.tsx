import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eraser, Printer, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { api, get } from '../../lib/api';
import type { Setting } from '../../lib/types';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { PageHead, useAction } from '../../components/common';
import { Badge, Empty, ErrorBox, Field, Modal, Spinner } from '../../components/ui';
import { KvkkFormDoc } from '../../components/KvkkForm';

interface RetentionPreview { years: number; cutoff: string; count: number; sample: { id: string; name: string; nationality?: string; lastStay?: string; createdAt: string }[] }

/** KVKK ayarları: aydınlatma ve açık rıza metni, saklama süresi ve süresi dolan misafir kayıtlarının imhası (anonimleştirme). */
export default function PrivacySettingsPage() {
  const settings = useQuery({ queryKey: ['settings', 'all'], queryFn: () => get<Setting[]>('/api/v1/property/settings') });
  if (settings.isLoading) return <div className="page"><Spinner /></div>;
  if (settings.error) return <div className="page"><ErrorBox error={settings.error} /></div>;
  // Form, ayarlar yüklendikten sonra kurulur; böylece metin kutuları her zaman kayıtlı değerle açılır.
  return <PrivacyForm settings={settings.data!} />;
}

function PrivacyForm({ settings }: { settings: Setting[] }) {
  const qc = useQueryClient();
  const { can, property } = useSession();
  const value = (k: string) => settings.find(s => s.key === k)?.value;
  const [notice, setNotice] = useState(() => String(value('kvkk.notice_text') ?? ''));
  const [consent, setConsent] = useState(() => String(value('kvkk.consent_text') ?? ''));
  const [years, setYears] = useState(() => String(value('kvkk.retention_years') ?? 0));
  const [printing, setPrinting] = useState(false);
  const [purge, setPurge] = useState(false);
  const preview = useQuery({ queryKey: ['privacy', 'retention'], queryFn: () => get<RetentionPreview>('/api/v1/privacy/retention'), enabled: can('guest.privacy') });

  const saveTexts = useAction(async () => {
    await api('PUT', '/api/v1/property/settings/kvkk.notice_text', notice);
    await api('PUT', '/api/v1/property/settings/kvkk.consent_text', consent);
    await qc.invalidateQueries({ queryKey: ['settings'] });
  }, { success: 'Aydınlatma ve rıza metinleri kaydedildi.' });
  const saveYears = useAction(async () => {
    const n = Number(years);
    await api('PUT', '/api/v1/property/settings/kvkk.retention_years', Number.isInteger(n) ? n : -1);
    await qc.invalidateQueries({ queryKey: ['settings'] });
    await qc.invalidateQueries({ queryKey: ['privacy'] });
  }, { success: 'Saklama süresi kaydedildi.' });

  const p = preview.data;
  return (
    <div className="page">
      <PageHead title="KVKK ve Kişisel Veriler" sub="Aydınlatma metni, açık rıza, saklama süresi ve imha" />
      <div className="split">
        <div className="stack">
          <div className="card">
            <div className="card-head"><h3>Aydınlatma metni</h3><span className="spacer" />
              <button className="btn" onClick={() => { setPrinting(true); setTimeout(() => { window.print(); setPrinting(false); }, 80); }}><Printer /> Boş form yazdır</button>
            </div>
            <div className="card-body stack">
              <div className="muted" style={{ fontSize: 12 }}>
                Resepsiyonda misafire imzalatılan metin. <code>{'{UNVAN}'}</code>, <code>{'{OTEL}'}</code>, <code>{'{ADRES}'}</code>, <code>{'{TELEFON}'}</code>, <code>{'{EPOSTA}'}</code> otel bilgileriyle
                (Yönetim → Otel Bilgileri) doldurulur. Metni otelinizin hukuk danışmanıyla gözden geçirin.
              </div>
              <textarea className="input" rows={16} value={notice} onChange={e => setNotice(e.target.value)} style={{ fontSize: 12.5, lineHeight: 1.5 }} />
              <Field label="Ticari elektronik ileti açık rıza metni (isteğe bağlı onay kutusu)">
                <textarea className="input" rows={3} value={consent} onChange={e => setConsent(e.target.value)} />
              </Field>
              <ErrorBox error={saveTexts.error} />
              <div className="row"><span className="spacer" /><button className="btn primary" disabled={saveTexts.busy || !can('settings.manage')} onClick={() => void saveTexts.run()}><Save /> Metinleri kaydet</button></div>
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head"><h3>Saklama süresi</h3></div>
            <div className="card-body stack">
              <div className="muted" style={{ fontSize: 12 }}>
                Son konaklaması bu süreden eski misafirlerin kimlik ve iletişim bilgileri anonimleştirilir. Konaklama, folyo ve muhasebe kayıtları yasal saklama için kalır
                ancak kişiyle ilişkilendirilemez. Süreyi otelinizin kişisel veri saklama ve imha politikasına göre belirleyin; 0 girilirse imha önerilmez.
              </div>
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <Field label="Süre (yıl)"><input className="input" type="number" min={0} max={50} style={{ width: 110 }} value={years} onChange={e => setYears(e.target.value)} /></Field>
                <button className="btn" disabled={saveYears.busy || !can('settings.manage')} onClick={() => void saveYears.run()}><Save /> Kaydet</button>
              </div>
              <ErrorBox error={saveYears.error} />
            </div>
          </div>

          {can('guest.privacy') && (
            <div className="card">
              <div className="card-head"><h3>İmha (anonimleştirme)</h3><span className="spacer" />
                <button className="btn ghost icon" title="Yenile" onClick={() => void preview.refetch()}><RotateCcw /></button>
              </div>
              <div className="card-body stack">
                {preview.isLoading ? <Spinner /> : preview.error ? <ErrorBox error={preview.error} /> : !p || p.years === 0
                  ? <Empty icon={<ShieldCheck />} title="Saklama süresi belirlenmemiş" text="Süreyi girdikten sonra imha edilecek kayıtlar burada listelenir." />
                  : <>
                    <div className="row"><Badge color={p.count ? 'orange' : 'green'}>{p.count} misafir</Badge>
                      <span className="muted">Son konaklaması {fmtDate(p.cutoff)} tarihinden önce, açık rezervasyonu ve açık folyosu olmayanlar</span></div>
                    {p.sample.length > 0 && (
                      <div className="table-wrap" style={{ maxHeight: 260 }}>
                        <table className="dt"><thead><tr><th>Misafir</th><th>Uyruk</th><th>Son konaklama</th><th>Kayıt</th></tr></thead>
                          <tbody>{p.sample.map(s => <tr key={s.id}><td>{s.name}</td><td>{s.nationality}</td><td>{s.lastStay ? fmtDate(s.lastStay) : '—'}</td><td>{fmtDateTime(s.createdAt)}</td></tr>)}</tbody>
                        </table>
                      </div>
                    )}
                    <div className="row"><span className="spacer" /><button className="btn danger" disabled={p.count === 0} onClick={() => setPurge(true)}><Eraser /> Anonimleştir ({p.count})</button></div>
                  </>}
              </div>
            </div>
          )}
        </div>
      </div>
      {purge && p && <PurgeModal count={p.count} onClose={() => setPurge(false)} />}
      {printing && createPortal(<KvkkFormDoc people={[{ name: '' }]} notice={notice} consent={consent} property={property} />, document.getElementById('print-root')!)}
    </div>
  );
}

function PurgeModal({ count, onClose }: { count: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('Saklama süresi dolan kişisel verilerin periyodik imhası');
  const act = useAction(async () => {
    const r = await api<{ anonymized: number; documentsDeleted: number }>('POST', '/api/v1/privacy/retention/purge', { reason });
    await qc.invalidateQueries({ queryKey: ['privacy'] });
    await qc.invalidateQueries({ queryKey: ['guests'] });
    return r;
  }, { success: 'Kayıtlar anonimleştirildi.' });
  return (
    <Modal title="Saklama süresi dolan kayıtları anonimleştir" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn danger" disabled={!reason.trim() || act.busy} onClick={async () => { if (await act.run() !== undefined) onClose(); }}><Eraser /> Anonimleştir</button>
    </>}>
      <div className="stack">
        <div className="warn-box">{count} misafirin ad, kimlik, iletişim ve adres bilgileri kalıcı olarak silinecek; kimlik belgesi dosyaları diskten imha edilecek. Bu işlem geri alınamaz.
          İşlemden önce güncel bir yedek alındığından emin olun (yedeklerde eski veriler bulunur; yedek saklama süresini de politikanıza göre yönetin).</div>
        <Field label="Gerekçe" required><textarea className="input" rows={2} value={reason} onChange={e => setReason(e.target.value)} /></Field>
        <ErrorBox error={act.error} />
      </div>
    </Modal>
  );
}
