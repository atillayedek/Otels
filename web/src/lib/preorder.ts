import { z } from 'zod';

const optInt = (min: number, max: number, msg: string) =>
  z.string().trim().transform(v => v.replace(/\D/g, '')).refine(v => v === '' || (Number(v) >= min && Number(v) <= max), msg);

export const preOrderSchema = z
  .object({
    full_name: z.string().trim().min(2, 'Ad soyad en az 2 karakter olmalı.').max(120, 'Ad soyad çok uzun.'),
    hotel_name: z.string().trim().min(2, 'Otel adı en az 2 karakter olmalı.').max(160, 'Otel adı çok uzun.'),
    city: z.string().trim().min(2, 'Şehir girin.').max(80, 'Şehir adı çok uzun.'),
    phone: z.string().trim().regex(/^\+?[0-9 ()-]{10,20}$/, 'Geçerli bir telefon numarası girin (örn. 0532 123 45 67).'),
    email: z.string().trim().toLowerCase().max(160, 'E-posta çok uzun.').email('Geçerli bir e-posta adresi girin.'),
    room_count: optInt(1, 5000, 'Oda sayısı 1 ile 5000 arasında olmalı.'),
    client_count: optInt(1, 500, 'Bilgisayar sayısı 1 ile 500 arasında olmalı.'),
    current_software: z.enum(['amonra', 'elektraweb', 'diger', 'yok'], { message: 'Kullandığınız programı seçin.' }),
    current_software_other: z.string().trim().max(120, 'Program adı çok uzun.'),
    server_os: z.enum(['windows', 'linux', 'karar_verilmedi'], { message: 'Sunucu tercihini seçin.' }),
    needs_migration: z.boolean(),
    message: z.string().trim().max(2000, 'Mesaj en fazla 2000 karakter olabilir.'),
    kvkk_accepted: z.literal(true, { message: 'Devam etmek için aydınlatma metnini okuduğunuzu onaylayın.' }),
  })
  .refine(v => v.current_software !== 'diger' || v.current_software_other.length >= 2, {
    path: ['current_software_other'],
    message: 'Kullandığınız programın adını yazın.',
  });

export type PreOrderFieldErrors = Partial<Record<string, string>>;

export type PreOrderState =
  | { status: 'idle' }
  | { status: 'invalid'; errors: PreOrderFieldErrors; values: Record<string, string | boolean> }
  | { status: 'error'; message: string; values: Record<string, string | boolean> }
  | { status: 'ok'; reference: string };

export function readForm(fd: FormData) {
  const s = (k: string) => String(fd.get(k) ?? '');
  return {
    full_name: s('full_name'),
    hotel_name: s('hotel_name'),
    city: s('city'),
    phone: s('phone'),
    email: s('email'),
    room_count: s('room_count'),
    client_count: s('client_count'),
    current_software: s('current_software'),
    current_software_other: s('current_software_other'),
    server_os: s('server_os'),
    needs_migration: fd.get('needs_migration') === 'on',
    message: s('message'),
    kvkk_accepted: fd.get('kvkk_accepted') === 'on',
  };
}
