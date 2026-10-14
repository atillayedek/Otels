import { useQuery } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import { AlarmClock, BedDouble, Brush, IdCard, Moon, Percent, PlaneLanding, PlaneTakeoff, Sparkles, Users, Wrench } from 'lucide-react';
import { get } from '../lib/api';
import type { Dashboard } from '../lib/types';
import { fmtDate, fmtDay, fmtMoney, fmtPct } from '../lib/format';
import { useSession } from '../lib/session';
import { PageHead, Stat } from '../components/common';
import { Empty, ErrorBox, Spinner } from '../components/ui';
import { firstAllowedRoute } from '../components/Layout';

export default function DashboardPage() {
  const nav = useNavigate();
  const { can } = useSession();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => get<Dashboard>('/api/v1/dashboard'), enabled: can('dashboard.view') });

  if (!can('dashboard.view')) {
    const to = firstAllowedRoute(can);
    if (to && to !== '/') return <Navigate to={to} replace />;
    return <div className="page"><Empty title="Hesabınıza tanımlı ekran yok" text="Yöneticinizden rolünüze yetki eklemesini isteyin." /></div>;
  }
  if (q.isLoading) return <div className="page"><Spinner /></div>;
  if (q.error) return <div className="page"><ErrorBox error={q.error} /></div>;
  const d = q.data!;
  const money = (v: string) => fmtMoney(v, d.currency);
  const noRooms = d.roomsTotal === 0;

  return (
    <div className="page">
      <PageHead title="Genel Durum" sub={`${d.hotelName} · İş günü ${fmtDate(d.businessDate)}${d.lastNightAudit ? ` · Son gece denetimi ${fmtDate(d.lastNightAudit)}` : ''}`} />

      {noRooms && (
        <div className="info-box" style={{ marginBottom: 14 }}>
          Henüz oda tanımlanmamış. <b>Yönetim → Oda ve Oda Tipleri</b> ekranından oda tiplerini ve odaları ekleyin; eski programınızdaki misafir ve cari kayıtlarını <b>Veri Aktarım Merkezi</b>'nden alabilirsiniz.
          <div className="row" style={{ marginTop: 8 }}>
            {can('room.manage') && <button className="btn sm primary" onClick={() => nav('/settings/rooms')}>Oda tanımla</button>}
            {can('migration.manage') && <button className="btn sm" onClick={() => nav('/settings/import')}>Veri Aktarım Merkezi</button>}
          </div>
        </div>
      )}

      <div className="grid cols-6" style={{ marginBottom: 14 }}>
        <div className="card"><Stat label="Doluluk" value={`%${fmtPct(d.occupancyPct)}`} foot={`${d.occupied} / ${d.roomsTotal} oda`} accent="var(--violet)" icon={<Percent />} onClick={() => nav('/rack')} /></div>
        <div className="card"><Stat label="Beklenen geliş" value={d.arrivalsExpected} foot={`${d.arrivalsCheckedIn} giriş yapıldı`} accent="var(--st-arrival)" icon={<PlaneLanding />} onClick={() => nav('/reservations?view=arrivals')} /></div>
        <div className="card"><Stat label="Beklenen çıkış" value={d.departuresExpected} foot={`${d.departuresCheckedOut} çıkış yapıldı`} accent="var(--warning)" icon={<PlaneTakeoff />} onClick={() => nav('/reservations?view=departures')} /></div>
        <div className="card"><Stat label="Konaklayan misafir" value={d.guestsInHouse} foot="kişi" accent="var(--success)" icon={<Users />} onClick={() => nav('/reservations?view=inhouse')} /></div>
        <div className="card"><Stat label="Boş temiz" value={d.vacantClean} foot={`${d.vacantDirty} boş kirli`} accent="var(--st-clean)" icon={<Sparkles />} onClick={() => nav('/housekeeping')} /></div>
        <div className="card"><Stat label="Arızalı / bloke" value={d.outOfOrder} foot="oda" accent="var(--st-ooo)" icon={<Wrench />} onClick={() => nav('/maintenance/blocks')} /></div>
      </div>

      <div className="grid cols-3">
        <div className="card">
          <div className="card-head"><h3>Bugünün gelirleri</h3></div>
          <div className="card-body">
            <ul className="list-plain">
              <li><span>Oda geliri</span><span className="spacer" /><b className="num">{money(d.roomRevenueToday)}</b></li>
              <li><span>Diğer gelirler</span><span className="spacer" /><b className="num">{money(d.otherRevenueToday)}</b></li>
              <li><span>Tahsilat</span><span className="spacer" /><b className="num">{money(d.paymentsToday)}</b></li>
              <li><span>Açık folyo bakiyesi</span><span className="spacer" /><b className="num">{money(d.openBalance)}</b></li>
            </ul>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Bekleyen işler</h3></div>
          <div className="card-body">
            <ul className="list-plain">
              <Todo icon={<PlaneLanding size={15} />} label="Giriş bekleyen" n={d.arrivalsExpected} onClick={() => nav('/reservations?view=arrivals')} />
              <Todo icon={<PlaneTakeoff size={15} />} label="Çıkış bekleyen" n={d.departuresExpected} onClick={() => nav('/reservations?view=departures')} />
              <Todo icon={<Brush size={15} />} label="Açık kat hizmeti görevi" n={d.openHkTasks} onClick={() => nav('/housekeeping/tasks')} />
              <Todo icon={<Wrench size={15} />} label="Açık arıza kaydı" n={d.openTickets} onClick={() => nav('/maintenance')} />
              <Todo icon={<IdCard size={15} />} label="Bekleyen kimlik bildirimi" n={d.kbsPending} onClick={() => nav('/kbs')} />
              <Todo icon={<AlarmClock size={15} />} label="Bekleyen uyandırma" n={d.pendingWakeups} onClick={() => nav('/wakeups')} />
            </ul>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Önümüzdeki günler</h3><div className="right"><button className="btn sm ghost" onClick={() => nav('/availability')}>Fiyat ve doluluk</button></div></div>
          <div className="card-body">
            {d.forecast.length === 0 || noRooms ? <Empty title="Tahmin için oda tanımı gerekli" /> : (
              <>
                <div className="mini-bars" title="Satılan oda oranı">
                  {d.forecast.map(f => <div key={f.date} className={f.date === d.businessDate ? 'today' : ''} style={{ height: `${Math.max(2, Number(f.occupancyPct))}%` }} title={`${fmtDate(f.date)}: %${fmtPct(f.occupancyPct)} (${f.sold} satılan, ${f.available} boş)`} />)}
                </div>
                <div className="row" style={{ justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  <span>{fmtDay(d.forecast[0].date).day}</span><span>{fmtDay(d.forecast[d.forecast.length - 1].date).day}</span>
                </div>
                <table className="dt" style={{ marginTop: 10 }}>
                  <thead><tr><th>Gün</th><th style={{ textAlign: 'right' }}>Satılan</th><th style={{ textAlign: 'right' }}>Boş</th><th style={{ textAlign: 'right' }}>Doluluk</th></tr></thead>
                  <tbody>
                    {d.forecast.slice(0, 7).map(f => (
                      <tr key={f.date}><td>{fmtDay(f.date).weekday} {fmtDay(f.date).day}</td><td className="num">{f.sold}</td><td className="num">{f.available}</td><td className="num">%{fmtPct(f.occupancyPct)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="row wrap" style={{ marginTop: 14 }}>
        {can('reservation.view') && <button className="btn" onClick={() => nav('/rack')}><BedDouble /> Oda Rack</button>}
        {can('night_audit.execute') && <button className="btn" onClick={() => nav('/night-audit')}><Moon /> Gece denetimi</button>}
      </div>
    </div>
  );
}

function Todo({ icon, label, n, onClick }: { icon: React.ReactNode; label: string; n: number; onClick: () => void }) {
  return (
    <li style={{ cursor: 'pointer' }} onClick={onClick}>
      {icon}<span>{label}</span><span className="spacer" />
      <span className={`badge ${n > 0 ? 'orange' : 'gray'}`}>{Math.max(0, n)}</span>
    </li>
  );
}
