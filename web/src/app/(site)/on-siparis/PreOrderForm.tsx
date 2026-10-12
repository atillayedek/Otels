'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Send } from 'lucide-react';
import type { PreOrderState } from '@/lib/preorder';
import { submitPreOrder } from './actions';

const EMPTY = {
  full_name: '', hotel_name: '', city: '', phone: '', email: '', room_count: '', client_count: '',
  current_software: '', current_software_other: '', server_os: '', needs_migration: false, message: '', kvkk_accepted: false,
};
type Values = typeof EMPTY;

export function PreOrderForm() {
  const [state, action, pending] = useActionState<PreOrderState, FormData>(submitPreOrder, { status: 'idle' });
  const [v, setV] = useState<Values>(EMPTY);
  const started = useRef<HTMLInputElement>(null);
  const openedAt = useRef(0);

  // Formun açıldığı an; React form sıfırlamasından sonra da yeniden yazılır.
  useEffect(() => {
    if (!openedAt.current) openedAt.current = Date.now();
    if (started.current) started.current.value = String(openedAt.current);
  });

  if (state.status === 'ok') {
    return (
      <div className="card elev" role="status">
        <span className="icon-chip" style={{ background: 'var(--ok-50)', color: 'var(--ok)' }}><CheckCircle2 /></span>
        <h2>Talebiniz alındı</h2>
        <p>Talep numaranız: <b style={{ fontFamily: 'ui-monospace, monospace' }}>{state.reference}</b></p>
        <p className="muted">Bilgilerinizi inceleyip verdiğiniz telefon veya e-posta üzerinden sizinle iletişime geçeceğiz. Bu talep herhangi bir ödeme yükümlülüğü doğurmaz.</p>
        <Link href="/" className="btn">Ana sayfaya dön</Link>
      </div>
    );
  }

  const errors = state.status === 'invalid' ? state.errors : {};
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const t = e.target;
    setV(s => ({ ...s, [k]: t instanceof HTMLInputElement && t.type === 'checkbox' ? t.checked : t.value }));
  };
  const err = (k: string) => (errors[k] ? <span className="err-text" id={`${k}-err`}>{errors[k]}</span> : null);
  const aria = (k: string) => ({ 'aria-invalid': errors[k] ? true : undefined, 'aria-describedby': errors[k] ? `${k}-err` : undefined });

  return (
    <form action={action} className="card elev" noValidate>
      <div className="form">
        <div className="field">
          <label htmlFor="full_name">Ad soyad <span className="req">*</span></label>
          <input id="full_name" name="full_name" className="input" autoComplete="name" value={v.full_name} onChange={set('full_name')} required maxLength={120} {...aria('full_name')} />
          {err('full_name')}
        </div>
        <div className="field">
          <label htmlFor="hotel_name">Otel adı <span className="req">*</span></label>
          <input id="hotel_name" name="hotel_name" className="input" autoComplete="organization" value={v.hotel_name} onChange={set('hotel_name')} required maxLength={160} {...aria('hotel_name')} />
          {err('hotel_name')}
        </div>
        <div className="field">
          <label htmlFor="phone">Telefon <span className="req">*</span></label>
          <input id="phone" name="phone" className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="0532 123 45 67" value={v.phone} onChange={set('phone')} required maxLength={20} {...aria('phone')} />
          {err('phone')}
        </div>
        <div className="field">
          <label htmlFor="email">E-posta <span className="req">*</span></label>
          <input id="email" name="email" className="input" type="email" inputMode="email" autoComplete="email" value={v.email} onChange={set('email')} required maxLength={160} {...aria('email')} />
          {err('email')}
        </div>
        <div className="field">
          <label htmlFor="city">Şehir <span className="req">*</span></label>
          <input id="city" name="city" className="input" autoComplete="address-level1" value={v.city} onChange={set('city')} required maxLength={80} {...aria('city')} />
          {err('city')}
        </div>
        <div className="field">
          <label htmlFor="room_count">Oda sayısı</label>
          <input id="room_count" name="room_count" className="input" inputMode="numeric" value={v.room_count} onChange={set('room_count')} maxLength={4} {...aria('room_count')} />
          {err('room_count')}
        </div>
        <div className="field">
          <label htmlFor="current_software">Şu an kullandığınız program <span className="req">*</span></label>
          <select id="current_software" name="current_software" className="input" value={v.current_software} onChange={set('current_software')} required {...aria('current_software')}>
            <option value="" disabled>Seçin</option>
            <option value="amonra">AmonRa</option>
            <option value="elektraweb">ElektraWeb</option>
            <option value="diger">Diğer</option>
            <option value="yok">Program kullanmıyoruz</option>
          </select>
          {err('current_software')}
        </div>
        {v.current_software === 'diger' ? (
          <div className="field">
            <label htmlFor="current_software_other">Program adı <span className="req">*</span></label>
            <input id="current_software_other" name="current_software_other" className="input" value={v.current_software_other} onChange={set('current_software_other')} maxLength={120} {...aria('current_software_other')} />
            {err('current_software_other')}
          </div>
        ) : <input type="hidden" name="current_software_other" value="" />}
        <div className="field">
          <label htmlFor="server_os">Sunucu bilgisayar <span className="req">*</span></label>
          <select id="server_os" name="server_os" className="input" value={v.server_os} onChange={set('server_os')} required {...aria('server_os')}>
            <option value="" disabled>Seçin</option>
            <option value="windows">Windows</option>
            <option value="linux">Linux</option>
            <option value="karar_verilmedi">Henüz karar vermedik</option>
          </select>
          {err('server_os')}
        </div>
        <div className="field">
          <label htmlFor="client_count">Bağlanacak bilgisayar sayısı</label>
          <input id="client_count" name="client_count" className="input" inputMode="numeric" value={v.client_count} onChange={set('client_count')} maxLength={3} {...aria('client_count')} />
          <span className="hint">Resepsiyon, kasa, kat hizmetleri vb.</span>
          {err('client_count')}
        </div>
        <div className="field full">
          <label className="choice">
            <input type="checkbox" name="needs_migration" checked={v.needs_migration} onChange={set('needs_migration')} />
            <span>Mevcut programımızdaki misafir, şirket ve cari kayıtlarının aktarılmasını istiyoruz.</span>
          </label>
        </div>
        <div className="field full">
          <label htmlFor="message">Eklemek istedikleriniz</label>
          <textarea id="message" name="message" className="input" value={v.message} onChange={set('message')} maxLength={2000} {...aria('message')} />
          <span className="hint">{v.message.length}/2000</span>
          {err('message')}
        </div>
        <div className="field full">
          <label className="choice">
            <input type="checkbox" name="kvkk_accepted" checked={v.kvkk_accepted} onChange={set('kvkk_accepted')} {...aria('kvkk_accepted')} />
            <span>Kişisel verilerimin bu talebin değerlendirilmesi ve benimle iletişime geçilmesi amacıyla işlenmesine ilişkin <Link href="/kvkk" target="_blank">aydınlatma metnini</Link> okudum. <span className="req">*</span></span>
          </label>
          {err('kvkk_accepted')}
        </div>

        <div className="hp" aria-hidden="true">
          <label htmlFor="website">Web sitesi</label>
          <input id="website" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </div>
        <input ref={started} type="hidden" name="started_at" defaultValue="" />

        {state.status === 'error' && <div className="note err full" role="alert">{state.message}</div>}
        {state.status === 'invalid' && <div className="note err full" role="alert">Lütfen işaretli alanları düzeltin.</div>}

        <div className="full" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <button className="btn primary" type="submit" disabled={pending}><Send /> {pending ? 'Gönderiliyor…' : 'Ön sipariş talebini gönder'}</button>
          <span className="muted" style={{ fontSize: 14 }}>Ödeme bilgisi istenmez.</span>
        </div>
      </div>
    </form>
  );
}
