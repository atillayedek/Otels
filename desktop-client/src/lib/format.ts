// Türkçe biçimlendirme yardımcıları. Para değerleri sunucudan metin olarak gelir; kayan nokta hesabı yapılmaz.

const trDate = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const trDateTime = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const trDay = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short' });
const trWeekday = new Intl.DateTimeFormat('tr-TR', { weekday: 'short' });

/** "2026-10-12" → "12.10.2026" (saat dilimi kayması olmadan). */
export function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return trDate.format(new Date(Date.UTC(y, m - 1, d, 12)));
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : trDateTime.format(d);
}

export function fmtDay(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return { day: trDay.format(dt), weekday: trWeekday.format(dt), weekend: dt.getUTCDay() === 0 || dt.getUTCDay() === 6 };
}

/** Ondalık metni Türkçe para biçimine çevirir: "12500.5" → "12.500,50". Sayıya dönüştürmeden, metin üzerinde çalışır. */
export function fmtMoney(value?: string | null, currency?: string): string {
  if (value === undefined || value === null || value === '') return '';
  const neg = value.startsWith('-');
  const [intPart, frac = ''] = value.replace('-', '').split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dec = (frac + '00').slice(0, 2);
  return `${neg ? '-' : ''}${grouped},${dec}${currency ? ' ' + currency : ''}`;
}

/** Kullanıcı girişini sunucuya gidecek ondalık metne çevirir: "1.250,50" → "1250.50". Geçersizse null. */
export function parseMoney(input: string): string | null {
  const s = input.trim().replace(/\s/g, '').replace(/₺|TL|TRY/gi, '');
  if (!s) return null;
  let norm: string;
  if (s.includes(',') && (!s.includes('.') || s.lastIndexOf(',') > s.lastIndexOf('.'))) norm = s.replace(/\./g, '').replace(',', '.');
  else norm = s.replace(/,/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(norm)) return null;
  const [i, f = ''] = norm.split('.');
  return `${i}.${(f + '00').slice(0, 2)}`;
}

export function isNegative(value?: string | null) { return !!value && value.startsWith('-'); }
export function isZero(value?: string | null) { return !value || /^-?0+(\.0+)?$/.test(value); }

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function nightsBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function fmtBytes(n?: number | string | null) {
  const v = Number(n ?? 0);
  if (v < 1024) return `${v} B`;
  if (v < 1048576) return `${(v / 1024).toFixed(1).replace('.', ',')} KB`;
  if (v < 1073741824) return `${(v / 1048576).toFixed(1).replace('.', ',')} MB`;
  return `${(v / 1073741824).toFixed(2).replace('.', ',')} GB`;
}

export const STATUS_LABEL: Record<string, string> = {
  tentative: 'Opsiyon', confirmed: 'Onaylı', checked_in: 'Konaklıyor', checked_out: 'Çıkış yaptı', cancelled: 'İptal', no_show: 'No-show',
};
export const STATUS_BADGE: Record<string, string> = {
  tentative: 'yellow', confirmed: 'blue', checked_in: 'violet', checked_out: 'gray', cancelled: 'red', no_show: 'orange',
};
export const HK_LABEL: Record<string, string> = { clean: 'Temiz', dirty: 'Kirli', inspected: 'Kontrol edildi', cleaning: 'Temizleniyor' };
export const HK_BADGE: Record<string, string> = { clean: 'green', dirty: 'orange', inspected: 'teal', cleaning: 'blue' };
export const BLOCK_LABEL: Record<string, string> = { out_of_order: 'Arızalı (OOO)', out_of_service: 'Servis dışı', blocked: 'Bloke' };
export const MEAL_LABEL: Record<string, string> = { RO: 'Oda (RO)', BB: 'Oda kahvaltı (BB)', HB: 'Yarım pansiyon (HB)', FB: 'Tam pansiyon (FB)', AI: 'Her şey dahil (AI)', UAI: 'Ultra her şey dahil' };
export const SOURCE_LABEL: Record<string, string> = {
  direct: 'Doğrudan', walk_in: 'Walk-in', phone: 'Telefon', email: 'E-posta', web: 'Web', agency: 'Acente', company: 'Şirket', ota: 'Online kanal', migration: 'Aktarım', other: 'Diğer',
};
export const LINE_LABEL: Record<string, string> = {
  charge: 'Masraf', payment: 'Tahsilat', refund: 'İade', discount: 'İndirim', allowance: 'Allowance', deposit: 'Depozito', void: 'İptal', transfer_in: 'Aktarım (gelen)', transfer_out: 'Aktarım (giden)',
};
export const PRIORITY_LABEL: Record<string, string> = { low: 'Düşük', normal: 'Normal', high: 'Yüksek', urgent: 'Acil' };
export const TICKET_STATUS: Record<string, string> = { open: 'Açık', in_progress: 'Çalışılıyor', resolved: 'Çözüldü', closed: 'Kapandı', cancelled: 'İptal' };
export const TASK_LABEL: Record<string, string> = {
  departure_clean: 'Çıkış temizliği', stayover_clean: 'Konaklama temizliği', inspection: 'Kontrol', turndown: 'Akşam servisi', deep_clean: 'Detaylı temizlik', other: 'Diğer',
};
export const TASK_STATUS: Record<string, string> = { open: 'Bekliyor', in_progress: 'Yapılıyor', done: 'Tamamlandı', cancelled: 'İptal' };
export const KBS_STATUS: Record<string, string> = {
  needs_data: 'Eksik bilgi', blocked_configuration: 'Yapılandırılmamış', queued: 'Kuyrukta', processing: 'Gönderiliyor', sent_awaiting_confirmation: 'Onay bekliyor',
  accepted: 'Kabul edildi', retry_scheduled: 'Tekrar denenecek', rejected: 'Reddedildi', outcome_unknown: 'Sonuç belirsiz', manual_action_required: 'Manuel işlem gerekli',
  reported_manually: 'Manuel bildirildi', superseded: 'Geçersiz',
};
export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Süper Yönetici', HOTEL_ADMIN: 'Otel Yöneticisi', GENERAL_MANAGER: 'Genel Müdür', FRONT_OFFICE_MANAGER: 'Ön Büro Müdürü', RECEPTION: 'Resepsiyon',
  NIGHT_AUDIT: 'Gece Denetçisi', HOUSEKEEPING_MANAGER: 'Kat Hizmetleri Müdürü', HOUSEKEEPING: 'Kat Görevlisi', ACCOUNTING: 'Muhasebe', CASHIER: 'Kasiyer',
  SALES: 'Satış', TECHNICAL: 'Teknik Servis', REPORT_ONLY: 'Yalnız Rapor',
};

/** Yüzde metni: "45.50" → "45,5", "0.00" → "0". */
export function fmtPct(value?: string | null): string {
  if (!value) return '0';
  if (!value.includes('.')) return value;
  return value.replace(/0+$/, '').replace(/\.$/, '').replace('.', ',') || '0';
}
