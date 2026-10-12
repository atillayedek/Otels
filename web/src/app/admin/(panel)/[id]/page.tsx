import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Mail, Phone } from 'lucide-react';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { ROW_COLUMNS, type PreOrderRow } from '@/lib/admin-query';
import { OS_LABELS, SOFTWARE_LABELS, STATUS_LABELS } from '@/lib/site';
import { fmtDateTime } from '@/lib/format';
import { NoteForm, StatusForm } from './Forms';

interface Note { id: string; author_email: string; body: string; created_at: string }
interface Ev { id: number; actor_email: string | null; from_status: string | null; to_status: string; created_at: string }

export default async function PreOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sb = await supabaseServer();
  const [order, notes, events] = await Promise.all([
    sb.from('pre_orders').select(ROW_COLUMNS).eq('id', id).maybeSingle(),
    sb.from('pre_order_notes').select('id, author_email, body, created_at').eq('pre_order_id', id).order('created_at', { ascending: false }),
    sb.from('pre_order_events').select('id, actor_email, from_status, to_status, created_at').eq('pre_order_id', id).order('created_at', { ascending: false }),
  ]);
  if (order.error) return <div className="note err">Talep yüklenemedi. Hata kodu: A404</div>;
  const r = order.data as PreOrderRow | null;
  if (!r) notFound();

  return (
    <>
      <p><Link href="/admin"><ArrowLeft size={15} style={{ verticalAlign: '-2px' }} /> Taleplere dön</Link></p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 18 }}>
        <h1 style={{ fontSize: '1.6rem', margin: 0 }}>{r.hotel_name}</h1>
        <span className={`badge ${r.status}`}>{STATUS_LABELS[r.status]}</span>
        <span className="muted" style={{ fontFamily: 'ui-monospace, monospace' }}>{r.reference}</span>
      </div>

      <div className="grid detail-grid">
        <div style={{ display: 'grid', gap: 18 }}>
          <div className="card">
            <h3 style={{ marginBottom: 14 }}>Talep bilgileri</h3>
            <dl className="kv">
              <dt>İlgili kişi</dt><dd>{r.full_name}</dd>
              <dt>Telefon</dt><dd><a href={`tel:${r.phone.replace(/[^+\d]/g, '')}`}><Phone size={14} style={{ verticalAlign: '-2px' }} /> {r.phone}</a></dd>
              <dt>E-posta</dt><dd><a href={`mailto:${r.email}`}><Mail size={14} style={{ verticalAlign: '-2px' }} /> {r.email}</a></dd>
              <dt>Şehir</dt><dd>{r.city}</dd>
              <dt>Oda sayısı</dt><dd>{r.room_count ?? '—'}</dd>
              <dt>Bilgisayar sayısı</dt><dd>{r.client_count ?? '—'}</dd>
              <dt>Mevcut program</dt><dd>{r.current_software === 'diger' ? `Diğer: ${r.current_software_other ?? ''}` : SOFTWARE_LABELS[r.current_software]}</dd>
              <dt>Sunucu</dt><dd>{OS_LABELS[r.server_os]}</dd>
              <dt>Veri aktarımı</dt><dd>{r.needs_migration ? 'İsteniyor' : 'Belirtilmedi'}</dd>
              <dt>Talep tarihi</dt><dd>{fmtDateTime(r.created_at)}</dd>
              <dt>KVKK onayı</dt><dd>{fmtDateTime(r.kvkk_accepted_at)}</dd>
              <dt>Son güncelleme</dt><dd>{fmtDateTime(r.updated_at)}</dd>
            </dl>
            {r.message && (
              <>
                <h3 style={{ marginTop: 18 }}>Mesaj</h3>
                <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{r.message}</p>
              </>
            )}
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 12 }}>İç notlar</h3>
            <NoteForm id={r.id} />
            {notes.error ? <div className="note err" style={{ marginTop: 12 }}>Notlar yüklenemedi.</div>
              : (notes.data ?? []).length === 0 ? <p className="muted" style={{ marginTop: 12 }}>Henüz not eklenmedi.</p>
              : (
                <ul className="timeline" style={{ marginTop: 16 }}>
                  {(notes.data as Note[]).map(n => (
                    <li key={n.id}><small>{fmtDateTime(n.created_at)} · {n.author_email}</small><span style={{ whiteSpace: 'pre-wrap' }}>{n.body}</span></li>
                  ))}
                </ul>
              )}
          </div>
        </div>

        <div style={{ display: 'grid', gap: 18 }}>
          <div className="card">
            <h3 style={{ marginBottom: 12 }}>Durum</h3>
            <StatusForm id={r.id} status={r.status} />
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 12 }}>Durum geçmişi</h3>
            {(events.data ?? []).length === 0 ? <p className="muted" style={{ margin: 0 }}>Durum henüz değiştirilmedi.</p> : (
              <ul className="timeline">
                {(events.data as Ev[]).map(e => (
                  <li key={e.id}>
                    <small>{fmtDateTime(e.created_at)}{e.actor_email ? ` · ${e.actor_email}` : ''}</small>
                    {e.from_status ? `${STATUS_LABELS[e.from_status]} → ` : ''}<b>{STATUS_LABELS[e.to_status]}</b>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
