# İzin matrisi

Mevcut temel altı property rolünü kullanır. `private.allowed` ve RPC command permission mapping authoritative kaynak; UI gizleme yetki değildir. owner/manager tüm mevcut izinleri alır. property okuma genel tesis erişimidir; operations reception'a, finance accounting'e, housekeeping HK'ya, maintenance teknik role verilir.

| İşlem | owner/manager | reception | accounting | housekeeping | maintenance |
|---|---|---|---|---|---|
| Genel oda/tesis okuma | Evet | Evet | Evet | Evet | Evet |
| Misafir/rezervasyon/stay/KBS okuma | Evet | Evet | Hayır | Hayır | Hayır |
| Folyo/ledger okuma | Evet | Evet | Evet | Hayır | Hayır |
| Rezervasyon/check-in/out/move/extend | Evet | Evet | Hayır | Hayır | Hayır |
| Charge/payment/refund/reverse/transfer | Evet | Hayır | Evet | Hayır | Hayır |
| Temizlik değiştir | Evet | Hayır | Hayır | Evet | Hayır |
| Oda approved onayı | Evet | Hayır | Hayır | Hayır | Hayır |
| Bakım block/release | Evet | Hayır | Hayır | Hayır | Evet |
| Oda/tip/rol/manual KBS yönetimi | Evet | Hayır | Hayır | Hayır | Hayır |
| Audit oku | Evet | Hayır | Hayır | Hayır | Hayır |

Prompt kapsamındaki ayrı front-office manager, HK supervisor, finance manager, POS, satış/CRM, hotel/chain/org/platform manager rolleri henüz tam değildir. Refund/discount/override limits, support erişim süresi, identity view/export ve explicit roles/permissions pending. Migration005 admin/finance command MFA aal2 şartı implemented. Mevcut owner/manager eşitliği nihai finans görev ayrılığı kabulü değildir. Operasyon010 modülleri şu anda owner/manager admin izniyle yönetilir; diğer rollerin bu modüller için ayrı yetkileri henüz verilmez.

Kendi user_id için property_access select RLS vardır; diğer kullanıcı rolleri rastgele okunamaz. property_access tenant_id/property ve tenant_id/user composite FK ile üyelik tutarlılığı korunur; revocation/role-limit kapsamı yine doğrulanmalıdır.
