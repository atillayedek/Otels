export const SITE = {
  product: 'TSDMR Otel PMS',
  studio: 'TSDMR Digital Studio',
  description:
    'Otelinizin kendi sunucusunda çalışan, internet bağlantısı gerektirmeyen otel yönetim sistemi. Rezervasyon, ön büro, folyo, kasa, gece denetimi ve eski programdan veri aktarımı.',
  url: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL || '',
  contactPhone: process.env.NEXT_PUBLIC_CONTACT_PHONE || '',
  legalName: process.env.NEXT_PUBLIC_LEGAL_NAME || '',
  legalAddress: process.env.NEXT_PUBLIC_LEGAL_ADDRESS || '',
};

export const NAV = [
  { href: '/urun', label: 'Ürün' },
  { href: '/nasil-calisir', label: 'Nasıl çalışır' },
  { href: '/on-siparis', label: 'Ön sipariş' },
];

export const STATUS_LABELS: Record<string, string> = {
  yeni: 'Yeni',
  iletisime_gecildi: 'İletişime geçildi',
  teklif_verildi: 'Teklif verildi',
  kazanildi: 'Kazanıldı',
  iptal: 'İptal',
};

export const SOFTWARE_LABELS: Record<string, string> = {
  amonra: 'AmonRa',
  elektraweb: 'ElektraWeb',
  diger: 'Diğer',
  yok: 'Program kullanmıyor',
};

export const OS_LABELS: Record<string, string> = {
  windows: 'Windows',
  linux: 'Linux',
  karar_verilmedi: 'Karar verilmedi',
};
