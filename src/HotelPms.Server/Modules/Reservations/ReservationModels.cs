using HotelPms.Server.Modules.Guests;

namespace HotelPms.Server.Modules.Reservations;

public sealed record ReservationDto(
    Guid Id, string ReservationNumber, string Status, Guid GuestId, string GuestName, bool GuestIsVip, bool GuestIsBlacklisted,
    Guid? CompanyId, string? CompanyName, Guid? AgencyId, string? AgencyName, Guid? GroupId, string? GroupName,
    Guid RoomTypeId, string RoomTypeCode, Guid? RoomId, string? RoomNumber, DateOnly Arrival, DateOnly Departure, int Nights,
    int Adults, int Children, Guid? RatePlanId, string? RatePlanCode, decimal NightlyRate, decimal TotalRate, string Currency, string MealPlan,
    string Source, string? Market, string? Segment, bool IsWalkIn, TimeOnly? Eta, TimeOnly? Etd, int RoomChargeWindow, string? Notes,
    string? SpecialRequests, decimal DepositRequired, DateOnly? OptionUntil, DateTime? CheckedInAt, DateTime? CheckedOutAt, DateTime? CancelledAt,
    string? CancelReason, DateTime CreatedAt, string? CreatedBy, decimal Balance, int Version);

public sealed record ReservationListItem(Guid Id, string ReservationNumber, string Status, string GuestName, bool GuestIsVip, string? CompanyName,
    string? AgencyName, string RoomTypeCode, string? RoomNumber, DateOnly Arrival, DateOnly Departure, int Adults, int Children,
    decimal NightlyRate, string Currency, string Source, decimal Balance);

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
    bool AllowOverbook = false);

public sealed record CancelRequest(string Reason, int Version);
public sealed record VersionRequest(int Version);
public sealed record CheckInRequest(Guid RoomId, bool EarlyCheckIn, int Version);
public sealed record WalkInRequest(SaveReservationRequest Reservation, Guid RoomId);
public sealed record CheckOutRequest(int Version, bool LateCheckOut);
public sealed record MoveRoomRequest(Guid RoomId, string Kind, bool KeepRate, decimal? NewNightlyRate, string Reason, int Version);
public sealed record ChangeStayRequest(DateOnly Departure, int Version);
public sealed record AssignRoomRequest(Guid? RoomId, int Version);
public sealed record AddSharerRequest(Guid GuestId);
public sealed record WakeupDto(Guid Id, Guid ReservationId, string? RoomNumber, string GuestName, DateTime CallAt, string Status, string? Notes);
public sealed record CreateWakeupRequest(Guid ReservationId, DateTime CallAt, string? Notes);

public sealed record AvailabilityDay(DateOnly Date, Guid RoomTypeId, string RoomTypeCode, int Total, int Blocked, int Sold, int Available);
public sealed record RatePreview(IReadOnlyList<NightRate> Nights, decimal Total, decimal Average, string Source);
public sealed record NightRate(DateOnly Date, decimal Rate);

public sealed record RackRoom(Guid Id, string Number, string? Floor, Guid RoomTypeId, string RoomTypeCode, string HkStatus, bool IsDnd, int SortOrder);
public sealed record RackBar(Guid ReservationId, string ReservationNumber, Guid? RoomId, Guid RoomTypeId, string Status, string GuestName,
    bool IsVip, DateOnly Arrival, DateOnly Departure, int Adults, int Children, string? CompanyName, string? AgencyName, decimal Balance);
public sealed record RackBlock(Guid Id, Guid RoomId, string Kind, DateOnly DateFrom, DateOnly DateTo, string Reason);
public sealed record RackResponse(DateOnly From, DateOnly To, DateOnly BusinessDate, IReadOnlyList<RackRoom> Rooms, IReadOnlyList<RackBar> Bars,
    IReadOnlyList<RackBlock> Blocks, IReadOnlyList<RackBar> Unassigned);
