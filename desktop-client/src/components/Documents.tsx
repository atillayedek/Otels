import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { open, save } from '@tauri-apps/plugin-dialog';
import { Download, FileUp, Trash2 } from 'lucide-react';
import { del, download, get, qs, upload } from '../lib/api';
import type { Document } from '../lib/types';
import { fmtBytes, fmtDateTime } from '../lib/format';
import { Empty, ErrorBox, Spinner, useConfirm, useToast } from './ui';

const CATEGORIES: Record<string, string> = { identity: 'Kimlik kartı', passport: 'Pasaport', contract: 'Sözleşme', invoice: 'Fatura', other: 'Diğer' };

/** Kayda bağlı belgeler: PDF/JPG/PNG yükleme, kaydetme ve silme. Sunucu dosya türünü içerikten doğrular; erişim denetim kaydına yazılır. */
export function DocumentsPanel({ entityType, entityId, canEdit }: { entityType: 'guest' | 'reservation' | 'company' | 'agency'; entityId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [category, setCategory] = useState(entityType === 'guest' ? 'identity' : 'other');
  const [busy, setBusy] = useState(false);
  const docs = useQuery({ queryKey: ['documents', entityType, entityId], queryFn: () => get<Document[]>(`/api/v1/documents${qs({ entityType, entityId })}`) });

  const add = async () => {
    const path = await open({ multiple: false, filters: [{ name: 'Belge (PDF, JPG, PNG)', extensions: ['pdf', 'jpg', 'jpeg', 'png'] }] });
    if (!path || Array.isArray(path)) return;
    setBusy(true);
    try {
      await upload('/api/v1/documents', path, { entityType, entityId, category });
      await qc.invalidateQueries({ queryKey: ['documents', entityType, entityId] });
      toast.ok('Belge yüklendi.');
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const saveAs = async (d: Document) => {
    const path = await save({ defaultPath: d.originalName });
    if (!path) return;
    try { await download(`/api/v1/documents/${d.id}/content`, path); toast.ok('Belge kaydedildi.', path); } catch (e) { toast.error(e); }
  };
  const remove = async (d: Document) => {
    if (!await confirm({ title: 'Belgeyi kaldır', message: `"${d.originalName}" kayıttan kaldırılacak. İşlem denetim kaydına yazılır.`, danger: true, confirmText: 'Kaldır' })) return;
    try { await del(`/api/v1/documents/${d.id}`); await qc.invalidateQueries({ queryKey: ['documents', entityType, entityId] }); } catch (e) { toast.error(e); }
  };

  if (docs.isLoading) return <Spinner />;
  if (docs.error) return <ErrorBox error={docs.error} />;
  return (
    <div className="stack">
      {canEdit && (
        <div className="row wrap">
          <select className="input" style={{ width: 170 }} value={category} onChange={e => setCategory(e.target.value)}>{Object.entries(CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <button className="btn primary" disabled={busy} onClick={() => void add()}><FileUp /> {busy ? 'Yükleniyor…' : 'Belge yükle'}</button>
          <span className="muted" style={{ fontSize: 12 }}>PDF, JPG veya PNG. Belgeler sunucuda saklanır, internete gönderilmez.</span>
        </div>
      )}
      {(docs.data ?? []).length === 0 ? <Empty title="Belge yok" /> : (
        <table className="dt">
          <thead><tr><th>Belge</th><th>Tür</th><th style={{ textAlign: 'right' }}>Boyut</th><th>Yükleme</th><th /></tr></thead>
          <tbody>{docs.data!.map(d => (
            <tr key={d.id}>
              <td>{d.originalName}</td><td>{CATEGORIES[d.category] ?? d.category}</td><td className="num">{fmtBytes(d.sizeBytes)}</td>
              <td>{fmtDateTime(d.uploadedAt)}{d.uploadedBy ? ` · ${d.uploadedBy}` : ''}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button className="btn sm" onClick={() => void saveAs(d)}><Download /> Kaydet</button>
                {canEdit && <button className="btn sm ghost icon" title="Kaldır" onClick={() => void remove(d)}><Trash2 /></button>}
              </td>
            </tr>))}</tbody>
        </table>
      )}
    </div>
  );
}
