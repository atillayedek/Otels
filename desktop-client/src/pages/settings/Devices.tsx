import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, RotateCcw } from 'lucide-react';
import { api, get } from '../../lib/api';
import type { Device, Session } from '../../lib/types';
import { fmtDateTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { PageHead } from '../../components/common';
import { Badge, DataTable, Empty, Tabs, useConfirm, useToast, type Column } from '../../components/ui';

export default function DevicesSettingsPage() {
  const { can, client } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<'devices' | 'sessions'>('devices');
  const devices = useQuery({ queryKey: ['settings', 'devices'], queryFn: () => get<Device[]>('/api/v1/devices') });
  const sessions = useQuery({ queryKey: ['settings', 'sessions'], queryFn: () => get<Session[]>('/api/v1/sessions'), enabled: can('user.manage') });
  const run = async (path: string, msg: string, question?: string) => {
    if (question && !await confirm({ title: 'Onay', message: question, danger: true, confirmText: 'Onayla' })) return;
    try { await api('POST', path); toast.ok(msg); await qc.invalidateQueries({ queryKey: ['settings'] }); } catch (e) { toast.error(e); }
  };
  const dcols: Column<Device>[] = [
    { key: 'name', header: 'Cihaz', render: d => <>{d.name}{d.id === client?.deviceId && <Badge color="blue">Bu bilgisayar</Badge>}</> }, { key: 'hostname', header: 'Bilgisayar adı' }, { key: 'lastIp', header: 'Son IP', width: 130 },
    { key: 'clientVersion', header: 'Sürüm', width: 90 }, { key: 'lastUser', header: 'Son kullanıcı' }, { key: 'lastSeenAt', header: 'Son görülme', width: 140, render: d => fmtDateTime(d.lastSeenAt) },
    { key: 'status', header: 'Durum', width: 90, render: d => d.status === 'active' ? <Badge color="green">Etkin</Badge> : <Badge color="red">Engelli</Badge> },
    { key: 'act', header: '', width: 140, render: d => d.status === 'active'
      ? <button className="btn sm danger" disabled={d.id === client?.deviceId} onClick={e => { e.stopPropagation(); void run(`/api/v1/devices/${d.id}/revoke`, 'Cihaz engellendi.', `"${d.name}" cihazı engellenecek ve açık oturumları kapatılacak.`); }}><Ban /> Engelle</button>
      : <button className="btn sm" onClick={e => { e.stopPropagation(); void run(`/api/v1/devices/${d.id}/restore`, 'Cihaz yeniden etkinleştirildi.'); }}><RotateCcw /> Etkinleştir</button> },
  ];
  const scols: Column<Session>[] = [
    { key: 'username', header: 'Kullanıcı' }, { key: 'deviceName', header: 'Cihaz' }, { key: 'ip', header: 'IP', width: 130 },
    { key: 'createdAt', header: 'Başlangıç', width: 140, render: s => fmtDateTime(s.createdAt) }, { key: 'lastSeenAt', header: 'Son etkinlik', width: 140, render: s => fmtDateTime(s.lastSeenAt) },
    { key: 'expiresAt', header: 'Geçerlilik', width: 140, render: s => fmtDateTime(s.expiresAt) },
    { key: 'act', header: '', width: 120, render: s => <button className="btn sm" onClick={() => void run(`/api/v1/sessions/${s.id}/revoke`, 'Oturum kapatıldı.', `${s.username} kullanıcısının oturumu kapatılacak.`)}>Oturumu kapat</button> },
  ];
  return (
    <div className="page">
      <PageHead title="Cihazlar ve Oturumlar" sub="Sunucuya bağlanan bilgisayarlar" />
      <Tabs value={tab} onChange={setTab} items={[{ key: 'devices', label: 'Cihazlar', count: devices.data?.length }, ...(can('user.manage') ? [{ key: 'sessions' as const, label: 'Açık oturumlar', count: sessions.data?.length }] : [])]} />
      {tab === 'devices' ? <DataTable rows={devices.data ?? []} columns={dcols} rowKey={d => d.id} empty={<Empty title="Kayıtlı cihaz yok" />} />
        : <DataTable rows={sessions.data ?? []} columns={scols} rowKey={s => s.id} empty={<Empty title="Açık oturum yok" />} />}
    </div>
  );
}
