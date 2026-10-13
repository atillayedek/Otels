import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { post } from '../lib/api';
import type { Reservation } from '../lib/types';
import { fmtDate, fmtMoney, HK_LABEL, nightsBetween } from '../lib/format';
import { useRoomStatus } from '../lib/queries';
import { useSession } from '../lib/session';
import { useAction } from './common';
import { ErrorBox, Field, Modal, MoneyInput } from './ui';

function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ predicate: q => ['reservation', 'reservations', 'rack', 'roomStatus', 'dashboard', 'folios', 'folio'].includes(String(q.queryKey[0])) });
}

export function CheckInModal({ reservation: r, onClose }: { reservation: Reservation; onClose: () => void }) {
  const status = useRoomStatus();
  const refresh = useRefresh();
  const { property } = useSession();
  const [roomId, setRoomId] = useState(r.roomId ?? '');
  const candidates = (status.data ?? []).filter(s => s.roomTypeId === r.roomTypeId && (s.id === r.roomId || (s.foStatus === 'vacant' && !s.blockKind)));
  const chosen = status.data?.find(s => s.id === roomId);
  const early = !!property && r.arrival > property.businessDate;
  const act = useAction(async (key: string) => {
    await post(`/api/v1/reservations/${r.id}/check-in`, { roomId, earlyCheckIn: early, version: r.version }, key);
    await refresh();
  }, { success: `${r.guestName} için giriş yapıldı.` });
  return (
    <Modal title={`Giriş (check-in) · ${r.reservationNumber}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!roomId || act.busy} onClick={async () => { if (await act.run() !== undefined) onClose(); }}>Girişi tamamla</button>
    </>}>
      <div className="stack">
        <div><b>{r.guestName}</b> · {fmtDate(r.arrival)} → {fmtDate(r.departure)} ({r.nights} gece) · {r.roomTypeCode} · {r.adults}+{r.children} kişi</div>
        <Field label="Oda" required>
          <select className="input" value={roomId} onChange={e => setRoomId(e.target.value)} autoFocus>
            <option value="">Oda seçin</option>
            {candidates.map(c => <option key={c.id} value={c.id}>{c.number} · {HK_LABEL[c.hkStatus]}{c.isDnd ? ' · DND' : ''}</option>)}
          </select>
        </Field>
        {candidates.length === 0 && <div className="warn-box">Bu oda tipinde boş ve satışa açık oda yok.</div>}
        {chosen && chosen.hkStatus !== 'clean' && chosen.hkStatus !== 'inspected' && <div className="warn-box">Seçilen oda {HK_LABEL[chosen.hkStatus].toLocaleLowerCase('tr-TR')} durumda. Temiz olmayan odaya giriş sunucu tarafından engellenebilir.</div>}
        {early && <div className="info-box">Geliş tarihi iş gününden sonra; erken giriş olarak işlenecek.</div>}
        <div className="muted" style={{ fontSize: 12 }}>Kimlik bilgisi eksik misafirler için giriş engellenir. Kimlik Bildirim Sistemi (KBS) yapılandırılmışsa bildirim kuyruğa alınır.</div>
        <ErrorBox error={act.error} />
      </div>
    </Modal>
  );
}

export function MoveModal({ reservation: r, initialRoomId, onClose }: { reservation: Reservation; initialRoomId?: string; onClose: () => void }) {
  const status = useRoomStatus();
  const refresh = useRefresh();
  const [roomId, setRoomId] = useState(initialRoomId ?? '');
  const [reason, setReason] = useState('');
  const [keepRate, setKeepRate] = useState(true);
  const [rate, setRate] = useState('');
  const target = status.data?.find(s => s.id === roomId);
  const sameType = !target || target.roomTypeId === r.roomTypeId;
  const [kind, setKind] = useState<'upgrade' | 'downgrade'>('upgrade');
  const free = (status.data ?? []).filter(s => s.id !== r.roomId && s.foStatus === 'vacant' && !s.blockKind);
  const act = useAction(async (key: string) => {
    await post(`/api/v1/reservations/${r.id}/move`, { roomId, kind: sameType ? 'move' : kind, keepRate, newNightlyRate: keepRate ? null : rate, reason, version: r.version }, key);
    await refresh();
  }, { success: 'Oda değiştirildi.' });
  return (
    <Modal title={`Oda değiştir · ${r.guestName}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!roomId || !reason.trim() || (!keepRate && !rate) || act.busy} onClick={async () => { if (await act.run() !== undefined) onClose(); }}>Odayı değiştir</button>
    </>}>
      <div className="form-grid">
        <Field label="Mevcut oda" className="span-2"><input className="input" disabled value={`${r.roomNumber ?? '—'} · ${r.roomTypeCode}`} /></Field>
        <Field label="Yeni oda" required className="span-2">
          <select className="input" value={roomId} onChange={e => setRoomId(e.target.value)}>
            <option value="">Seçin</option>
            {free.map(s => <option key={s.id} value={s.id}>{s.number} · {s.roomTypeCode} · {HK_LABEL[s.hkStatus]}</option>)}
          </select>
        </Field>
        {!sameType && (
          <Field label="Değişim türü" className="span-2">
            <select className="input" value={kind} onChange={e => setKind(e.target.value as 'upgrade' | 'downgrade')}><option value="upgrade">Üst kategoriye (upgrade)</option><option value="downgrade">Alt kategoriye (downgrade)</option></select>
          </Field>
        )}
        <div className="span-4"><label className="check"><input type="checkbox" checked={keepRate} onChange={e => setKeepRate(e.target.checked)} /> Mevcut gecelik fiyat korunsun ({fmtMoney(r.nightlyRate, r.currency)})</label></div>
        {!keepRate && <Field label="Yeni gecelik fiyat" required className="span-2"><MoneyInput value={rate} onChange={setRate} /></Field>}
        <Field label="Gerekçe" required className="span-4"><input className="input" value={reason} onChange={e => setReason(e.target.value)} maxLength={300} placeholder="Misafir isteği, arıza…" /></Field>
      </div>
      <ErrorBox error={act.error} />
    </Modal>
  );
}

export function CancelModal({ reservation: r, onClose }: { reservation: Reservation; onClose: () => void }) {
  const refresh = useRefresh();
  const [reason, setReason] = useState('');
  const act = useAction(async (key: string) => { await post(`/api/v1/reservations/${r.id}/cancel`, { reason, version: r.version }, key); await refresh(); }, { success: 'Rezervasyon iptal edildi.' });
  return (
    <Modal title={`Rezervasyon iptali · ${r.reservationNumber}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn danger" disabled={!reason.trim() || act.busy} onClick={async () => { if (await act.run() !== undefined) onClose(); }}>İptal et</button>
    </>}>
      <div className="stack">
        <div>{r.guestName} · {fmtDate(r.arrival)} → {fmtDate(r.departure)}</div>
        <Field label="İptal gerekçesi" required><textarea className="input" rows={3} value={reason} onChange={e => setReason(e.target.value)} autoFocus maxLength={300} /></Field>
        <div className="muted" style={{ fontSize: 12 }}>İptal kaydı silinmez; gerekçe ve işlemi yapan kullanıcı denetim kaydına yazılır.</div>
        <ErrorBox error={act.error} />
      </div>
    </Modal>
  );
}

export function ExtendModal({ reservation: r, onClose }: { reservation: Reservation; onClose: () => void }) {
  const refresh = useRefresh();
  const [dep, setDep] = useState(r.departure);
  const act = useAction(async (key: string) => { await post(`/api/v1/reservations/${r.id}/departure`, { departure: dep, version: r.version }, key); await refresh(); }, { success: 'Çıkış tarihi güncellendi.' });
  const n = nightsBetween(r.arrival, dep);
  return (
    <Modal title="Konaklamayı uzat / kısalt" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={dep === r.departure || n < 1 || act.busy} onClick={async () => { if (await act.run() !== undefined) onClose(); }}>Kaydet</button>
    </>}>
      <div className="form-grid">
        <Field label="Giriş" className="span-2"><input className="input" disabled value={fmtDate(r.arrival)} /></Field>
        <Field label="Yeni çıkış tarihi" required className="span-2" hint={n >= 1 ? `${n} gece` : 'En az 1 gece olmalı'}><input type="date" className="input" value={dep} min={r.arrival} onChange={e => setDep(e.target.value)} /></Field>
      </div>
      <ErrorBox error={act.error} />
    </Modal>
  );
}

export function CheckOutModal({ reservation: r, onClose }: { reservation: Reservation; onClose: () => void }) {
  const refresh = useRefresh();
  const { property } = useSession();
  const late = !!property && r.departure > property.businessDate;
  const act = useAction(async (key: string) => { await post(`/api/v1/reservations/${r.id}/check-out`, { version: r.version, lateCheckOut: false }, key); await refresh(); }, { success: `${r.guestName} çıkış yaptı.` });
  const open = !/^-?0+(\.0+)?$/.test(r.balance);
  return (
    <Modal title={`Çıkış (check-out) · ${r.roomNumber ?? ''}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={open || act.busy} onClick={async () => { if (await act.run() !== undefined) onClose(); }}>Çıkışı tamamla</button>
    </>}>
      <div className="stack">
        <div><b>{r.guestName}</b> · {fmtDate(r.arrival)} → {fmtDate(r.departure)}</div>
        <div className={open ? 'error-box' : 'ok-box'}>Toplam folyo bakiyesi: <b>{fmtMoney(r.balance, r.currency)}</b>{open && ' — çıkıştan önce bakiyenin kapatılması (tahsilat veya cari aktarımı) gerekir.'}</div>
        {late && <div className="info-box">Planlanan çıkış tarihinden ({fmtDate(r.departure)}) önce çıkış yapılıyor; kalan geceler için oda ücreti işlenmez.</div>}
        <ErrorBox error={act.error} />
      </div>
    </Modal>
  );
}
