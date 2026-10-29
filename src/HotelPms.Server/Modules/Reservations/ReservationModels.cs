using HotelPms.Server.Modules.Guests;

namespace HotelPms.Server.Modules.Reservations;

public sealed record ReservationDto(
    Guid Id, string ReservationNumber, string Status, Guid GuestId, string GuestName, bool GuestIsVip, bool GuestIsBlacklisted,
    Guid? CompanyId, string? CompanyName, Guid? AgencyId, string? AgencyName, Guid? GroupId, string? GroupName,
    Guid RoomTypeId, string RoomTypeCode, Guid? RoomId, string? RoomNumber, DateOnly Arrival, DateOnly Departure, int Nights,
    int Adults, int Children, Guid? RatePlanId, string? RatePlanCode, decimal NightlyRate, decimal TotalRate, string Currency, string MealPlan,
    string Source, string? Market, string? Segment, bool IsWalkIn, TimeOnly? Eta, TimeOnly? Etd, int RoomChargeWindow, string? Notes,
    string? SpecialRequests, decimal DepositRequired, DateOnly? OptionUntil, DateTime? CheckedInAt, DateTime? CheckedOutAt, DateTime? CancelledAt,
    string? CancelReason, DateTime CreatedAt, string? CreatedBy, decimal Balance, int Version, string? RateCurrency, decimal? FxNightlyRate,
    string? Channel, string? ChannelRef, string? GuestAlertNote = null,
    decimal? RateSgl = null, decimal? RateDbl = null, decimal? RateTrp = null, decimal? RateQuad = null);

/// <summary>Kişi sayısına göre gecelik fiyat (kontrat detayı). Tutarlar rezervasyonun fiyat para birimindedir; boş olan kullanılmaz.</summary>
public sealed record OccupancyRates(decimal? Single, decimal? Double, decimal? Triple, decimal? Quad)
{
    public bool IsEmpty => Single is null && Double is null && Triple is null && Quad is null;
    /// <summary>Yetişkin sayısına karşılık gelen fiyat (4 ve üstü dört kişilik).</summary>
    public decimal? For(int adults) => adults switch { <= 1 => Single, 2 => Double, 3 => Triple, _ => Quad };
}

public sealed record ReservationListItem(Guid Id, string ReservationNumber, string Status, string GuestName, bool GuestIsVip, string? CompanyName,
    string? AgencyName, string RoomTypeCode, string? RoomNumber, DateOnly Arrival, DateOnly Departure, int Adults, int Children,
    decimal NightlyRate, string Currency, string Source, decimal Balance, string? Channel, string? ChannelRef);

public sealed record SaveReservationRequest(
    Guid? GuestId,
    SaveGuestRequest? NewGuest,
    Guid? CompanyId,
    Guid? AgencyId,
    Guid? GroupId,
    Guid RoomTypeId,
    Guid? RoomId,
    DateOnly Arrival,
    DateOnly Departure,
    int Adults,
    int Children,
    Guid? RatePlanId,
    decimal? NightlyRate,
    string? MealPlan,
    string Status,
    string? Source,
    string? Market,
    string? Segment,
    TimeOnly? Eta,
    TimeOnly? Etd,
    string? Notes,
    string? SpecialRequests,
    decimal DepositRequired,
    DateOnly? OptionUntil,
    int? Version,
    // Müsaitlik yoksa overbooking ancak açıkça istenirse ve kullanıcının reservation.overbook yetkisi varsa yapılır.
    bool AllowOverbook = false,
    // Dövizli fiyat (ör. acente sözleşmesi EUR): NightlyRate bu dövizdedir; boşsa tesis para birimi.
    string? RateCurrency = null,
    // Satış kanalı (booking, expedia, hotelrunner…) ve kanalın rezervasyon numarası.
    string? Channel = null,
    string? ChannelRef = null,
    // Kişi sayısına göre fiyat: doluysa ve gecelik fiyat elle verilmemişse yetişkin sayısına karşılık gelen fiyat uygulanır.
    OccupancyRates? Occupancy = null);

public sealed record CancelRequest(string Reason, int Version);
public sealed record VersionRequest(int Version);
public sealed record CheckInRequest(Guid RoomId, bool EarlyCheckIn, int Version);
public sealed record WalkInRequest(SaveReservationRequest Reservation, Guid RoomId);
/// <summary>WaiveDayUse: aynı gün giriş-çıkışta oda ücreti alınmayacaksa (ücretsiz günübirlik) gerekçeyle birlikte; rate.override yetkisi ister.</summary>
public sealed record CheckOutRequest(int Version, bool LateCheckOut, bool WaiveDayUse = false, string? WaiveReason = null);
public sealed record MoveRoomRequest(Guid RoomId, string Kind, bool KeepRate, decimal? NewNightlyRate, string Reason, int Version);
public sealed record ChangeStayRequest(DateOnly Departure, int Version);
public sealed record AssignRoomRequest(Guid? RoomId, int Version);
public sealed record AddSharerRequest(Guid GuestId);
public sealed record WakeupDto(Guid Id, Guid ReservationId, string? RoomNumber, string GuestName, DateTime CallAt, string Status, string? Notes);
public sealed record CreateWakeupRequest(Guid ReservationId, DateTime CallAt, string? Notes);

/// <summary>Held: başka acentelere ayrılmış, henüz kullanılmamış ve release süresi dolmamış kontenjan (bu satış için kapalı).</summary>
public sealed record AvailabilityDay(DateOnly Date, Guid RoomTypeId, string RoomTypeCode, int Total, int Blocked, int Sold, int Held, int Available);
/// <summary>Currency: fiyat planının para birimi (boşsa tesis para birimi); tutarlar bu para birimindedir.</summary>
public sealed record RatePreview(IReadOnlyList<NightRate> Nights, decimal Total, decimal Average, string Source, string? Currency = null, decimal DiscountPct = 0);
public sealed record NightRate(DateOnly Date, decimal Rate);

public sealed record RackRoom(Guid Id, string Number, string? Floor, Guid RoomTypeId, string RoomTypeCode, string HkStatus, bool IsDnd, int SortOrder);
public sealed record RackBar(Guid ReservationId, string ReservationNumber, Guid? RoomId, Guid RoomTypeId, string Status, string GuestName,
    bool IsVip, DateOnly Arrival, DateOnly Departure, int Adults, int Children, string? CompanyName, string? AgencyName, decimal Balance);
public sealed record RackBlock(Guid Id, Guid RoomId, string Kind, DateOnly DateFrom, DateOnly DateTo, string Reason);
public sealed record RackResponse(DateOnly From, DateOnly To, DateOnly BusinessDate, IReadOnlyList<RackRoom> Rooms, IReadOnlyList<RackBar> Bars,
    IReadOnlyList<RackBlock> Blocks, IReadOnlyList<RackBar> Unassigned);
