import { useQuery } from '@tanstack/react-query';
import { Printer as PrinterIcon } from 'lucide-react';
import { get } from '../../lib/api';
import type { Printer } from '../../lib/types';
import { PageHead } from '../../components/common';
import { Badge, Empty, ErrorBox, Spinner } from '../../components/ui';

export default function PrintersSettingsPage() {
  const list = useQuery({ queryKey: ['settings', 'printers'], queryFn: () => get<Printer[]>('/api/v1/system/printers') });
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <PageHead title="Yazıcılar" />
      <div className="info-box" style={{ marginBottom: 12 }}>Folyo ve raporlar, bu bilgisayarın yazdırma penceresi ile seçtiğiniz yazıcıya gönderilir. Aşağıda sunucu bilgisayarında kurulu yazıcılar listelenir.</div>
      <div className="card"><div className="card-head"><PrinterIcon size={16} /><h3>Sunucudaki yazıcılar</h3></div><div className="card-body">
        {list.isLoading ? <Spinner /> : list.error ? <ErrorBox error={list.error} /> : list.data!.length === 0 ? <Empty title="Sunucuda kurulu yazıcı bulunamadı" /> : (
          <ul className="list-plain">{list.data!.map(p => <li key={p.name}><PrinterIcon size={14} />{p.name}{p.isDefault && <Badge color="blue">Varsayılan</Badge>}</li>)}</ul>
        )}
      </div></div>
    </div>
  );
}
