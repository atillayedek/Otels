import { useQuery } from '@tanstack/react-query';
import { get } from '../../lib/api';
import type { Integration } from '../../lib/types';
import { PageHead } from '../../components/common';
import { Badge, DataTable, Empty, ErrorBox, type Column } from '../../components/ui';

const CAT: Record<string, string> = { identity: 'Kimlik bildirimi', channel: 'Kanal yönetimi', accounting: 'Muhasebe', einvoice: 'E-fatura', payment: 'Ödeme', door_lock: 'Kapı kilidi', pbx: 'Santral', pos: 'POS' };

export default function IntegrationsSettingsPage() {
  const list = useQuery({ queryKey: ['settings', 'integrations'], queryFn: () => get<Integration[]>('/api/v1/integrations') });
  const cols: Column<Integration>[] = [
    { key: 'displayName', header: 'Entegrasyon' },
    { key: 'category', header: 'Kategori', width: 170, value: i => CAT[i.category] ?? i.category },
    { key: 'status', header: 'Durum', width: 260, render: i => !i.implemented ? <Badge color="gray">Bu sürümde bulunmuyor</Badge> : i.enabled ? <Badge color="green">Etkin</Badge> : <Badge color="orange">Yapılandırılmamış</Badge> },
  ];
  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <PageHead title="Entegrasyonlar" />
      <div className="info-box" style={{ marginBottom: 12 }}>Dış sistem entegrasyonları yalnız gerçek ve doğrulanmış bağlantı bilgileriyle çalışır. Yapılandırılmamış bir entegrasyon işlem yapmış gibi davranmaz; ilgili ekranlarda açıkça belirtilir.</div>
      {list.error ? <ErrorBox error={list.error} /> : <DataTable rows={list.data ?? []} columns={cols} rowKey={i => i.code} empty={<Empty title="Entegrasyon tanımı yok" />} />}
    </div>
  );
}
