import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, Brush, Eraser, Lock, Pencil, Plus, Search, StickyNote, Tag, Trash2, X } from 'lucide-react';
import { api, del, post, put } from '../lib/api';
import { addDays, BLOCK_LABEL, fmtDate, fmtDateTime, HK_BADGE, HK_LABEL } from '../lib/format';
import { useRoomGroups, useRoomStatus } from '../lib/queries';
import { useSession } from '../lib/session';
import type { RoomGroup, RoomStatus } from '../lib/types';
import { PageHead, useAction } from '../components/common';
import { Badge, DataTable, Empty, ErrorBox, Field, Modal, useConfirm, useContextMenu, useToast, type Column } from '../components/ui';
import { HkStatusModal } from '../components/RoomActions';

/** Oda grubu renk önerileri (gruplar farklı renkte görünsün). */
const GROUP_COLORS = ['#2563eb', '#16a34a', '#db2777', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#be123c', '#4d7c0f', '#0f766e'];

export default function HousekeepingPage() {
  const { can } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const menu = useContextMenu();
  const status = useRoomStatus();
  const groups = useRoomGroups();
  const [hk, setHk] = useState('');
  const [fo, setFo] = useState('');
  const [floor, setFloor] = useState('');
  const [groupId, setGroupId] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<string | null>(null);
  const [note, setNote] = useState(false);
  const [block, setBlock] = useState<string | null>(null);
  const [groupMgr, setGroupMgr] = useState(false);
  const [busy, setBusy] = useState(false);
  const rooms = useMemo(() => status.data ?? [], [status.data]);
  const floors = useMemo(() => [...new Set(rooms.map(r => r.floor).filter(Boolean))] as string[], [rooms]);
  const needle = q.trim().toLocaleLowerCase('tr-TR');
  const view = rooms.filter(r => (!hk || r.hkStatus === hk) && (!floor || r.floor === floor)
    && (!groupId || (groupId === '-' ? !r.groupId : r.groupId === groupId))
    && (!fo || (fo === 'vacant' ? r.foStatus === 'vacant' && !r.blockKind : fo === 'occupied' ? r.foStatus === 'occupied' : fo === 'departure' ? r.departureToday : fo === 'arrival' ? !!r.arrivalReservationId : fo === 'blocked' ? !!r.blockKind : true))
    && (!needle || [r.number, r.inHouseGuests, r.inHouseGuest, r.arrivalGuest].some(x => (x ?? '').toLocaleLowerCase('tr-TR').includes(needle))));
  const selected = rooms.filter(r => sel.has(r.id));
  const allShown = view.length > 0 && view.every(r => sel.has(r.id));

  const refresh = () => qc.invalidateQueries({ predicate: x => ['roomStatus', 'rooms', 'rack', 'hk', 'dashboard'].includes(String(x.queryKey[0])) });
  /** Seçili odalara tek işlemde uygulanır (sunucuda tek kayıt, hepsi ya da hiçbiri). */
  const bulk = async (body: Record<string, unknown>, done: string) => {
    if (sel.size === 0) return;
    setBusy(true);
    try {
      const r = await api<{ updated: number }>('POST', '/api/v1/rooms/bulk-housekeeping', { roomIds: [...sel], setNote: false, setGroup: false, ...body });
      await refresh();
      toast.ok(`${r.updated} oda: ${done}`);
      setSel(new Set());
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const pick = (pred: (r: RoomStatus) => boolean) => setSel(new Set(view.filter(pred).map(r => r.id)));
  const toggle = (id: string, on: boolean) => setSel(s => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  const groupMenu = (e: React.MouseEvent) => menu.open(e, [
    ...(groups.data ?? []).map(g => ({ label: g.name, icon: <i className="grp-dot" style={{ background: g.color }} />, onClick: () => void bulk({ setGroup: true, groupId: g.id }, `"${g.name}" grubuna alındı.`) })),
    ...((groups.data?.length ?? 0) > 0 ? [{ separator: true, label: '' }] : []),
    { label: 'Gruptan çıkar', icon: <X size={14} />, onClick: () => void bulk({ setGroup: true, groupId: null }, 'gruptan çıkarıldı.') },
    { label: 'Grupları düzenle…', icon: <Pencil size={14} />, onClick: () => setGroupMgr(true) },
  ]);

  const cols: Column<RoomStatus>[] = [
    {
      key: 'sel', header: <input type="checkbox" checked={allShown} title="Gösterilenlerin hepsini seç" onClick={e => e.stopPropagation()} onChange={e => setSel(e.target.checked ? new Set([...sel, ...view.map(r => r.id)]) : new Set([...sel].filter(id => !view.some(r => r.id === id))))} />,
      width: 34, render: r => <input type="checkbox" checked={sel.has(r.id)} onClick={e => e.stopPropagation()} onChange={e => toggle(r.id, e.target.checked)} />,
    },
    { key: 'number', header: 'Oda', width: 70 },
    { key: 'floor', header: 'Kat', width: 55 },
    { key: 'roomTypeCode', header: 'Tip', width: 65 },
    { key: 'group', header: 'Grup', width: 120, value: r => r.groupName ?? '', render: r => r.groupName ? <span className="grp-chip" style={{ '--grp': r.groupColor } as React.CSSProperties}>{r.groupName}</span> : null },
    { key: 'hkStatus', header: 'Temizlik', width: 125, value: r => HK_LABEL[r.hkStatus], render: r => <Badge color={HK_BADGE[r.hkStatus]}>{HK_LABEL[r.hkStatus]}</Badge> },
    { key: 'foStatus', header: 'Ön büro', width: 150, value: r => r.foStatus, render: r => <>{r.foStatus === 'occupied' ? 'Dolu' : 'Boş'}{r.departureToday ? ' · çıkış' : ''}{r.arrivalReservationId ? ' · geliş' : ''}{r.blockKind ? ` · ${BLOCK_LABEL[r.blockKind]}` : ''}</> },
    { key: 'isDnd', header: 'DND', width: 45, render: r => r.isDnd ? <BellOff size={14} color="var(--warning)" /> : null },
    { key: 'guest', header: 'Misafir', value: r => r.inHouseGuests ?? r.inHouseGuest ?? r.arrivalGuest ?? '' },
    { key: 'hkNote', header: 'Not' },
    { key: 'hkUpdatedAt', header: 'Güncelleme', width: 135, render: r => fmtDateTime(r.hkUpdatedAt) },
    { key: 'dep', header: 'Çıkış', width: 90, render: r => fmtDate(r.inHouseDeparture) },
  ];
  const canHk = can('housekeeping.update');

  return (
    <div className="page">
      <PageHead title="Oda Durumları" sub="Kat hizmetleri · odaları seçip toplu işlem yapın" actions={can('room.manage') ? <button className="btn" onClick={() => setGroupMgr(true)}><Tag /> Oda grupları</button> : undefined} />
      <div className="toolbar">
        <Search size={15} className="muted" /><input className="input" style={{ width: 170 }} placeholder="Oda no veya misafir" value={q} onChange={e => setQ(e.target.value)} data-enter="keep" />
        <select className="input" style={{ width: 140 }} value={hk} onChange={e => setHk(e.target.value)}><option value="">Tüm temizlik durumları</option>{Object.entries(HK_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="input" style={{ width: 130 }} value={fo} onChange={e => setFo(e.target.value)}><option value="">Ön büro: tümü</option><option value="vacant">Boş</option><option value="occupied">Dolu</option><option value="departure">Bugün çıkış</option><option value="arrival">Bugün geliş</option><option value="blocked">Bloke</option></select>
        {floors.length > 0 && <select className="input" style={{ width: 105 }} value={floor} onChange={e => setFloor(e.target.value)}><option value="">Tüm katlar</option>{floors.map(f => <option key={f} value={f}>{f}. kat</option>)}</select>}
        {(groups.data?.length ?? 0) > 0 && <select className="input" style={{ width: 140 }} value={groupId} onChange={e => setGroupId(e.target.value)}><option value="">Tüm gruplar</option>{groups.data!.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}<option value="-">Grubu olmayanlar</option></select>}
        <span className="count">{view.length} oda</span>
      </div>
      {canHk && (
        <div className="bulk-bar">
          <span className="muted">Hızlı seçim:</span>
          <button className="btn sm ghost" onClick={() => pick(() => true)}>Gösterilenler</button>
          <button className="btn sm ghost" onClick={() => pick(r => r.hkStatus === 'dirty')}>Kirliler</button>
          <button className="btn sm ghost" onClick={() => pick(r => r.foStatus === 'vacant' && !r.blockKind)}>Boşlar</button>
          <button className="btn sm ghost" onClick={() => pick(r => r.foStatus === 'occupied')}>Dolular</button>
          <button className="btn sm ghost" onClick={() => pick(r => r.departureToday)}>Çıkışlar</button>
          <button className="btn sm ghost" onClick={() => pick(r => !!r.arrivalReservationId)}>Gelişler</button>
          {sel.size > 0 && <button className="btn sm ghost" onClick={() => setSel(new Set())}><X /> Seçimi temizle</button>}
        </div>
      )}
      {canHk && sel.size > 0 && (
        <div className="bulk-bar active">
          <b>{sel.size} oda seçili</b>
          {Object.entries(HK_LABEL).filter(([k]) => k !== 'inspected' || can('housekeeping.inspect')).map(([k, l]) => (
            <button key={k} className={`btn sm hkbtn hk-${k}`} disabled={busy} onClick={() => void bulk({ hkStatus: k }, `durum "${l}" yapıldı.`)}><Brush /> {l}</button>
          ))}
          <span className="sep" />
          <button className="btn sm" disabled={busy} onClick={() => void bulk({ isDnd: true }, 'DND işaretlendi.')}><BellOff /> DND</button>
          <button className="btn sm" disabled={busy} onClick={() => void bulk({ isDnd: false }, 'DND kaldırıldı.')}><Bell /> DND kaldır</button>
          <button className="btn sm" disabled={busy} onClick={() => setNote(true)}><StickyNote /> Not yaz</button>
          <button className="btn sm" disabled={busy} onClick={() => void bulk({ setNote: true, hkNote: null }, 'not silindi.')}><Eraser /> Notu sil</button>
          {can('room.manage') && <button className="btn sm" disabled={busy} onClick={groupMenu}><Tag /> Gruba al ▾</button>}
          {can('maintenance.manage') && <>
            <span className="sep" />
            <button className="btn sm" disabled={busy} onClick={() => setBlock('out_of_order')}><Lock /> Arızalı</button>
            <button className="btn sm" disabled={busy} onClick={() => setBlock('blocked')}><Lock /> Kapalı</button>
            <button className="btn sm" disabled={busy} onClick={() => setBlock('out_of_service')}><Lock /> Servis dışı</button>
          </>}
        </div>
      )}
      {status.error ? <ErrorBox error={status.error} /> : (
        <DataTable rows={view} columns={cols} rowKey={r => r.id} onRowClick={r => canHk && setEdit(r.id)} maxHeight="calc(100vh - 300px)"
          rowClass={r => (sel.has(r.id) ? 'selected' : '')}
          onRowContext={canHk ? (e, r) => { if (!sel.has(r.id)) setSel(new Set([r.id])); menu.open(e, [
            ...Object.entries(HK_LABEL).filter(([k]) => k !== 'inspected' || can('housekeeping.inspect')).map(([k, l]) => ({ label: l, checked: r.hkStatus === k, onClick: () => void bulk({ hkStatus: k }, `durum "${l}" yapıldı.`) })),
            { separator: true, label: '' },
            { label: 'Durum ve not…', icon: <Pencil size={14} />, onClick: () => setEdit(r.id) },
          ]); } : undefined}
          empty={<Empty title={status.isLoading ? 'Yükleniyor…' : 'Oda bulunmuyor'} />} />
      )}
      {menu.node}
      {edit && <HkStatusModal roomId={edit} onClose={() => setEdit(null)} />}
      {note && <BulkNoteModal count={sel.size} onClose={() => setNote(false)} onSave={async text => { await bulk({ setNote: true, hkNote: text }, 'not yazıldı.'); setNote(false); }} />}
      {block && <BulkBlockModal kind={block} rooms={selected} onClose={() => setBlock(null)} onDone={() => { setBlock(null); setSel(new Set()); void refresh(); }} />}
      {groupMgr && <RoomGroupsModal onClose={() => setGroupMgr(false)} />}
    </div>
  );
}

function BulkNoteModal({ count, onClose, onSave }: { count: number; onClose: () => void; onSave: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  return (
    <Modal title={`${count} odaya kat notu`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!text.trim()} onClick={() => void onSave(text.trim())}>Kaydet</button>
    </>}>
      <Field label="Not" hint="Seçili odaların mevcut notunun yerine yazılır."><input className="input" value={text} onChange={e => setText(e.target.value)} maxLength={300} autoFocus /></Field>
    </Modal>
  );
}

/** Seçili odaları satışa kapatır (her oda için ayrı blokaj kaydı). Konaklayan/rezervasyonlu oda atlanır ve bildirilir. */
function BulkBlockModal({ kind, rooms, onClose, onDone }: { kind: string; rooms: RoomStatus[]; onClose: () => void; onDone: () => void }) {
  const { property } = useSession();
  const toast = useToast();
  const bd = property?.businessDate ?? '';
  const [f, setF] = useState({ kind, dateFrom: bd, dateTo: addDays(bd, 1), reason: '' });
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (const r of rooms) {
      try { await post('/api/v1/room-blocks', { roomId: r.id, kind: f.kind, dateFrom: f.dateFrom, dateTo: f.dateTo, reason: f.reason.trim(), ticketId: null }, crypto.randomUUID()); ok++; }
      catch (e) { failed.push(`${r.number}: ${e instanceof Error ? e.message : 'hata'}`); }
    }
    setBusy(false);
    if (ok) toast.ok(`${ok} oda ${BLOCK_LABEL[f.kind]} olarak satışa kapatıldı.`);
    if (failed.length) toast.error(`Kapatılamayan odalar — ${failed.join(' · ')}`);
    onDone();
  };
  return (
    <Modal title={`${rooms.length} odayı satışa kapat`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={busy || !f.reason.trim() || f.dateTo <= f.dateFrom} onClick={() => void run()}>{busy ? 'Kaydediliyor…' : 'Satışa kapat'}</button>
    </>}>
      <div className="form-grid">
        <div className="span-4 muted">Odalar: {rooms.map(r => r.number).join(', ')}</div>
        <Field label="Tür" className="span-2"><select className="input" value={f.kind} onChange={e => setF(s => ({ ...s, kind: e.target.value }))}>{Object.entries(BLOCK_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Başlangıç" required><input type="date" className="input" value={f.dateFrom} onChange={e => setF(s => ({ ...s, dateFrom: e.target.value }))} /></Field>
        <Field label="Bitiş (dahil değil)" required><input type="date" className="input" value={f.dateTo} onChange={e => setF(s => ({ ...s, dateTo: e.target.value }))} /></Field>
        <Field label="Gerekçe" required className="span-4"><input className="input" value={f.reason} onChange={e => setF(s => ({ ...s, reason: e.target.value }))} maxLength={300} autoFocus placeholder="ör. Klima arızası, boya badana" /></Field>
      </div>
    </Modal>
  );
}

/** Oda grupları: ad ve renk. Gruplar kat hizmetleri bölümü/ekibi gibi kullanılır; rack'te kartın sol çizgisi grup rengidir. */
export function RoomGroupsModal({ onClose }: { onClose: () => void }) {
  const groups = useRoomGroups();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const [edit, setEdit] = useState<Partial<RoomGroup> | null>(null);
  const refresh = () => qc.invalidateQueries({ predicate: x => ['rooms', 'roomStatus', 'rack'].includes(String(x.queryKey[0])) });
  const save = useAction(async (key: string) => {
    const body = { name: edit!.name ?? '', color: edit!.color ?? GROUP_COLORS[0], sortOrder: edit!.sortOrder ?? 0, version: edit!.version ?? null };
    if (edit!.id) await put(`/api/v1/room-groups/${edit!.id}`, body, key); else await post('/api/v1/room-groups', body, key);
    await refresh();
  }, { success: 'Oda grubu kaydedildi.' });
  const remove = async (g: RoomGroup) => {
    if (!await confirm({ title: 'Grubu sil', message: `"${g.name}" grubu silinecek. ${g.roomCount} oda gruptan çıkar; odalar silinmez.`, confirmText: 'Sil', danger: true })) return;
    try { await del(`/api/v1/room-groups/${g.id}`); await refresh(); toast.ok('Grup silindi.'); } catch (e) { toast.error(e); }
  };
  const next = () => {
    const used = new Set(groups.data?.map(g => g.color));
    const n = (groups.data?.length ?? 0) + 1;
    setEdit({ name: `Grup ${n}`, color: GROUP_COLORS.find(c => !used.has(c)) ?? GROUP_COLORS[n % GROUP_COLORS.length], sortOrder: n });
  };
  return (
    <Modal title="Oda grupları" onClose={onClose} footer={<button className="btn" onClick={onClose}>Kapat</button>}>
      <div className="stack">
        <div className="muted" style={{ fontSize: 12.5 }}>Odaları gruplara ayırın (ör. Grup 1 · 1.-2. katlar, Grup 2 · ek bina). Her grubun rengi farklıdır; oda durumları ekranında ve rack'te görünür, gruba göre süzülür.</div>
        <table className="dt">
          <thead><tr><th>Renk</th><th>Grup</th><th style={{ textAlign: 'right' }}>Oda</th><th /></tr></thead>
          <tbody>
            {groups.data?.map(g => (
              <tr key={g.id}>
                <td><i className="grp-dot lg" style={{ background: g.color }} /></td><td>{g.name}</td><td className="num">{g.roomCount}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn sm ghost icon" title="Düzenle" onClick={() => setEdit(g)}><Pencil /></button>
                  <button className="btn sm ghost icon" title="Sil" onClick={() => void remove(g)}><Trash2 /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {groups.data?.length === 0 && <Empty title="Henüz oda grubu yok" />}
        {edit ? (
          <div className="card"><div className="card-body form-grid">
            <Field label="Grup adı" required className="span-2"><input className="input" value={edit.name ?? ''} onChange={e => setEdit(s => ({ ...s, name: e.target.value }))} maxLength={40} autoFocus /></Field>
            <Field label="Renk">
              <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                {GROUP_COLORS.map(c => <button key={c} type="button" className={`grp-pick ${edit.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setEdit(s => ({ ...s, color: c }))} aria-label={c} />)}
                <input type="color" value={edit.color ?? GROUP_COLORS[0]} onChange={e => setEdit(s => ({ ...s, color: e.target.value }))} title="Başka renk" />
              </div>
            </Field>
            <Field label="Sıra"><input className="input num" type="number" value={edit.sortOrder ?? 0} onChange={e => setEdit(s => ({ ...s, sortOrder: Number(e.target.value) }))} /></Field>
            <div className="span-4 row">
              <span className="spacer" />
              <button className="btn" onClick={() => setEdit(null)}>Vazgeç</button>
              <button className="btn primary" disabled={!edit.name?.trim() || save.busy} onClick={async () => { if (await save.run() !== undefined) setEdit(null); }}>Kaydet</button>
            </div>
            <ErrorBox error={save.error} />
          </div></div>
        ) : <div><button className="btn" onClick={next}><Plus /> Yeni grup</button></div>}
      </div>
    </Modal>
  );
}
