import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Crown, Search, UserPlus } from 'lucide-react';
import { get, qs } from '../lib/api';
import type { GuestListItem, Paged } from '../lib/types';
import { fmtDate } from '../lib/format';

/**
 * Misafir arama: ad ve soyad ayrı kutulardan (başından eşleşir), ayrıca kimlik no / telefon.
 * Yeni misafir oluşturma aramadan ayrı bir düğmedir; arama sonucu boşsa da önerilir.
 */
export function GuestSearch({ onPick, onNew, autoFocus = true, maxHeight = 240, actionLabel }: {
  onPick: (g: GuestListItem) => void; onNew?: (seed: { firstName: string; lastName: string }) => void; autoFocus?: boolean; maxHeight?: number; actionLabel?: string;
}) {
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [other, setOther] = useState('');
  const [terms, setTerms] = useState({ first: '', last: '', other: '' });
  useEffect(() => {
    const t = setTimeout(() => setTerms({ first: first.trim(), last: last.trim(), other: other.trim() }), 250);
    return () => clearTimeout(t);
  }, [first, last, other]);
  const enough = terms.first.length >= 2 || terms.last.length >= 2 || terms.other.length >= 3;
  const res = useQuery({
    queryKey: ['guests', 'search', terms],
    queryFn: () => get<Paged<GuestListItem>>(`/api/v1/guests${qs({ firstName: terms.first || null, lastName: terms.last || null, q: terms.other || null, pageSize: 10 })}`),
    enabled: enough,
  });
  const seed = { firstName: first.trim(), lastName: last.trim() };
  return (
    <div className="stack guest-search">
      <div className="gs-row">
        <Search size={15} className="muted" />
        <label className="gs-field"><span>Ad</span><input className="input" value={first} onChange={e => setFirst(e.target.value)} autoFocus={autoFocus} maxLength={80} /></label>
        <label className="gs-field"><span>Soyad</span><input className="input" value={last} onChange={e => setLast(e.target.value)} maxLength={80} /></label>
        <label className="gs-field"><span>Kimlik no / telefon</span><input className="input" value={other} onChange={e => setOther(e.target.value)} maxLength={40} /></label>
        {onNew && <button type="button" className="btn gs-new" onClick={() => onNew(seed)}><UserPlus /> Yeni misafir</button>}
      </div>
      {!enough ? <div className="muted" style={{ fontSize: 12 }}>Ad veya soyaddan en az 2 harf yazın; kimlik no / telefonla da arayabilirsiniz.</div> : (
        <div className="table-wrap" style={{ maxHeight }}>
          <table className="dt">
            <thead><tr><th>Ad</th><th>Soyad</th><th>Uyruk</th><th>Kimlik</th><th>Telefon</th><th>Konaklama</th>{actionLabel && <th />}</tr></thead>
            <tbody>
              {res.data?.items.map(g => (
                <tr key={g.id} className="clickable" onClick={() => onPick(g)}>
                  <td>{g.isVip && <Crown size={12} color="var(--warning)" />} {g.firstName}{g.isBlacklisted && <span className="badge red" style={{ marginLeft: 6 }}>Kara liste</span>}</td>
                  <td>{g.lastName}</td><td>{g.nationality}</td><td className="mono">{g.identityNumber}</td><td>{g.phone}</td>
                  <td>{g.stayCount}{g.lastStay ? ` · son ${fmtDate(g.lastStay)}` : ''}</td>
                  {actionLabel && <td style={{ textAlign: 'right' }}><button type="button" className="btn sm primary">{actionLabel}</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {res.isFetching && !res.data && <div className="empty">Aranıyor…</div>}
          {res.data && res.data.items.length === 0 && (
            <div className="empty">Eşleşen misafir yok.{onNew && <button type="button" className="btn sm" onClick={() => onNew(seed)}><UserPlus /> Bu isimle yeni misafir oluştur</button>}</div>
          )}
        </div>
      )}
    </div>
  );
}
