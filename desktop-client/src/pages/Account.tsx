import { useSession } from '../lib/session';
import { ROLE_LABEL } from '../lib/format';
import { Kv, PageHead } from '../components/common';
import { useToast } from '../components/ui';
import { ChangePasswordForm } from './Auth';

export default function AccountPage() {
  const { me, client } = useSession();
  const toast = useToast();
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <PageHead title="Hesabım" />
      <div className="grid cols-2">
        <div className="card"><div className="card-head"><h3>Kullanıcı</h3></div><div className="card-body">
          <Kv items={[['Ad soyad', me?.fullName], ['Kullanıcı adı', me?.username], ['Roller', me?.roles.map(r => ROLE_LABEL[r] ?? r).join(', ')], ['Bu bilgisayar', client?.hostname], ['İstemci sürümü', client?.version]]} />
        </div></div>
        <div className="card"><div className="card-head"><h3>Parola değiştir</h3></div><div className="card-body">
          <ChangePasswordForm onDone={() => toast.ok('Parolanız değiştirildi. Diğer cihazlardaki oturumlarınız kapatıldı.')} />
        </div></div>
      </div>
    </div>
  );
}
