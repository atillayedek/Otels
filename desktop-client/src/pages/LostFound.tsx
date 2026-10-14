import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HandHelping, PackageSearch, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api, get, qs } from '../lib/api';
import { fmtDate, fmtDateTime } from '../lib/format';
import { useRooms } from '../lib/queries';
import { useSession } from '../lib/session';
import { PageHead, useAction } from '../components/common';
import { Badge, Empty, ErrorBox, Field, Modal, Spinner } from '../components/ui';

interface LostItem {
  id: string; itemNo: number; foundDate: string; location: string; roomId?: string; roomNumber?: string; guestId?: string; guestName?: string; category: string;
  description: string; storage?: string; foundBy?: string; status: 'stored' | 'returned' | 'disposed'; returnedTo?: string; closedAt?: string; closedBy?: string;
  closeNote?: string; createdAt: string; createdBy?: string; version: number;
}

const CATEGORY: Record<string, string> = { clothing: 'Giyim', electronics: 'Elektronik', jewelry: 'Takı / saat', document: 'Belge / kimlik', money: 'Para / cüzdan', bag: 'Çanta / bavul', other: 'Diğer' };
const STATUS: Record<string, { label: string; color: 'blue' | 'green' | 'gray' }> = {
  stored: { label: 'Muhafazada', color: 'blue' }, returned: { label: 'Teslim edildi', color: 'green' }, disposed: { label: 'İmha / bağış', color: 'gray' },
};

/** Kayıp eşya defteri: bulunan eşyanın kaydı, sahibine teslimi (teslim alan yazılır) veya imha/bağışı. */
export default function LostFoundPage() {
  const [status, setStatus] = useState('stored');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<LostItem | 'new' | null>(null);
  const [close, setClose] = useState<LostItem | null>(null);
  const list = useQuery({ queryKey: ['lostItems', status, q], queryFn: () => get<LostItem[]>(`/api/v1/lost-items${qs({ status, q })}`) });
  return (
    <div className="page">
      <PageHead title="Kayıp Eşya" sub="Bulunan eşyaların kaydı, teslimi ve imhası" actions={<button className="btn primary" onClick={() => setEdit('new')}><Plus /> Eşya kaydet</button>} />
      <div className="toolbar">
        <div className="seg">{[['stored', 'Muhafazada'], ['returned', 'Teslim edilen'], ['disposed', 'İmha / bağış'], ['', 'Tümü']].map(([k, l]) =>
          <button key={k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{l}</button>)}</div>
        <Search size={15} className="muted" /><input className="input" style={{ width: 280 }} placeholder="Eşya, yer, oda, misafir veya no" value={q} onChange={e => setQ(e.target.value)} />
        <span className="count">{list.data?.length ?? 0} kayıt</span>
      </div>
      <div className="card" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
        {list.isLoading ? <Spinner /> : list.error ? <ErrorBox error={list.error} /> : !list.data?.length
          ? <Empty icon={<PackageSearch />} title="Kayıt yok" text="Bulunan eşyaları buraya kaydedin; teslimde teslim alan kişi yazılır." />
          : (
            <div className="table-wrap">
              <table className="dt">
                <thead><tr><th>No</th><th>Bulunma</th><th>Yer / oda</th><th>Tür</th><th>Eşya</th><th>Muhafaza yeri</th><th>Misafir</th><th>Durum</th><th /></tr></thead>
                <tbody>{list.data.map(i => (
                  <tr key={i.id}>
                    <td className="mono">K{i.itemNo}</td>
                    <td>{fmtDate(i.foundDate)}{i.foundBy && <div className="muted" style={{ fontSize: 11 }}>{i.foundBy}</div>}</td>
                    <td>{i.location}{i.roomNumber && <div className="muted" style={{ fontSize: 11 }}>Oda {i.roomNumber}</div>}</td>
                    <td>{CATEGORY[i.category] ?? i.category}</td>
                    <td style={{ maxWidth: 320 }}>{i.description}</td>
                    <td>{i.storage}</td>
                    <td>{i.guestName}</td>
                    <td><Badge color={STATUS[i.status].color}>{STATUS[i.status].label}</Badge>
                      {i.status !== 'stored' && <div className="muted" style={{ fontSize: 11 }}>{i.returnedTo ?? i.closeNote} · {fmtDateTime(i.closedAt)}</div>}</td>
                    <td className="r" style={{ whiteSpace: 'nowrap' }}>{i.status === 'stored' && <>
                      <button className="btn sm ghost icon" title="Düzenle" onClick={() => setEdit(i)}><Pencil size={14} /></button>
                      <button className="btn sm" onClick={() => setClose(i)}><HandHelping size={14} /> Teslim / imha</button>
                    </>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
      </div>
      {edit && <EditModal item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {close && <CloseModal item={close} onClose={() => setClose(null)} />}
    </div>
  );
}

function EditModal({ item, onClose }: { item: LostItem | null; onClose: () => void }) {
  const qc = useQueryClient();
  const rooms = useRooms();
  const { property } = useSession();
  const [f, setF] = useState({
    foundDate: item?.foundDate ?? property?.businessDate ?? '', location: item?.location ?? '', roomId: item?.roomId ?? '', category: item?.category ?? 'other',
    description: item?.description ?? '', storage: item?.storage ?? '', foundBy: item?.foundBy ?? '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(s => ({ ...s, [k]: e.target.value }));
  const save = useAction(async (key: string) => {
    const body = { ...f, roomId: f.roomId || null, storage: f.storage || null, foundBy: f.foundBy || null, guestId: item?.guestId ?? null, version: item?.version ?? null };
    if (item) await api('PUT', `/api/v1/lost-items/${item.id}`, body, { key }); else await api('POST', '/api/v1/lost-items', body, { key });
    await qc.invalidateQueries({ queryKey: ['lostItems'] });
  }, { success: 'Kayıp eşya kaydedildi.' });
  return (
    <Modal title={item ? `Kayıt K${item.itemNo}` : 'Bulunan eşyayı kaydet'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!f.location.trim() || !f.description.trim() || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button>
    </>}>
      <div className="form-grid">
        <Field label="Bulunma tarihi" required><input type="date" className="input" value={f.foundDate} onChange={set('foundDate')} /></Field>
        <Field label="Oda"><select className="input" value={f.roomId} onChange={e => { const r = rooms.data?.find(x => x.id === e.target.value); setF(s => ({ ...s, roomId: e.target.value, location: r && !s.location ? `Oda ${r.number}` : s.location })); }}>
          <option value="">—</option>{rooms.data?.map(r => <option key={r.id} value={r.id}>{r.number}</option>)}</select></Field>
        <Field label="Bulunduğu yer" required className="span-2"><input className="input" value={f.location} onChange={set('location')} placeholder="Oda 204, lobi, restoran…" /></Field>
        <Field label="Tür"><select className="input" value={f.category} onChange={set('category')}>{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Bulan personel"><input className="input" value={f.foundBy} onChange={set('foundBy')} /></Field>
        <Field label="Eşya tanımı" required className="span-4" hint="Marka, renk, ayırt edici özellik; değerli eşyada içerik (ör. cüzdandaki para miktarı) yazılır."><textarea className="input" rows={3} value={f.description} onChange={set('description')} autoFocus /></Field>
        <Field label="Muhafaza yeri" className="span-4"><input className="input" value={f.storage} onChange={set('storage')} placeholder="Kat ofisi dolabı, resepsiyon kasası…" /></Field>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function CloseModal({ item, onClose }: { item: LostItem; onClose: () => void }) {
  const qc = useQueryClient();
  const [action, setAction] = useState<'returned' | 'disposed'>('returned');
  const [returnedTo, setReturnedTo] = useState(item.guestName ?? '');
  const [note, setNote] = useState('');
  const act = useAction(async (key: string) => {
    await api('POST', `/api/v1/lost-items/${item.id}/close`, { action, returnedTo: action === 'returned' ? returnedTo : null, note: note || null, version: item.version }, { key });
    await qc.invalidateQueries({ queryKey: ['lostItems'] });
  }, { success: action === 'returned' ? 'Eşya teslim edildi olarak kaydedildi.' : 'Eşya imha / bağış olarak kaydedildi.' });
  const ok = action === 'returned' ? returnedTo.trim().length > 0 : note.trim().length > 0;
  return (
    <Modal title={`K${item.itemNo} · ${item.description.slice(0, 40)}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className={`btn ${action === 'returned' ? 'primary' : 'danger'}`} disabled={!ok || act.busy} onClick={async () => { if (await act.run() !== undefined) onClose(); }}>
        {action === 'returned' ? <><HandHelping /> Teslim edildi</> : <><Trash2 /> İmha / bağış</>}</button>
    </>}>
      <div className="stack">
        <div className="seg"><button className={action === 'returned' ? 'active' : ''} onClick={() => setAction('returned')}>Sahibine teslim</button>
          <button className={action === 'disposed' ? 'active' : ''} onClick={() => setAction('disposed')}>İmha / bağış</button></div>
        {action === 'returned'
          ? <Field label="Teslim alan" required hint="Ad soyad ve kimlik/iletişim bilgisi; kargo ile gönderildiyse kargo firması ve takip no."><input className="input" value={returnedTo} onChange={e => setReturnedTo(e.target.value)} autoFocus /></Field>
          : <div className="warn-box">Saklama süresi dolan eşyalar için işletme politikanıza göre imha veya bağış yapın; açıklamaya tutanak bilgisini yazın.</div>}
        <Field label={action === 'returned' ? 'Not' : 'Açıklama'} required={action === 'disposed'}><textarea className="input" rows={2} value={note} onChange={e => setNote(e.target.value)} /></Field>
        <ErrorBox error={act.error} />
      </div>
    </Modal>
  );
}
