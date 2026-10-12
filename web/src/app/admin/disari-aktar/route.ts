import { NextResponse, type NextRequest } from 'next/server';
import { currentAdmin, supabaseServer } from '@/lib/supabase/server';
import { applyFilter, parseFilter, ROW_COLUMNS, type PreOrderRow } from '@/lib/admin-query';
import { OS_LABELS, SOFTWARE_LABELS, STATUS_LABELS } from '@/lib/site';
import { fmtDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Hücre değeri; formül enjeksiyonuna karşı =,+,-,@ ile başlayan metinler etkisizleştirilir. */
function cell(v: unknown) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  if (!(await currentAdmin())) return new NextResponse('Yetkisiz', { status: 401 });
  const f = parseFilter(Object.fromEntries(req.nextUrl.searchParams.entries()));
  const sb = await supabaseServer();

  const rows: PreOrderRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await applyFilter(sb.from('pre_orders').select(ROW_COLUMNS), f)
      .order('created_at', { ascending: false })
      .range(from, from + 999);
    if (error) return new NextResponse('Dışa aktarma başarısız. Hata kodu: A502', { status: 500 });
    rows.push(...((data ?? []) as PreOrderRow[]));
    if (!data || data.length < 1000) break;
  }

  const head = ['Talep no', 'Tarih', 'Durum', 'Otel', 'Şehir', 'Ad soyad', 'Telefon', 'E-posta', 'Oda sayısı', 'Bilgisayar sayısı', 'Mevcut program', 'Sunucu', 'Veri aktarımı', 'Mesaj'];
  const lines = rows.map(r => [
    r.reference, fmtDateTime(r.created_at), STATUS_LABELS[r.status], r.hotel_name, r.city, r.full_name, r.phone, r.email,
    r.room_count, r.client_count, r.current_software === 'diger' ? r.current_software_other : SOFTWARE_LABELS[r.current_software],
    OS_LABELS[r.server_os], r.needs_migration ? 'Evet' : 'Hayır', r.message,
  ].map(cell).join(';'));
  // Excel'in Türkçe karakterleri doğru açması için UTF-8 BOM ve ; ayırıcı.
  const body = '﻿' + [head.map(cell).join(';'), ...lines].join('\r\n');
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="on-siparisler-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
