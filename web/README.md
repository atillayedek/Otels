# Ferrolit PMS — tanıtım sitesi

Landing, ürün bilgisi, nasıl çalışır, ön sipariş formu ve ön sipariş yönetim paneli.
Next.js 16 (App Router) + Supabase. **Ödeme alınmaz**; form yalnız talep kaydı oluşturur.
PMS'in kendisi bu sitede çalışmaz — PMS ekranları yalnız otelde kurulan PMS Client uygulamasındadır.

## Sayfalar

| Yol | İçerik |
|---|---|
| `/` | Landing |
| `/urun` | Modüller, KBS durumu, sistem gereksinimleri |
| `/nasil-calisir` | Kurulum adımları, sık sorulanlar |
| `/on-siparis` | Ön sipariş formu |
| `/kvkk` | KVKK aydınlatma metni |
| `/admin` | Talepler: filtre, arama, sayfalama, CSV dışa aktarma |
| `/admin/[id]` | Talep detayı, durum değiştirme, iç notlar, durum geçmişi |

## Veritabanı

Şema: [supabase/migrations/0001_pre_orders.sql](supabase/migrations/0001_pre_orders.sql) (Supabase projesine uygulanmış durumda).

- Ziyaretçi tablolara doğrudan erişemez; yalnız `submit_pre_order` fonksiyonunu çağırabilir.
- Fonksiyon kötüye kullanım sınırı uygular: aynı istemci saatte 5, aynı e-posta günde 3, toplam günde 500 talep.
- IP adresi saklanmaz; `CLIENT_KEY_SALT` ile tuzlanmış SHA-256 özeti tutulur.
- Panelde talepler silinemez; yalnız `status` güncellenebilir. Her durum değişikliği `pre_order_events` tablosuna, kimin yaptığıyla birlikte yazılır. Not yazarı sunucuda belirlenir.

## Yönetici hesabı oluşturma

1. Supabase panelinde **Authentication → Users → Add user** ile e-posta ve parola belirleyerek kullanıcı oluşturun.
2. **SQL Editor**'da kullanıcıyı yönetici yapın:
   ```sql
   insert into public.admin_users (user_id)
   select id from auth.users where email = 'yonetici@ornek.com';
   ```
3. **Authentication → Sign In / Providers** altında "Allow new users to sign up" seçeneğini kapatın. (Kapatılmasa da `admin_users` tablosunda olmayan hesaplar panele giremez ve hiçbir veriyi göremez.)

## Ortam değişkenleri

`.env.example` dosyasına bakın. Vercel'de proje ayarlarına girilmesi gerekenler:

| Değişken | Açıklama |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase proje adresi |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yayınlanabilir anahtar (tarayıcıya açık olması güvenlidir; erişimi RLS sınırlar) |
| `NEXT_PUBLIC_SITE_URL` | Sitenin canlı adresi |
| `CLIENT_KEY_SALT` | En az 32 karakter gizli rastgele değer. Üretmek için: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_CONTACT_PHONE`, `NEXT_PUBLIC_LEGAL_NAME`, `NEXT_PUBLIC_LEGAL_ADDRESS` | KVKK metnindeki veri sorumlusu bilgileri. KVKK gereği yayına almadan önce doldurulmalıdır. |

## Geliştirme

```bash
npm ci
npm run dev
```

Kontroller: `npm run lint`, `npm run typecheck`, `npm run build`.

## Vercel'e yayınlama

Vercel'de yeni proje oluştururken **Root Directory** olarak `web` seçin, yukarıdaki ortam değişkenlerini girin. Framework otomatik olarak Next.js algılanır.
