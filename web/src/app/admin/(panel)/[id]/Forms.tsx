'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Save, StickyNote } from 'lucide-react';
import { STATUS_LABELS } from '@/lib/site';
import { addNote, updateStatus, type FormMsg } from '../../actions';

export function StatusForm({ id, status }: { id: string; status: string }) {
  const [state, action, pending] = useActionState<FormMsg, FormData>(updateStatus, null);
  const [value, setValue] = useState(status);
  return (
    <form action={action} style={{ display: 'grid', gap: 10 }}>
      <input type="hidden" name="id" value={id} />
      <select name="status" className="input" value={value} onChange={e => setValue(e.target.value)} aria-label="Durum">
        {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {state?.error && <div className="note err">{state.error}</div>}
      {state?.ok && <div className="note ok">{state.ok}</div>}
      <button className="btn primary" disabled={pending || value === status}><Save /> Durumu kaydet</button>
    </form>
  );
}

export function NoteForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<FormMsg, FormData>(addNote, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} style={{ display: 'grid', gap: 10 }}>
      <input type="hidden" name="id" value={id} />
      <textarea name="body" className="input" placeholder="Görüşme notu, teklif bilgisi vb." maxLength={4000} required style={{ minHeight: 90 }} aria-label="Not" />
      {state?.error && <div className="note err">{state.error}</div>}
      <div><button className="btn" disabled={pending}><StickyNote /> {pending ? 'Kaydediliyor…' : 'Not ekle'}</button></div>
    </form>
  );
}
