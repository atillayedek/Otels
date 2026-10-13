import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DatabaseBackup, Save } from 'lucide-react';
import { api, get } from '../../lib/api';
import type { Backup, BackupPolicy } from '../../lib/types';
import { fmtBytes, fmtDateTime } from '../../lib/format';
import { PageHead, useAction } from '../../components/common';
import { Badge, DataTable, Empty, ErrorBox, Field, Spinner, type Column } from '../../components/ui';

const KIND: Record<string, string> = { scheduled: 'Zamanlanmış', manual: 'Elle', pre_schema: 'Güncelleme öncesi', pre_restore: 'Geri yükleme öncesi', pre_import: 'Aktarım öncesi' };
const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

export default function BackupSettingsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['settings', 'backups'], queryFn: () => get<Backup[]>('/api/v1/backups') });
  const policy = useQuery({ queryKey: ['settings', 'backupPolicy'], queryFn: () => get<BackupPolicy & { weeklyDay: number | string }>('/api/v1/backups/policy') });
  const [p, setP] = useState<BackupPolicy | null>(null);
  useEffect(() => {
    if (!policy.data) return;
    const wd = policy.data.weeklyDay;
    setP({ ...policy.data, weeklyDay: typeof wd === 'string' ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(wd) : wd });
  }, [policy.data]);
  const create = useAction(async () => { await api('POST', '/api/v1/backups'); await qc.invalidateQueries({ queryKey: ['settings', 'backups'] }); }, { success: 'Yedek alındı.' });
  const savePolicy = useAction(async () => { await api('PUT', '/api/v1/backups/policy', { ...p, secondaryDirectory: p!.secondaryDirectory || null }); await qc.invalidateQueries({ queryKey: ['settings', 'backupPolicy'] }); }, { success: 'Yedekleme ayarları kaydedildi.' });

  const cols: Column<Backup>[] = [
    { key: 'startedAt', header: 'Tarih', width: 150, render: b => fmtDateTime(b.startedAt) },
    { key: 'kind', header: 'Tür', width: 150, value: b => KIND[b.kind] ?? b.kind },
    { key: 'fileName', header: 'Dosya' },
    { key: 'sizeBytes', header: 'Boyut', align: 'right', width: 100, render: b => fmtBytes(b.sizeBytes) },
    { key: 'status', header: 'Durum', width: 110, render: b => b.status === 'completed' ? <Badge color="green">Tamam</Badge> : b.status === 'failed' ? <Badge color="red">Başarısız</Badge> : <Badge color="blue">{b.status}</Badge> },
    { key: 'secondaryStatus', header: 'İkinci kopya', width: 120, value: b => b.secondaryStatus ?? '' },
    { key: 'username', header: 'Kullanıcı', width: 110 },
  ];

  return (
    <div className="page">
      <PageHead title="Yedekleme" sub="Yedekler sunucu bilgisayarında saklanır" actions={<button className="btn primary" disabled={create.busy} onClick={() => void create.run()}><DatabaseBackup /> {create.busy ? 'Yedek alınıyor…' : 'Şimdi yedek al'}</button>} />
      <div className="info-box" style={{ marginBottom: 12 }}>Geri yükleme yalnız sunucu bilgisayarındaki <b>PMS Server Manager</b> üzerinden yapılır; geri yüklemeden önce mevcut veritabanının güvenlik yedeği otomatik alınır.</div>
      <div className="split">
        {list.error ? <ErrorBox error={list.error} /> : <DataTable rows={list.data ?? []} columns={cols} rowKey={b => b.id} maxHeight="calc(100vh - 260px)" empty={<Empty title={list.isLoading ? 'Yükleniyor…' : 'Henüz yedek alınmadı.'} />} />}
        <div className="card"><div className="card-head"><h3>Otomatik yedekleme</h3></div><div className="card-body">
          {!p ? <Spinner /> : (
            <div className="stack">
              <Field label="Sıklık"><select className="input" value={p.schedule} onChange={e => setP({ ...p, schedule: e.target.value })}><option value="daily">Her gün</option><option value="weekly">Haftalık</option><option value="monthly">Aylık</option><option value="off">Kapalı</option></select></Field>
              <Field label="Saat"><input type="time" className="input" value={p.time.slice(0, 5)} onChange={e => setP({ ...p, time: e.target.value })} /></Field>
              {p.schedule === 'weekly' && <Field label="Gün"><select className="input" value={p.weeklyDay} onChange={e => setP({ ...p, weeklyDay: Number(e.target.value) })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></Field>}
              {p.schedule === 'monthly' && <Field label="Ayın günü"><input type="number" min={1} max={28} className="input" value={p.monthlyDay} onChange={e => setP({ ...p, monthlyDay: Number(e.target.value) })} /></Field>}
              <Field label="Yedek klasörü" hint="Sunucu bilgisayarındaki klasör"><input className="input" value={p.primaryDirectory} onChange={e => setP({ ...p, primaryDirectory: e.target.value })} /></Field>
              <Field label="İkinci kopya klasörü" hint="Farklı disk veya ağ klasörü önerilir"><input className="input" value={p.secondaryDirectory ?? ''} onChange={e => setP({ ...p, secondaryDirectory: e.target.value })} placeholder="Örn. D:\PMS-Yedek" /></Field>
              <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <Field label="Zamanlanmış"><input type="number" min={1} className="input" value={p.keepScheduled} onChange={e => setP({ ...p, keepScheduled: Number(e.target.value) })} /></Field>
                <Field label="Elle"><input type="number" min={1} className="input" value={p.keepManual} onChange={e => setP({ ...p, keepManual: Number(e.target.value) })} /></Field>
                <Field label="Sistem"><input type="number" min={1} className="input" value={p.keepSystem} onChange={e => setP({ ...p, keepSystem: Number(e.target.value) })} /></Field>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>Saklanacak yedek sayısı; eskiler otomatik silinir.</div>
              <ErrorBox error={savePolicy.error} />
              <button className="btn primary" disabled={savePolicy.busy} onClick={() => void savePolicy.run()}><Save /> Kaydet</button>
            </div>
          )}
        </div></div>
      </div>
    </div>
  );
}
