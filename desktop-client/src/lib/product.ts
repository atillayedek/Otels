/** Ürün ve destek bilgileri (tüm ekranlar ve uygulamalar bu sabitleri kullanır). */
export const IS_RESTAURANT_APP = import.meta.env.VITE_APP_MODE === 'restaurant';
export const PRODUCT_NAME = IS_RESTAURANT_APP ? 'TSDMR Restoran' : 'TSDMR Otel PMS';
export const VENDOR = 'TSDMR Digital Studio';
export const SUPPORT_EMAIL = 'iletisim@tsdmrdigitalstudio.com.tr';

/** Satış kanalı adları (sunucudaki ReservationService.Channels ile aynı kodlar). */
export const CHANNEL_NAME: Record<string, string> = {
  booking: 'Booking.com', expedia: 'Expedia', hotelrunner: 'HotelRunner', airbnb: 'Airbnb', agoda: 'Agoda', hotels_com: 'Hotels.com', etstur: 'Etstur',
  tatilsepeti: 'Tatilsepeti', jollytur: 'Jolly Tur', otelz: 'Otelz', trip_com: 'Trip.com', website: 'Otel web sitesi', other: 'Diğer kanal',
};
