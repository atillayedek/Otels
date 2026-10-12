import Link from 'next/link';
import { Download, Search } from 'lucide-react';
import { supabaseServer } from '@/lib/supabase/server';
import { applyFilter, PAGE_SIZE, parseFilter, ROW_COLUMNS, statusCounts, type PreOrderRow } from '@/lib/admin-query';
import { OS_LABELS, SOFTWARE_LABELS, STATUS_LABELS } from '@/lib/site';
import { fmtDateTime } from '@/lib/format';

export default async function AdminListPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = parseFilter(await searchParams);
  const sb = await supabaseServer();
  const from = (f.page - 1) * PAGE_SIZE;

  const [list, counts] = await Promise.all([
    applyFilter(sb.from('pre_orders').select(ROW_COLUMNS, { count: 'exact' }), f)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1),
    statusCounts(sb),
  ]);

  const rows = (list.data ?? []) as PreOrderRow[];
  const total = list.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = { durum: f.status, ara: f.q, sayfa: f.page > 1 ? String(f.page) : undefined, ...patch };
    Object.entries(merged).forEach(([k, v]) => { if (v !== undefined && v !== '') p.set(k, String(v)); });
    const s = p.toString();
    return s ? `?${s}` : '';
  };
  const allCount = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontSize: '1.6rem', margin: 0 }}>Ön sipariş talepleri</h1>
        <a href={`/admin/disari-aktar${qs({ sayfa: undefined })}`} className="btn sm" style={{ marginLeft: 'auto' }}><Download /> Excel için CSV indir</a>
      </div>

      <div className="stats">
        <Link href={`/admin${qs({ durum: undefined, sayfa: undefined })}`} className="stat" style={{ color: 'inherit', borderColor: !f.status ? 'var(--primary)' : undefined }}>
          <b>{allCount}</b><span>Tümü</span>
        </Link>
        {Object.entries(STATUS_LABELS).map(([k, label]) => (
          <Link key={k} href={`/admin${qs({ durum: k, sayfa: undefined })}`} className="stat" style={{ color: 'inherit', borderColor: f.status === k ? 'var(--primary)' : undefined }}>
            <b>{counts[k] ?? 0}</b><span>{label}</span>
          </Link>
        ))}
      </div>

      <form className="toolbar" action="/admin">
        {f.status && <input type="hidden" name="durum" value={f.status} />}
        <div className="field" style={{ flex: 1, minWidth: 240 }}>
          <label htmlFor="ara">Ara</label>
          <input id="ara" name="ara" className="input" defaultValue={f.q ?? ''} placeholder="Talep no, otel, ad soyad, e-posta, telefon, şehir" />
        </div>
        <button className="btn"><Search /> Ara</button>
        {(f.q || f.status) && <Link href="/admin" className="btn ghost">Filtreleri temizle</Link>}
      </form>

      {list.error ? (
        <div className="note err">Talepler yüklenemedi. Sayfayı yenileyin. Hata kodu: A400</div>
      ) : rows.length === 0 ? (
        <div className="table-wrap empty">
          <h3>{f.q || f.status ? 'Bu filtreye uyan talep bulunmuyor.' : 'Henüz ön sipariş talebi bulunmuyor.'}</h3>
          <p>Sitedeki ön sipariş formundan gelen talepler burada listelenir.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Talep no</th><th>Tarih</th><th>Otel</th><th>Şehir</th><th>İlgili kişi</th><th>Oda</th><th>Program</th><th>Sunucu</th><th>Aktarım</th><th>Durum</th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td><Link href={`/admin/${r.id}`} style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{r.reference}</Link></td>
                  <td>{fmtDateTime(r.created_at)}</td>
                  <td><Link href={`/admin/${r.id}`} style={{ color: 'inherit', fontWeight: 600 }}>{r.hotel_name}</Link></td>
                  <td>{r.city}</td>
                  <td>{r.full_name}<br /><span className="muted" style={{ fontSize: 13 }}>{r.phone}</span></td>
                  <td>{r.room_count ?? '—'}</td>
                  <td>{r.current_software === 'diger' ? r.current_software_other : SOFTWARE_LABELS[r.current_software]}</td>
                  <td>{OS_LABELS[r.server_os]}</td>
                  <td>{r.needs_migration ? 'İsteniyor' : '—'}</td>
                  <td><span className={`badge ${r.status}`}>{STATUS_LABELS[r.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="pager">
          <span>{from + 1}–{Math.min(from + PAGE_SIZE, total)} / {total}</span>
          {f.page > 1 && <Link className="btn sm" href={`/admin${qs({ sayfa: f.page - 1 })}`}>Önceki</Link>}
          {f.page < pages && <Link className="btn sm" href={`/admin${qs({ sayfa: f.page + 1 })}`}>Sonraki</Link>}
        </div>
      )}
    </>
  );
}
