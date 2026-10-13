using System.Globalization;
using System.Text;
using ClosedXML.Excel;
using Dapper;
using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.NightAudit;

namespace HotelPms.Server.Modules.Reports;

public sealed record ReportColumn(string Key, string Header, string Type);
public sealed record ReportParam(string Key, string Label, string Type, bool Required);
public sealed record ReportInfo(string Name, string Title, string Category, IReadOnlyList<ReportParam> Params, IReadOnlyList<ReportColumn> Columns);
public sealed record ReportResult(string Name, string Title, IReadOnlyList<ReportColumn> Columns, IReadOnlyList<IDictionary<string, object?>> Rows,
    IDictionary<string, object?> Totals, DateTime GeneratedAt, DateOnly BusinessDate);

public sealed class ReportDefinition
{
    public required string Name { get; init; }
    public required string Title { get; init; }
    public required string Category { get; init; }
    public required string Permission { get; init; }
    public required ReportColumn[] Columns { get; init; }
    public ReportParam[] Params { get; init; } = [];
    public required string Sql { get; init; }
    /// <summary>Toplamı alınacak sayısal kolonlar.</summary>
    public string[] SumColumns { get; init; } = [];
}

public sealed record DashboardDto(DateOnly BusinessDate, string HotelName, string Currency, int RoomsTotal, int Occupied, int VacantClean, int VacantDirty,
    int OutOfOrder, int ArrivalsExpected, int ArrivalsCheckedIn, int DeparturesExpected, int DeparturesCheckedOut, int GuestsInHouse,
    decimal OccupancyPct, decimal RoomRevenueToday, decimal OtherRevenueToday, decimal PaymentsToday, decimal OpenBalance, int OpenTickets,
    int OpenHkTasks, int KbsPending, int PendingWakeups, DateOnly? LastNightAudit, IReadOnlyList<ForecastDay> Forecast);
public sealed record ForecastDay(DateOnly Date, int Sold, int Available, decimal OccupancyPct);

public sealed record AuditLogDto(long Id, DateTime At, string? Username, string? Hostname, string? Ip, string Action, string? EntityType, string? EntityId,
    string? OldValue, string? NewValue, string? Reason);

public static class ReportEndpoints
{
    static readonly ReportParam From = new("from", "Başlangıç", "date", true);
    static readonly ReportParam To = new("to", "Bitiş", "date", true);
    static readonly ReportParam Date = new("date", "Tarih", "date", false);

    public static readonly ReportDefinition[] Definitions =
    [
        new()
        {
            Name = "occupancy", Title = "Doluluk, ADR ve RevPAR", Category = "Gelir", Permission = "financial_report.view", Params = [From, To],
            Columns = [new("date", "Tarih", "date"), new("source", "Kaynak", "text"), new("roomsAvailable", "Satılabilir Oda", "int"),
                new("roomsSold", "Satılan Oda", "int"), new("occupancyPct", "Doluluk %", "decimal"), new("roomRevenue", "Oda Geliri", "money"),
                new("adr", "ADR", "money"), new("revpar", "RevPAR", "money")],
            SumColumns = ["roomsSold", "roomRevenue"],
            Sql = """
                WITH days AS (SELECT d::date AS d FROM generate_series(@from::date, @to::date, interval '1 day') d),
                     bd AS (SELECT business_date FROM pms.property LIMIT 1)
                SELECT days.d AS date,
                       CASE WHEN s.business_date IS NOT NULL THEN 'Gerçekleşen' ELSE 'Tahmin (OTB)' END AS source,
                       COALESCE(s.rooms_available, f.avail) AS rooms_available,
                       COALESCE(s.rooms_sold, f.sold) AS rooms_sold,
                       COALESCE(s.occupancy_pct, CASE WHEN f.avail = 0 THEN 0 ELSE round(f.sold * 100.0 / f.avail, 2) END) AS occupancy_pct,
                       COALESCE(s.room_revenue, f.rev) AS room_revenue,
                       COALESCE(s.adr, CASE WHEN f.sold = 0 THEN 0 ELSE round(f.rev / f.sold, 2) END) AS adr,
                       COALESCE(s.revpar, CASE WHEN f.avail = 0 THEN 0 ELSE round(f.rev / f.avail, 2) END) AS revpar
                FROM days
                LEFT JOIN pms.daily_statistics s ON s.business_date = days.d
                LEFT JOIN LATERAL (
                    SELECT (SELECT count(*) FROM pms.rooms WHERE is_active)
                           - (SELECT count(DISTINCT b.room_id) FROM pms.room_blocks b WHERE b.is_active AND b.kind = 'out_of_order' AND b.date_from <= days.d AND b.date_to > days.d) AS avail,
                           (SELECT count(*) FROM pms.reservations r WHERE r.status IN ('tentative','confirmed','checked_in') AND r.arrival <= days.d AND r.departure > days.d) AS sold,
                           (SELECT COALESCE(sum(rr.rate), 0) FROM pms.reservation_rates rr JOIN pms.reservations r ON r.id = rr.reservation_id
                             WHERE rr.stay_date = days.d AND r.status IN ('tentative','confirmed','checked_in')) AS rev
                ) f ON true
                ORDER BY days.d
                """,
        },
        new()
        {
            Name = "arrivals", Title = "Geliş Listesi", Category = "Ön Büro", Permission = "report.view", Params = [Date],
            Columns = [new("reservationNumber", "Rez. No", "text"), new("guestName", "Misafir", "text"), new("vip", "VIP", "bool"), new("roomType", "Oda Tipi", "text"),
                new("room", "Oda", "text"), new("nights", "Gece", "int"), new("pax", "Kişi", "text"), new("account", "Şirket/Acente", "text"),
                new("status", "Durum", "text"), new("eta", "Tahmini Geliş", "text"), new("specialRequests", "Özel İstek", "text")],
            Sql = """
                SELECT r.reservation_number, g.first_name || ' ' || g.last_name AS guest_name, g.is_vip AS vip, t.code AS room_type, rm.number AS room,
                       (r.departure - r.arrival) AS nights, r.adults || '+' || r.children AS pax, COALESCE(c.name, a.name) AS account,
                       r.status, to_char(r.eta, 'HH24:MI') AS eta, r.special_requests
                FROM pms.reservations r JOIN pms.guests g ON g.id = r.guest_id JOIN pms.room_types t ON t.id = r.room_type_id
                LEFT JOIN pms.rooms rm ON rm.id = r.room_id LEFT JOIN pms.companies c ON c.id = r.company_id LEFT JOIN pms.agencies a ON a.id = r.agency_id
                WHERE r.arrival = COALESCE(@date::date, (SELECT business_date FROM pms.property LIMIT 1)) AND r.status IN ('tentative','confirmed','checked_in')
                ORDER BY r.status, rm.number NULLS LAST, g.last_name
                """,
        },
        new()
        {
            Name = "departures", Title = "Çıkış Listesi", Category = "Ön Büro", Permission = "report.view", Params = [Date],
            Columns = [new("room", "Oda", "text"), new("reservationNumber", "Rez. No", "text"), new("guestName", "Misafir", "text"), new("arrival", "Giriş", "date"),
                new("status", "Durum", "text"), new("balance", "Bakiye", "money"), new("etd", "Tahmini Çıkış", "text")],
            SumColumns = ["balance"],
            Sql = """
                SELECT rm.number AS room, r.reservation_number, g.first_name || ' ' || g.last_name AS guest_name, r.arrival, r.status,
                       COALESCE((SELECT sum(l.amount) FROM pms.folios f JOIN pms.folio_lines l ON l.folio_id = f.id WHERE f.reservation_id = r.id), 0) AS balance,
                       to_char(r.etd, 'HH24:MI') AS etd
                FROM pms.reservations r JOIN pms.guests g ON g.id = r.guest_id LEFT JOIN pms.rooms rm ON rm.id = r.room_id
                WHERE r.departure = COALESCE(@date::date, (SELECT business_date FROM pms.property LIMIT 1)) AND r.status IN ('checked_in','checked_out')
                ORDER BY rm.number
                """,
        },
        new()
        {
            Name = "inhouse", Title = "Konaklayan Misafirler", Category = "Ön Büro", Permission = "report.view",
            Columns = [new("room", "Oda", "text"), new("guestName", "Misafir", "text"), new("nationality", "Uyruk", "text"), new("arrival", "Giriş", "date"),
                new("departure", "Çıkış", "date"), new("pax", "Kişi", "text"), new("mealPlan", "Pansiyon", "text"), new("account", "Şirket/Acente", "text"),
                new("rate", "Gecelik", "money"), new("balance", "Bakiye", "money")],
            SumColumns = ["balance"],
            Sql = """
                SELECT rm.number AS room, g.first_name || ' ' || g.last_name AS guest_name, g.nationality::text AS nationality, r.arrival, r.departure,
                       r.adults || '+' || r.children AS pax, r.meal_plan, COALESCE(c.name, a.name) AS account, r.nightly_rate AS rate,
                       COALESCE((SELECT sum(l.amount) FROM pms.folios f JOIN pms.folio_lines l ON l.folio_id = f.id WHERE f.reservation_id = r.id), 0) AS balance
                FROM pms.reservations r JOIN pms.guests g ON g.id = r.guest_id JOIN pms.rooms rm ON rm.id = r.room_id
                LEFT JOIN pms.companies c ON c.id = r.company_id LEFT JOIN pms.agencies a ON a.id = r.agency_id
                WHERE r.status = 'checked_in' ORDER BY rm.sort_order, rm.number
                """,
        },
        new()
        {
            Name = "guest-list", Title = "Misafir Listesi (Konaklayan + Ek Misafirler)", Category = "Ön Büro", Permission = "report.view",
            Columns = [new("room", "Oda", "text"), new("guestName", "Misafir", "text"), new("nationality", "Uyruk", "text"), new("birthDate", "Doğum Tarihi", "date"),
                new("primary", "Ana Misafir", "bool"), new("arrival", "Giriş", "date"), new("departure", "Çıkış", "date")],
            Sql = """
                SELECT rm.number AS room, g.first_name || ' ' || g.last_name AS guest_name, g.nationality::text AS nationality, g.birth_date, rg.is_primary AS primary,
                       r.arrival, r.departure
                FROM pms.reservations r JOIN pms.reservation_guests rg ON rg.reservation_id = r.id JOIN pms.guests g ON g.id = rg.guest_id
                JOIN pms.rooms rm ON rm.id = r.room_id WHERE r.status = 'checked_in' ORDER BY rm.sort_order, rm.number, rg.is_primary DESC
                """,
        },
        new()
        {
            Name = "no-show-cancel", Title = "No-show ve İptaller", Category = "Ön Büro", Permission = "report.view", Params = [From, To],
            Columns = [new("reservationNumber", "Rez. No", "text"), new("guestName", "Misafir", "text"), new("status", "Durum", "text"), new("arrival", "Giriş", "date"),
                new("departure", "Çıkış", "date"), new("actionDate", "İşlem İş Günü", "date"), new("reason", "Gerekçe", "text"), new("account", "Şirket/Acente", "text")],
            Sql = """
                SELECT r.reservation_number, g.first_name || ' ' || g.last_name AS guest_name, r.status, r.arrival, r.departure,
                       COALESCE(r.cancelled_on, r.no_show_on) AS action_date, r.cancel_reason AS reason, COALESCE(c.name, a.name) AS account
                FROM pms.reservations r JOIN pms.guests g ON g.id = r.guest_id LEFT JOIN pms.companies c ON c.id = r.company_id LEFT JOIN pms.agencies a ON a.id = r.agency_id
                WHERE r.status IN ('cancelled','no_show') AND COALESCE(r.cancelled_on, r.no_show_on) BETWEEN @from AND @to
                ORDER BY action_date, r.reservation_number
                """,
        },
        new()
        {
            Name = "room-status", Title = "Oda Durum Raporu", Category = "Kat Hizmetleri", Permission = "report.view",
            Columns = [new("room", "Oda", "text"), new("floor", "Kat", "text"), new("roomType", "Tip", "text"), new("hkStatus", "Temizlik", "text"),
                new("foStatus", "Ön Büro", "text"), new("block", "Blokaj", "text"), new("guest", "Misafir", "text"), new("note", "Not", "text")],
            Sql = """
                SELECT r.number AS room, r.floor, t.code AS room_type,
                       CASE r.hk_status WHEN 'clean' THEN 'Temiz' WHEN 'dirty' THEN 'Kirli' WHEN 'inspected' THEN 'Kontrol Edildi' ELSE 'Temizleniyor' END
                         || CASE WHEN r.is_dnd THEN ' (DND)' ELSE '' END AS hk_status,
                       CASE WHEN ih.id IS NOT NULL THEN 'Dolu' ELSE 'Boş' END AS fo_status,
                       (SELECT CASE b.kind WHEN 'out_of_order' THEN 'Arızalı' WHEN 'out_of_service' THEN 'Servis Dışı' ELSE 'Bloke' END || ': ' || b.reason
                          FROM pms.room_blocks b WHERE b.room_id = r.id AND b.is_active AND b.date_from <= p.business_date AND b.date_to > p.business_date LIMIT 1) AS block,
                       g.first_name || ' ' || g.last_name AS guest, r.hk_note AS note
                FROM pms.rooms r CROSS JOIN (SELECT business_date FROM pms.property LIMIT 1) p JOIN pms.room_types t ON t.id = r.room_type_id
                LEFT JOIN pms.reservations ih ON ih.room_id = r.id AND ih.status = 'checked_in' LEFT JOIN pms.guests g ON g.id = ih.guest_id
                WHERE r.is_active ORDER BY r.floor NULLS LAST, r.sort_order, r.number
                """,
        },
        new()
        {
            Name = "housekeeping", Title = "Kat Hizmetleri Görev Raporu", Category = "Kat Hizmetleri", Permission = "report.view", Params = [Date],
            Columns = [new("room", "Oda", "text"), new("floor", "Kat", "text"), new("task", "Görev", "text"), new("status", "Durum", "text"),
                new("assignedTo", "Görevli", "text"), new("completedAt", "Tamamlanma", "datetime"), new("notes", "Not", "text")],
            Sql = """
                SELECT r.number AS room, r.floor, k.task_type AS task, k.status, u.full_name AS assigned_to, k.completed_at, k.notes
                FROM pms.hk_tasks k JOIN pms.rooms r ON r.id = k.room_id LEFT JOIN pms.users u ON u.id = k.assigned_user_id
                WHERE k.business_date = COALESCE(@date::date, (SELECT business_date FROM pms.property LIMIT 1))
                ORDER BY r.floor NULLS LAST, r.number
                """,
        },
        new()
        {
            Name = "cashier", Title = "Kasa Raporu (Ödeme Tipine Göre)", Category = "Finans", Permission = "financial_report.view", Params = [From, To],
            Columns = [new("businessDate", "İş Günü", "date"), new("user", "Kullanıcı", "text"), new("paymentMethod", "Ödeme Tipi", "text"),
                new("collected", "Tahsilat", "money"), new("refunded", "İade", "money"), new("net", "Net", "money"), new("count", "Adet", "int")],
            SumColumns = ["collected", "refunded", "net", "count"],
            Sql = """
                SELECT l.business_date, u.username AS user, pm.name AS payment_method,
                       COALESCE(-sum(l.amount) FILTER (WHERE l.amount < 0), 0) AS collected,
                       COALESCE(sum(l.amount) FILTER (WHERE l.amount > 0), 0) AS refunded,
                       -sum(l.amount) AS net, count(*)::int AS count
                FROM pms.folio_lines l JOIN pms.payment_methods pm ON pm.id = l.payment_method_id LEFT JOIN pms.users u ON u.id = l.user_id
                WHERE l.business_date BETWEEN @from AND @to AND l.line_type IN ('payment','deposit','refund','void')
                GROUP BY l.business_date, u.username, pm.name, pm.sort_order ORDER BY l.business_date, u.username, pm.sort_order
                """,
        },
        new()
        {
            Name = "charges", Title = "Gelir / Masraf Dökümü", Category = "Finans", Permission = "financial_report.view", Params = [From, To],
            Columns = [new("businessDate", "İş Günü", "date"), new("code", "Kod", "text"), new("name", "İşlem", "text"), new("category", "Kategori", "text"),
                new("quantity", "Miktar", "decimal"), new("amount", "Tutar", "money")],
            SumColumns = ["amount"],
            Sql = """
                SELECT l.business_date, COALESCE(tc.code, upper(l.line_type)) AS code, COALESCE(tc.name, l.line_type) AS name, COALESCE(tc.category, '-') AS category,
                       sum(l.quantity) AS quantity, sum(l.amount) AS amount
                FROM pms.folio_lines l LEFT JOIN pms.transaction_codes tc ON tc.id = l.transaction_code_id
                WHERE l.business_date BETWEEN @from AND @to AND l.line_type IN ('charge','discount','allowance','void') AND l.payment_method_id IS NULL
                  AND NOT EXISTS (SELECT 1 FROM pms.folio_lines o WHERE o.id = l.related_line_id AND o.line_type IN ('payment','deposit'))
                GROUP BY l.business_date, tc.code, tc.name, tc.category, l.line_type ORDER BY l.business_date, code
                """,
        },
        new()
        {
            Name = "payments", Title = "Tahsilat Detayı", Category = "Finans", Permission = "financial_report.view", Params = [From, To],
            Columns = [new("postedAt", "Zaman", "datetime"), new("folio", "Folyo", "text"), new("room", "Oda", "text"), new("type", "Tür", "text"),
                new("paymentMethod", "Ödeme Tipi", "text"), new("amount", "Tutar", "money"), new("reference", "Referans", "text"), new("user", "Kullanıcı", "text"),
                new("shift", "Vardiya", "int")],
            SumColumns = ["amount"],
            Sql = """
                SELECT l.posted_at, f.folio_number AS folio, l.room_number AS room, l.line_type AS type, pm.name AS payment_method, -l.amount AS amount, l.reference,
                       u.username AS user, cs.shift_no AS shift
                FROM pms.folio_lines l JOIN pms.folios f ON f.id = l.folio_id JOIN pms.payment_methods pm ON pm.id = l.payment_method_id
                LEFT JOIN pms.users u ON u.id = l.user_id LEFT JOIN pms.cashier_shifts cs ON cs.id = l.cashier_shift_id
                WHERE l.business_date BETWEEN @from AND @to ORDER BY l.posted_at
                """,
        },
        new()
        {
            Name = "folio-balances", Title = "Açık Folyo Bakiyeleri", Category = "Finans", Permission = "financial_report.view",
            Columns = [new("folio", "Folyo", "text"), new("name", "Ad", "text"), new("reservation", "Rezervasyon", "text"), new("room", "Oda", "text"),
                new("reservationStatus", "Konaklama", "text"), new("charges", "Borç", "money"), new("credits", "Alacak", "money"), new("balance", "Bakiye", "money")],
            SumColumns = ["charges", "credits", "balance"],
            Sql = """
                SELECT f.folio_number AS folio, f.name, r.reservation_number AS reservation, rm.number AS room, r.status AS reservation_status,
                       COALESCE(sum(l.amount) FILTER (WHERE l.amount > 0), 0) AS charges, COALESCE(-sum(l.amount) FILTER (WHERE l.amount < 0), 0) AS credits,
                       COALESCE(sum(l.amount), 0) AS balance
                FROM pms.folios f LEFT JOIN pms.folio_lines l ON l.folio_id = f.id LEFT JOIN pms.reservations r ON r.id = f.reservation_id
                LEFT JOIN pms.rooms rm ON rm.id = r.room_id
                GROUP BY f.id, r.reservation_number, rm.number, r.status HAVING COALESCE(sum(l.amount), 0) <> 0
                ORDER BY balance DESC
                """,
        },
        new()
        {
            Name = "company-ledger", Title = "Şirket Cari (City Ledger)", Category = "Finans", Permission = "financial_report.view",
            Columns = [new("code", "Kod", "text"), new("name", "Şirket", "text"), new("creditLimit", "Kredi Limiti", "money"), new("charges", "Borç", "money"),
                new("credits", "Alacak", "money"), new("balance", "Bakiye", "money")],
            SumColumns = ["charges", "credits", "balance"],
            Sql = """
                SELECT c.code, c.name, c.credit_limit,
                       COALESCE(sum(l.amount) FILTER (WHERE l.amount > 0), 0) AS charges, COALESCE(-sum(l.amount) FILTER (WHERE l.amount < 0), 0) AS credits,
                       COALESCE(sum(l.amount), 0) AS balance
                FROM pms.companies c JOIN pms.folios f ON f.company_id = c.id AND f.reservation_id IS NULL LEFT JOIN pms.folio_lines l ON l.folio_id = f.id
                GROUP BY c.id ORDER BY balance DESC
                """,
        },
        new()
        {
            Name = "agency-ledger", Title = "Acente Cari", Category = "Finans", Permission = "financial_report.view",
            Columns = [new("code", "Kod", "text"), new("name", "Acente", "text"), new("commissionRate", "Komisyon %", "decimal"), new("charges", "Borç", "money"),
                new("credits", "Alacak", "money"), new("balance", "Bakiye", "money")],
            SumColumns = ["charges", "credits", "balance"],
            Sql = """
                SELECT a.code, a.name, a.commission_rate,
                       COALESCE(sum(l.amount) FILTER (WHERE l.amount > 0), 0) AS charges, COALESCE(-sum(l.amount) FILTER (WHERE l.amount < 0), 0) AS credits,
                       COALESCE(sum(l.amount), 0) AS balance
                FROM pms.agencies a JOIN pms.folios f ON f.agency_id = a.id AND f.reservation_id IS NULL LEFT JOIN pms.folio_lines l ON l.folio_id = f.id
                GROUP BY a.id ORDER BY balance DESC
                """,
        },
        new()
        {
            Name = "production", Title = "Şirket/Acente Üretimi (Gece ve Gelir)", Category = "Gelir", Permission = "financial_report.view", Params = [From, To],
            Columns = [new("kind", "Tür", "text"), new("name", "Ad", "text"), new("reservations", "Rezervasyon", "int"), new("roomNights", "Oda-Gece", "int"),
                new("roomRevenue", "Oda Geliri (OTB+Gerçekleşen)", "money")],
            SumColumns = ["reservations", "roomNights", "roomRevenue"],
            Sql = """
                SELECT CASE WHEN r.agency_id IS NOT NULL THEN 'Acente' WHEN r.company_id IS NOT NULL THEN 'Şirket' ELSE 'Bireysel' END AS kind,
                       COALESCE(a.name, c.name, 'Bireysel') AS name, count(DISTINCT r.id)::int AS reservations, count(rr.stay_date)::int AS room_nights,
                       COALESCE(sum(rr.rate), 0) AS room_revenue
                FROM pms.reservations r JOIN pms.reservation_rates rr ON rr.reservation_id = r.id AND rr.stay_date BETWEEN @from AND @to
                LEFT JOIN pms.companies c ON c.id = r.company_id LEFT JOIN pms.agencies a ON a.id = r.agency_id
                WHERE r.status IN ('tentative','confirmed','checked_in','checked_out')
                GROUP BY 1, 2 ORDER BY room_revenue DESC
                """,
        },
        new()
        {
            Name = "guest-history", Title = "Misafir Konaklama Geçmişi", Category = "Misafir", Permission = "report.view", Params = [From, To],
            Columns = [new("guestName", "Misafir", "text"), new("nationality", "Uyruk", "text"), new("stays", "Konaklama", "int"), new("nights", "Gece", "int"),
                new("lastArrival", "Son Giriş", "date"), new("vip", "VIP", "bool")],
            Sql = """
                SELECT g.first_name || ' ' || g.last_name AS guest_name, g.nationality::text AS nationality, count(*)::int AS stays,
                       sum(r.departure - r.arrival)::int AS nights, max(r.arrival) AS last_arrival, g.is_vip AS vip
                FROM pms.reservations r JOIN pms.guests g ON g.id = r.guest_id
                WHERE r.status IN ('checked_in','checked_out') AND r.arrival BETWEEN @from AND @to
                GROUP BY g.id ORDER BY stays DESC, nights DESC LIMIT 5000
                """,
        },
        new()
        {
            Name = "nationality", Title = "Uyruğa Göre Konaklama", Category = "Misafir", Permission = "report.view", Params = [From, To],
            Columns = [new("nationality", "Uyruk", "text"), new("guests", "Misafir", "int"), new("roomNights", "Oda-Gece", "int")],
            SumColumns = ["guests", "roomNights"],
            Sql = """
                SELECT COALESCE(g.nationality::text, 'Bilinmiyor') AS nationality, count(DISTINCT g.id)::int AS guests, sum(r.departure - r.arrival)::int AS room_nights
                FROM pms.reservations r JOIN pms.guests g ON g.id = r.guest_id
                WHERE r.status IN ('checked_in','checked_out') AND r.arrival BETWEEN @from AND @to GROUP BY 1 ORDER BY room_nights DESC
                """,
        },
        new()
        {
            Name = "night-audit", Title = "Gece Denetimi Geçmişi", Category = "Gelir", Permission = "financial_report.view", Params = [From, To],
            Columns = [new("businessDate", "İş Günü", "date"), new("roomsSold", "Satılan", "int"), new("occupancyPct", "Doluluk %", "decimal"),
                new("roomRevenue", "Oda Geliri", "money"), new("otherRevenue", "Diğer Gelir", "money"), new("payments", "Tahsilat", "money"),
                new("adr", "ADR", "money"), new("revpar", "RevPAR", "money"), new("arrivals", "Geliş", "int"), new("departures", "Çıkış", "int"),
                new("noShows", "No-show", "int"), new("cancellations", "İptal", "int")],
            SumColumns = ["roomsSold", "roomRevenue", "otherRevenue", "payments"],
            Sql = """
                SELECT business_date, rooms_sold, occupancy_pct, room_revenue, other_revenue, payments, adr, revpar, arrivals, departures, no_shows, cancellations
                FROM pms.daily_statistics WHERE business_date BETWEEN @from AND @to ORDER BY business_date
                """,
        },
        new()
        {
            Name = "audit-log", Title = "Denetim Kayıtları", Category = "Sistem", Permission = "audit.view", Params = [From, To],
            Columns = [new("at", "Zaman", "datetime"), new("username", "Kullanıcı", "text"), new("hostname", "Cihaz", "text"), new("ip", "IP", "text"),
                new("action", "İşlem", "text"), new("entityType", "Kayıt Türü", "text"), new("entityId", "Kayıt", "text"), new("reason", "Gerekçe", "text")],
            Sql = """
                SELECT at, username, hostname, host(ip) AS ip, action, entity_type, entity_id, reason FROM pms.audit_log
                WHERE at >= @from::date AND at < @to::date + 1 ORDER BY at DESC LIMIT 20000
                """,
        },
        new()
        {
            Name = "migration", Title = "Veri Aktarım Raporu", Category = "Sistem", Permission = "migration.manage", Params = [From, To],
            Columns = [new("jobNo", "No", "int"), new("createdAt", "Tarih", "datetime"), new("entity", "Veri", "text"), new("sourceType", "Kaynak Türü", "text"),
                new("sourceLabel", "Kaynak", "text"), new("status", "Durum", "text"), new("totalRows", "Toplam", "int"), new("importedRows", "Aktarılan", "int"),
                new("updatedRows", "Güncellenen", "int"), new("skippedRows", "Atlanan", "int"), new("failedRows", "Hatalı", "int"), new("reviewRows", "İncelenmeli", "int")],
            SumColumns = ["totalRows", "importedRows", "updatedRows", "skippedRows", "failedRows"],
            Sql = """
                SELECT job_no, created_at, entity, source_type, source_label, status, total_rows, imported_rows, updated_rows, skipped_rows, failed_rows, review_rows
                FROM pms.import_jobs WHERE created_at >= @from::date AND created_at < @to::date + 1 ORDER BY created_at DESC
                """,
        },

        new()
        {
            Name = "stock_balance", Title = "Stok Durumu", Category = "Stok", Permission = "stock.view",
            Columns = [new("warehouse", "Depo", "text"), new("itemCode", "Kod", "text"), new("itemName", "Stok", "text"), new("category", "Kategori", "text"),
                new("unit", "Birim", "text"), new("quantity", "Miktar", "decimal"), new("avgCost", "Ort. Maliyet", "money"), new("value", "Tutar", "money"),
                new("minQty", "Asgari", "decimal"), new("status", "Durum", "text")],
            SumColumns = ["value"],
            Sql = """
                SELECT w.name AS warehouse, i.code AS item_code, i.name AS item_name, i.category, i.unit, b.quantity, b.avg_cost,
                       round(GREATEST(b.quantity, 0) * b.avg_cost, 2) AS value, i.min_qty,
                       CASE WHEN b.quantity < 0 THEN 'Eksi stok' WHEN i.min_qty IS NOT NULL AND b.quantity < i.min_qty THEN 'Kritik' ELSE '' END AS status
                FROM pms.stock_balances b JOIN pms.warehouses w ON w.id = b.warehouse_id JOIN pms.stock_items i ON i.id = b.item_id
                WHERE b.quantity <> 0 OR i.min_qty IS NOT NULL
                ORDER BY w.code, i.category NULLS LAST, i.name
                """,
        },
        new()
        {
            Name = "stock_movements", Title = "Stok Hareketleri", Category = "Stok", Permission = "stock.view", Params = [From, To],
            Columns = [new("date", "Tarih", "date"), new("docNo", "Belge", "text"), new("kind", "Tür", "text"), new("warehouse", "Depo", "text"),
                new("itemName", "Stok", "text"), new("unit", "Birim", "text"), new("quantity", "Miktar", "decimal"), new("unitCost", "Birim Maliyet", "money"),
                new("amount", "Tutar", "money"), new("party", "Tedarikçi / Bölüm", "text"), new("username", "Kullanıcı", "text"), new("note", "Not", "text")],
            Sql = """
                SELECT m.business_date AS date, d.doc_no, CASE d.kind WHEN 'receipt' THEN 'Mal kabul' WHEN 'issue' THEN 'Çıkış' WHEN 'transfer' THEN 'Transfer' WHEN 'count' THEN 'Sayım' WHEN 'pos' THEN 'Satış tüketimi' END AS kind, w.name AS warehouse, i.name AS item_name, i.unit, m.quantity, m.unit_cost,
                       round(m.quantity * m.unit_cost, 2) AS amount, COALESCE(s.name, d.department, tw.name) AS party, u.username,
                       CASE WHEN m.is_reversal THEN 'İptal: ' || COALESCE(d.cancel_reason, '') END AS note
                FROM pms.stock_movements m JOIN pms.stock_documents d ON d.id = m.document_id JOIN pms.warehouses w ON w.id = m.warehouse_id
                JOIN pms.stock_items i ON i.id = m.item_id LEFT JOIN pms.suppliers s ON s.id = d.supplier_id
                LEFT JOIN pms.warehouses tw ON tw.id = d.target_warehouse_id LEFT JOIN pms.users u ON u.id = m.created_by
                WHERE m.business_date BETWEEN @from AND @to
                ORDER BY m.created_at
                """,
        },
        new()
        {
            Name = "stock_purchases", Title = "Alımlar (Mal Kabul)", Category = "Stok", Permission = "stock.view", Params = [From, To],
            Columns = [new("date", "Tarih", "date"), new("docNo", "Belge", "text"), new("supplier", "Tedarikçi", "text"), new("invoiceNo", "Fatura No", "text"),
                new("orderNo", "Sipariş", "text"), new("warehouse", "Depo", "text"), new("itemName", "Stok", "text"), new("quantity", "Miktar", "decimal"),
                new("unitCost", "Birim Maliyet", "money"), new("amount", "Tutar (KDV hariç)", "money")],
            SumColumns = ["amount"],
            Sql = """
                SELECT d.business_date AS date, d.doc_no, s.name AS supplier, d.invoice_no, po.order_no, w.name AS warehouse, i.name AS item_name,
                       m.quantity, m.unit_cost, round(m.quantity * m.unit_cost, 2) AS amount
                FROM pms.stock_documents d JOIN pms.stock_movements m ON m.document_id = d.id AND NOT m.is_reversal
                JOIN pms.suppliers s ON s.id = d.supplier_id JOIN pms.warehouses w ON w.id = d.warehouse_id JOIN pms.stock_items i ON i.id = m.item_id
                LEFT JOIN pms.purchase_orders po ON po.id = d.purchase_order_id
                WHERE d.kind = 'receipt' AND NOT d.is_cancelled AND d.business_date BETWEEN @from AND @to
                ORDER BY d.business_date, d.doc_no, i.name
                """,
        },
        new()
        {
            Name = "stock_consumption", Title = "Tüketim Özeti (çıkış ve satış)", Category = "Stok", Permission = "stock.view", Params = [From, To],
            Columns = [new("itemCode", "Kod", "text"), new("itemName", "Stok", "text"), new("unit", "Birim", "text"), new("issued", "Bölüm Çıkışı", "decimal"),
                new("sold", "Satış Tüketimi", "decimal"), new("countDiff", "Sayım Farkı", "decimal"), new("cost", "Maliyet", "money")],
            SumColumns = ["cost"],
            Sql = """
                SELECT i.code AS item_code, i.name AS item_name, i.unit,
                       COALESCE(-sum(m.quantity) FILTER (WHERE d.kind = 'issue'), 0) AS issued,
                       COALESCE(-sum(m.quantity) FILTER (WHERE d.kind = 'pos'), 0) AS sold,
                       COALESCE(sum(m.quantity) FILTER (WHERE d.kind = 'count'), 0) AS count_diff,
                       round(COALESCE(-sum(m.quantity * m.unit_cost) FILTER (WHERE d.kind IN ('issue', 'pos', 'count')), 0), 2) AS cost
                FROM pms.stock_movements m JOIN pms.stock_documents d ON d.id = m.document_id JOIN pms.stock_items i ON i.id = m.item_id
                WHERE m.business_date BETWEEN @from AND @to AND d.kind IN ('issue', 'pos', 'count')
                GROUP BY i.id ORDER BY cost DESC
                """,
        },
        new()
        {
            Name = "pos_sales", Title = "Restoran Satışları (gün ve satış noktası)", Category = "Restoran", Permission = "pos.view", Params = [From, To],
            Columns = [new("date", "Tarih", "date"), new("outlet", "Satış Noktası", "text"), new("checks", "Adisyon", "int"), new("covers", "Kişi", "int"),
                new("gross", "Brüt", "money"), new("discount", "İndirim", "money"), new("net", "Net", "money"), new("toRoom", "Odaya", "money"),
                new("paid", "Ödenen", "money"), new("complimentary", "İkram (brüt)", "money")],
            SumColumns = ["checks", "covers", "gross", "discount", "net", "toRoom", "paid", "complimentary"],
            Sql = """
                SELECT c.closed_business_date AS date, o.name AS outlet, count(*)::int AS checks, sum(c.covers)::int AS covers,
                       sum(c.total_amount + c.discount_amount) AS gross, sum(c.discount_amount) AS discount, sum(c.total_amount) AS net,
                       COALESCE(sum(c.total_amount) FILTER (WHERE c.settlement = 'room'), 0) AS to_room,
                       COALESCE(sum(c.total_amount) FILTER (WHERE c.settlement = 'payment'), 0) AS paid,
                       COALESCE(sum(c.discount_amount) FILTER (WHERE c.settlement = 'complimentary'), 0) AS complimentary
                FROM pms.pos_checks c JOIN pms.pos_outlets o ON o.id = c.outlet_id
                WHERE c.status = 'closed' AND c.closed_business_date BETWEEN @from AND @to
                GROUP BY c.closed_business_date, o.name ORDER BY 1, 2
                """,
        },
        new()
        {
            Name = "pos_products", Title = "Ürün Satışları", Category = "Restoran", Permission = "pos.view", Params = [From, To],
            Columns = [new("outlet", "Satış Noktası", "text"), new("category", "Kategori", "text"), new("product", "Ürün", "text"),
                new("quantity", "Adet", "decimal"), new("amount", "Tutar (indirim öncesi)", "money")],
            SumColumns = ["amount"],
            Sql = """
                SELECT o.name AS outlet, p.category, l.name AS product, sum(l.quantity) AS quantity, sum(l.amount) AS amount
                FROM pms.pos_check_lines l JOIN pms.pos_checks c ON c.id = l.check_id JOIN pms.pos_outlets o ON o.id = c.outlet_id
                JOIN pms.pos_products p ON p.id = l.product_id
                WHERE NOT l.is_void AND c.status = 'closed' AND c.closed_business_date BETWEEN @from AND @to
                GROUP BY o.name, p.category, l.name ORDER BY o.name, amount DESC
                """,
        },
        new()
        {
            Name = "pos_checks", Title = "Adisyon Listesi", Category = "Restoran", Permission = "pos.view", Params = [From, To],
            Columns = [new("checkNo", "No", "int"), new("outlet", "Satış Noktası", "text"), new("tableLabel", "Masa", "text"), new("openedAt", "Açılış", "datetime"),
                new("closedAt", "Kapanış", "datetime"), new("status", "Durum", "text"), new("settlement", "Kapanış Türü", "text"), new("room", "Oda", "text"),
                new("discount", "İndirim", "money"), new("total", "Tutar", "money"), new("username", "Kapatan", "text"), new("reason", "Gerekçe", "text")],
            SumColumns = ["total"],
            Sql = """
                SELECT c.check_no, o.name AS outlet, c.table_label, c.opened_at, c.closed_at,
                       CASE c.status WHEN 'open' THEN 'Açık' WHEN 'closed' THEN 'Kapalı' ELSE 'İptal' END AS status,
                       CASE c.settlement WHEN 'room' THEN 'Odaya' WHEN 'payment' THEN 'Ödeme' WHEN 'complimentary' THEN 'İkram' END AS settlement,
                       rm.number AS room, c.discount_amount AS discount, CASE WHEN c.status = 'closed' THEN c.total_amount ELSE 0 END AS total,
                       u.username, COALESCE(c.cancel_reason, c.discount_reason) AS reason
                FROM pms.pos_checks c JOIN pms.pos_outlets o ON o.id = c.outlet_id
                LEFT JOIN pms.reservations r ON r.id = c.reservation_id LEFT JOIN pms.rooms rm ON rm.id = r.room_id LEFT JOIN pms.users u ON u.id = c.closed_by
                WHERE COALESCE(c.closed_business_date, c.business_date) BETWEEN @from AND @to
                ORDER BY c.check_no
                """,
        },
        new()
        {
            Name = "pos_voids", Title = "Ürün İptalleri", Category = "Restoran", Permission = "pos.view", Params = [From, To],
            Columns = [new("checkNo", "Adisyon", "int"), new("outlet", "Satış Noktası", "text"), new("product", "Ürün", "text"), new("quantity", "Adet", "decimal"),
                new("amount", "Tutar", "money"), new("addedBy", "Ekleyen", "text"), new("voidedBy", "İptal Eden", "text"), new("voidedAt", "Zaman", "datetime"),
                new("reason", "Gerekçe", "text")],
            SumColumns = ["amount"],
            Sql = """
                SELECT c.check_no, o.name AS outlet, l.name AS product, l.quantity, l.amount, au.username AS added_by, vu.username AS voided_by, l.voided_at,
                       l.void_reason AS reason
                FROM pms.pos_check_lines l JOIN pms.pos_checks c ON c.id = l.check_id JOIN pms.pos_outlets o ON o.id = c.outlet_id
                LEFT JOIN pms.users au ON au.id = l.added_by LEFT JOIN pms.users vu ON vu.id = l.voided_by
                WHERE l.is_void AND c.business_date BETWEEN @from AND @to
                ORDER BY l.voided_at
                """,
        },
        new()
        {
            Name = "allotment_usage", Title = "Acente Kontenjan Kullanımı", Category = "Satış", Permission = "reservation.view", Params = [From, To],
            Columns = [new("date", "Gece", "date"), new("agency", "Acente", "text"), new("roomType", "Oda Tipi", "text"), new("rooms", "Kontenjan", "int"),
                new("used", "Kullanılan", "int"), new("remaining", "Kalan", "int"), new("releaseDate", "Release", "date"), new("released", "Serbest", "bool")],
            SumColumns = ["rooms", "used", "remaining"],
            Sql = """
                SELECT d::date AS date, ag.name AS agency, t.code AS room_type, a.rooms,
                       LEAST(a.rooms, u.cnt)::int AS used, GREATEST(a.rooms - u.cnt, 0)::int AS remaining,
                       (d::date - a.release_days) AS release_date, (SELECT business_date FROM pms.property LIMIT 1) >= d::date - a.release_days AS released
                FROM pms.allotments a JOIN pms.agencies ag ON ag.id = a.agency_id JOIN pms.room_types t ON t.id = a.room_type_id
                CROSS JOIN LATERAL generate_series(GREATEST(a.date_from, @from::date), LEAST(a.date_to - 1, @to::date), interval '1 day') d
                CROSS JOIN LATERAL (SELECT count(*)::int AS cnt FROM pms.reservations x WHERE x.agency_id = a.agency_id AND x.room_type_id = a.room_type_id
                    AND x.status IN ('tentative','confirmed','checked_in','checked_out') AND x.arrival <= d::date AND x.departure > d::date) u
                WHERE a.is_active
                ORDER BY 1, ag.name, t.code
                """,
        },

        new()
        {
            Name = "trial_balance", Title = "Mizan", Category = "Muhasebe", Permission = "accounting.view", Params = [From, To],
            Columns = [new("code", "Hesap", "text"), new("name", "Hesap adı", "text"), new("openingDebit", "Devir Borç", "money"), new("openingCredit", "Devir Alacak", "money"),
                new("debit", "Dönem Borç", "money"), new("credit", "Dönem Alacak", "money"), new("balanceDebit", "Borç Bakiye", "money"), new("balanceCredit", "Alacak Bakiye", "money")],
            SumColumns = ["debit", "credit", "balanceDebit", "balanceCredit"],
            Sql = """
                WITH x AS (
                    SELECT l.account_code AS code,
                           COALESCE(sum(l.debit) FILTER (WHERE e.entry_date < @from), 0) AS od, COALESCE(sum(l.credit) FILTER (WHERE e.entry_date < @from), 0) AS oc,
                           COALESCE(sum(l.debit) FILTER (WHERE e.entry_date BETWEEN @from AND @to), 0) AS d, COALESCE(sum(l.credit) FILTER (WHERE e.entry_date BETWEEN @from AND @to), 0) AS c
                    FROM pms.gl_lines l JOIN pms.gl_entries e ON e.id = l.entry_id WHERE e.entry_date <= @to GROUP BY l.account_code)
                SELECT x.code, a.name, x.od AS opening_debit, x.oc AS opening_credit, x.d AS debit, x.c AS credit,
                       GREATEST(x.od + x.d - x.oc - x.c, 0) AS balance_debit, GREATEST(x.oc + x.c - x.od - x.d, 0) AS balance_credit
                FROM x JOIN pms.gl_accounts a ON a.code = x.code
                ORDER BY x.code
                """,
        },
        new()
        {
            Name = "trial_balance_main", Title = "Mizan (ana hesaplar)", Category = "Muhasebe", Permission = "accounting.view", Params = [From, To],
            Columns = [new("code", "Hesap", "text"), new("name", "Hesap adı", "text"), new("debit", "Dönem Borç", "money"), new("credit", "Dönem Alacak", "money"),
                new("balanceDebit", "Borç Bakiye", "money"), new("balanceCredit", "Alacak Bakiye", "money")],
            SumColumns = ["debit", "credit", "balanceDebit", "balanceCredit"],
            Sql = """
                WITH x AS (
                    SELECT split_part(l.account_code, '.', 1) AS code,
                           COALESCE(sum(l.debit) FILTER (WHERE e.entry_date BETWEEN @from AND @to), 0) AS d, COALESCE(sum(l.credit) FILTER (WHERE e.entry_date BETWEEN @from AND @to), 0) AS c,
                           COALESCE(sum(l.debit), 0) - COALESCE(sum(l.credit), 0) AS bal
                    FROM pms.gl_lines l JOIN pms.gl_entries e ON e.id = l.entry_id WHERE e.entry_date <= @to GROUP BY 1)
                SELECT x.code, a.name, x.d AS debit, x.c AS credit, GREATEST(x.bal, 0) AS balance_debit, GREATEST(-x.bal, 0) AS balance_credit
                FROM x LEFT JOIN pms.gl_accounts a ON a.code = x.code ORDER BY x.code
                """,
        },
        new()
        {
            Name = "journal", Title = "Yevmiye Dökümü", Category = "Muhasebe", Permission = "accounting.view", Params = [From, To],
            Columns = [new("entryNo", "Fiş", "int"), new("date", "Tarih", "date"), new("entryDescription", "Fiş açıklaması", "text"), new("code", "Hesap", "text"),
                new("name", "Hesap adı", "text"), new("description", "Satır açıklaması", "text"), new("debit", "Borç", "money"), new("credit", "Alacak", "money")],
            SumColumns = ["debit", "credit"],
            Sql = """
                SELECT e.entry_no, e.entry_date AS date, e.description AS entry_description, l.account_code AS code, a.name, l.description, l.debit, l.credit
                FROM pms.gl_entries e JOIN pms.gl_lines l ON l.entry_id = e.id JOIN pms.gl_accounts a ON a.code = l.account_code
                WHERE e.entry_date BETWEEN @from AND @to
                ORDER BY e.entry_date, e.entry_no, l.line_no
                """,
        },
        new()
        {
            Name = "account_statement", Title = "Hesap Ekstresi (Muavin)", Category = "Muhasebe", Permission = "accounting.view",
            Params = [From, To, new("account", "Hesap kodu", "text", true)],
            Columns = [new("date", "Tarih", "date"), new("entryNo", "Fiş", "int"), new("code", "Hesap", "text"), new("description", "Açıklama", "text"),
                new("debit", "Borç", "money"), new("credit", "Alacak", "money"), new("balance", "Bakiye (B−A)", "money")],
            SumColumns = ["debit", "credit"],
            Sql = """
                WITH sel AS (SELECT code FROM pms.gl_accounts WHERE code = @account OR code LIKE @account || '.%'),
                opening AS (
                    SELECT COALESCE(sum(l.debit - l.credit), 0) AS bal FROM pms.gl_lines l JOIN pms.gl_entries e ON e.id = l.entry_id
                    WHERE l.account_code IN (SELECT code FROM sel) AND e.entry_date < @from),
                rows AS (
                    SELECT e.entry_date AS date, e.entry_no, l.account_code AS code, COALESCE(l.description, e.description) AS description, l.debit, l.credit, l.line_no
                    FROM pms.gl_lines l JOIN pms.gl_entries e ON e.id = l.entry_id
                    WHERE l.account_code IN (SELECT code FROM sel) AND e.entry_date BETWEEN @from AND @to)
                SELECT @from::date AS date, NULL::bigint AS entry_no, @account AS code, 'Devir' AS description, 0::numeric AS debit, 0::numeric AS credit,
                       (SELECT bal FROM opening) AS balance
                UNION ALL
                SELECT r.date, r.entry_no, r.code, r.description, r.debit, r.credit,
                       (SELECT bal FROM opening) + sum(r.debit - r.credit) OVER (ORDER BY r.date, r.entry_no, r.line_no) AS balance
                FROM rows r
                ORDER BY 1, 2 NULLS FIRST
                """,
        },
    ];

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/reports").WithTags("Reports");

        g.MapGet("/", (RequestContext ctx) => Definitions.Where(d => ctx.RequireUser().Has(d.Permission))
            .Select(d => new ReportInfo(d.Name, d.Title, d.Category, d.Params, d.Columns)).ToList());

        g.MapGet("/{name}", async (string name, HttpRequest req, Db db, RequestContext ctx) => await RunAsync(Find(name, ctx), req.Query, db));

        g.MapGet("/{name}/export", async (string name, string format, HttpRequest req, Db db, RequestContext ctx) =>
        {
            var def = Find(name, ctx);
            var result = await RunAsync(def, req.Query, db);
            var stamp = DateTime.Now.ToString("yyyyMMdd-HHmm");
            await using (var c = await db.OpenAsync())
                await c.ExecuteAsync("INSERT INTO pms.audit_log (user_id, username, device_id, ip, action, entity_type, entity_id) VALUES (@u, @n, @d, @ip::inet, 'report.export', 'report', @name)",
                    new { u = ctx.User!.Id, n = ctx.User.Username, d = ctx.DeviceId, ip = ctx.Ip?.ToString(), name = $"{name}.{format}" });
            return format switch
            {
                "csv" => Results.File(ToCsv(result), "text/csv; charset=utf-8", $"{name}-{stamp}.csv"),
                "xlsx" => Results.File(ToXlsx(result), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"{name}-{stamp}.xlsx"),
                _ => throw PmsException.Validation("Desteklenen biçimler: csv, xlsx. PDF için rapor ekranındaki Yazdır/PDF seçeneğini kullanın."),
            };
        });

        app.MapGet("/api/v1/dashboard", (CommandRunner cmd) => cmd.ReadAsync(DashboardAsync)).WithTags("Reports").RequirePermission("dashboard.view");

        app.MapGet("/api/v1/audit-logs", (Db db, string? q, string? entityType, string? entityId, Guid? userId, DateOnly? from, DateOnly? to, int page = 1, int pageSize = 100) =>
        {
            var p = new PageRequest(page, pageSize);
            return db.QueryAsync<AuditLogDto>("""
                SELECT id, at, username, hostname, host(ip) AS ip, action, entity_type, entity_id, old_value::text AS old_value, new_value::text AS new_value, reason
                FROM pms.audit_log
                WHERE (@q::text IS NULL OR action ILIKE '%' || @q || '%' OR username ILIKE @q || '%' OR entity_id = @q)
                  AND (@entityType::text IS NULL OR entity_type = @entityType) AND (@entityId::text IS NULL OR entity_id = @entityId)
                  AND (@userId::uuid IS NULL OR user_id = @userId)
                  AND (@from::date IS NULL OR at >= @from::date) AND (@to::date IS NULL OR at < @to::date + 1)
                ORDER BY id DESC LIMIT @Limit OFFSET @Offset
                """, new { q = string.IsNullOrWhiteSpace(q) ? null : q.Trim(), entityType, entityId, userId, from, to, p.Limit, p.Offset });
        }).WithTags("Reports").RequirePermission("audit.view");
    }

    static ReportDefinition Find(string name, RequestContext ctx)
    {
        var def = Definitions.FirstOrDefault(d => d.Name == name) ?? throw PmsException.NotFound("Rapor");
        if (!ctx.RequireUser().Has(def.Permission)) throw PmsException.Forbidden();
        return def;
    }

    public static async Task<ReportResult> RunAsync(ReportDefinition def, IQueryCollection query, Db db)
    {
        var prm = new DynamicParameters();
        var bd = await db.ScalarAsync<DateOnly>("SELECT business_date FROM pms.property LIMIT 1");
        foreach (var p in def.Params)
        {
            var raw = query[p.Key].ToString();
            if (string.IsNullOrWhiteSpace(raw))
            {
                if (p.Required && p.Type == "date") prm.Add(p.Key, p.Key == "from" ? bd.AddDays(-30) : bd);
                else prm.Add(p.Key, null, global::System.Data.DbType.Date);
                continue;
            }
            if (p.Type == "date")
            {
                if (!DateOnly.TryParseExact(raw, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d))
                    throw PmsException.Validation($"{p.Label} tarihi geçersiz.");
                prm.Add(p.Key, d);
            }
            else prm.Add(p.Key, raw);
        }
        if (def.Params.Any(p => p.Key == "from") && prm.Get<DateOnly>("from") is var f && prm.Get<DateOnly>("to") is var t && (t < f || t.DayNumber - f.DayNumber > 3660))
            throw PmsException.Validation("Tarih aralığı geçersiz (en fazla 10 yıl).");

        await using var c = await db.OpenAsync();
        var raws = await c.QueryAsync(new CommandDefinition(def.Sql, prm, commandTimeout: 120));
        var rows = new List<IDictionary<string, object?>>();
        foreach (IDictionary<string, object?> r in raws)
        {
            var row = new Dictionary<string, object?>();
            foreach (var col in def.Columns)
            {
                var snake = global::System.Text.RegularExpressions.Regex.Replace(col.Key, "([a-z0-9])([A-Z])", "$1_$2").ToLowerInvariant();
                r.TryGetValue(snake, out var v);
                row[col.Key] = v switch
                {
                    DateTime dt when col.Type == "date" => DateOnly.FromDateTime(dt),
                    long l when col.Type == "int" => (int)l,
                    _ => v,
                };
            }
            rows.Add(row);
        }
        var totals = new Dictionary<string, object?>();
        foreach (var key in def.SumColumns)
        {
            var col = def.Columns.First(cc => cc.Key == key);
            totals[key] = col.Type == "int"
                ? rows.Sum(r => Convert.ToInt64(r[key] ?? 0L))
                : (object)rows.Sum(r => r[key] is null ? 0m : Convert.ToDecimal(r[key], CultureInfo.InvariantCulture));
        }
        return new ReportResult(def.Name, def.Title, def.Columns, rows, totals, DateTime.UtcNow, bd);
    }

    static string Format(object? v, string type) => v switch
    {
        null => "",
        decimal d => d.ToString(type == "money" ? "0.00" : "0.##", CultureInfo.InvariantCulture),
        DateOnly d => d.ToString("yyyy-MM-dd"),
        DateTime dt => dt.ToLocalTime().ToString("yyyy-MM-dd HH:mm"),
        bool b => b ? "Evet" : "Hayır",
        _ => Convert.ToString(v, CultureInfo.InvariantCulture) ?? "",
    };

    static byte[] ToCsv(ReportResult r)
    {
        // Türkiye'deki Excel varsayılanıyla uyumlu: noktalı virgül ayırıcı, UTF-8 BOM.
        var sb = new StringBuilder();
        static string Esc(string s) => s.Contains(';') || s.Contains('"') || s.Contains('\n') ? "\"" + s.Replace("\"", "\"\"") + "\"" : s;
        sb.AppendLine(string.Join(';', r.Columns.Select(c => Esc(c.Header))));
        foreach (var row in r.Rows) sb.AppendLine(string.Join(';', r.Columns.Select(c => Esc(Format(row[c.Key], c.Type)))));
        return [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(sb.ToString())];
    }

    static byte[] ToXlsx(ReportResult r)
    {
        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add(r.Title.Length > 31 ? r.Title[..31] : r.Title);
        for (var i = 0; i < r.Columns.Count; i++)
        {
            ws.Cell(1, i + 1).Value = r.Columns[i].Header;
            ws.Cell(1, i + 1).Style.Font.Bold = true;
        }
        var rowNo = 2;
        foreach (var row in r.Rows)
        {
            for (var i = 0; i < r.Columns.Count; i++)
            {
                var col = r.Columns[i];
                var cell = ws.Cell(rowNo, i + 1);
                switch (row[col.Key])
                {
                    case null: break;
                    case decimal d:
                        cell.Value = d;
                        cell.Style.NumberFormat.Format = col.Type == "money" ? "#,##0.00" : "0.##";
                        break;
                    case int n: cell.Value = n; break;
                    case long n: cell.Value = n; break;
                    case DateOnly d: cell.Value = d.ToDateTime(TimeOnly.MinValue); cell.Style.DateFormat.Format = "dd.MM.yyyy"; break;
                    case DateTime dt: cell.Value = dt.ToLocalTime(); cell.Style.DateFormat.Format = "dd.MM.yyyy HH:mm"; break;
                    case bool b: cell.Value = b ? "Evet" : "Hayır"; break;
                    default: cell.Value = Convert.ToString(row[col.Key], CultureInfo.InvariantCulture); break;
                }
            }
            rowNo++;
        }
        ws.SheetView.FreezeRows(1);
        ws.Columns().AdjustToContents(1, Math.Min(rowNo, 500));
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    static async Task<DashboardDto> DashboardAsync(Tx tx)
    {
        var p = await tx.OneAsync<(DateOnly Bd, string Name, string Currency)>("SELECT business_date, name, currency::text FROM pms.property LIMIT 1");
        var bd = p.Bd;
        var d = await tx.OneAsync<DashRow>("""
            SELECT (SELECT count(*)::int FROM pms.rooms WHERE is_active) AS rooms_total,
                   (SELECT count(*)::int FROM pms.reservations WHERE status = 'checked_in') AS occupied,
                   (SELECT count(*)::int FROM pms.rooms r WHERE r.is_active AND r.hk_status IN ('clean','inspected')
                      AND NOT EXISTS (SELECT 1 FROM pms.reservations x WHERE x.room_id = r.id AND x.status = 'checked_in')) AS vacant_clean,
                   (SELECT count(*)::int FROM pms.rooms r WHERE r.is_active AND r.hk_status IN ('dirty','cleaning')
                      AND NOT EXISTS (SELECT 1 FROM pms.reservations x WHERE x.room_id = r.id AND x.status = 'checked_in')) AS vacant_dirty,
                   (SELECT count(DISTINCT room_id)::int FROM pms.room_blocks WHERE is_active AND date_from <= @bd AND date_to > @bd) AS out_of_order,
                   (SELECT count(*)::int FROM pms.reservations WHERE arrival = @bd AND status IN ('tentative','confirmed')) AS arrivals_expected,
                   (SELECT count(*)::int FROM pms.reservations WHERE arrival = @bd AND status IN ('checked_in','checked_out')) AS arrivals_checked_in,
                   (SELECT count(*)::int FROM pms.reservations WHERE departure <= @bd AND status = 'checked_in') AS departures_expected,
                   (SELECT count(*)::int FROM pms.reservations WHERE departure = @bd AND status = 'checked_out') AS departures_checked_out,
                   (SELECT COALESCE(sum(adults + children), 0)::int FROM pms.reservations WHERE status = 'checked_in') AS guests_in_house,
                   (SELECT COALESCE(sum(amount), 0) FROM pms.folio_lines l LEFT JOIN pms.transaction_codes tc ON tc.id = l.transaction_code_id
                      WHERE l.business_date = @bd AND l.line_type IN ('charge','discount','allowance','void') AND l.payment_method_id IS NULL
                        AND (l.is_room_charge OR tc.category = 'room')) AS room_revenue_today,
                   (SELECT COALESCE(sum(l.amount), 0) FROM pms.folio_lines l
                      LEFT JOIN pms.folio_lines o ON o.id = l.related_line_id
                      JOIN pms.transaction_codes tc ON tc.id = CASE WHEN l.line_type = 'void' THEN o.transaction_code_id ELSE l.transaction_code_id END
                      WHERE l.business_date = @bd AND tc.category NOT IN ('room', 'tax')
                        AND ((l.line_type = 'charge' AND NOT l.is_room_charge) OR (l.line_type = 'void' AND o.line_type = 'charge' AND NOT o.is_room_charge)))
                    + (SELECT COALESCE(sum(c.total_amount), 0) FROM pms.pos_checks c
                        WHERE c.status = 'closed' AND c.settlement = 'payment' AND c.closed_business_date = @bd) AS other_revenue_today,
                   (SELECT COALESCE(-sum(l.amount), 0) FROM pms.folio_lines l JOIN pms.payment_methods pm ON pm.id = l.payment_method_id
                      WHERE l.business_date = @bd AND pm.kind NOT IN ('city_ledger','company','agency'))
                    + (SELECT COALESCE(sum(p.amount), 0) FROM pms.pos_payments p WHERE p.business_date = @bd) AS payments_today,
                   (SELECT COALESCE(sum(l.amount), 0) FROM pms.folio_lines l JOIN pms.folios f ON f.id = l.folio_id WHERE f.status = 'open') AS open_balance,
                   (SELECT count(*)::int FROM pms.maintenance_tickets WHERE status IN ('open','in_progress')) AS open_tickets,
                   (SELECT count(*)::int FROM pms.hk_tasks WHERE status IN ('open','in_progress')) AS open_hk_tasks,
                   (SELECT count(*)::int FROM pms.identity_reports WHERE status IN ('needs_data','blocked_configuration','rejected','outcome_unknown','manual_action_required','retry_scheduled')) AS kbs_pending,
                   (SELECT count(*)::int FROM pms.wakeup_calls WHERE status = 'pending') AS pending_wakeups,
                   (SELECT max(business_date) FROM pms.night_audits) AS last_night_audit
            """, new { bd });
        var forecast = await tx.ListAsync<ForecastDay>("""
            WITH days AS (SELECT d::date AS d FROM generate_series(@bd::date, @bd::date + 6, interval '1 day') d)
            SELECT days.d AS date,
                   (SELECT count(*)::int FROM pms.reservations r WHERE r.status IN ('tentative','confirmed','checked_in') AND r.arrival <= days.d AND r.departure > days.d) AS sold,
                   ((SELECT count(*) FROM pms.rooms WHERE is_active) - (SELECT count(DISTINCT room_id) FROM pms.room_blocks WHERE is_active AND date_from <= days.d AND date_to > days.d))::int AS available,
                   0::numeric AS occupancy_pct
            FROM days ORDER BY days.d
            """, new { bd });
        forecast = forecast.Select(f => f with { OccupancyPct = f.Available <= 0 ? 0 : decimal.Round(f.Sold * 100m / f.Available, 1) }).ToList();
        var sellable = d.RoomsTotal - d.OutOfOrder;
        return new DashboardDto(bd, p.Name, p.Currency, d.RoomsTotal, d.Occupied, d.VacantClean, d.VacantDirty, d.OutOfOrder, d.ArrivalsExpected,
            d.ArrivalsCheckedIn, d.DeparturesExpected, d.DeparturesCheckedOut, d.GuestsInHouse,
            sellable <= 0 ? 0 : decimal.Round(d.Occupied * 100m / sellable, 1), d.RoomRevenueToday, d.OtherRevenueToday, d.PaymentsToday, d.OpenBalance,
            d.OpenTickets, d.OpenHkTasks, d.KbsPending, d.PendingWakeups, d.LastNightAudit, forecast);
    }

    sealed record DashRow(int RoomsTotal, int Occupied, int VacantClean, int VacantDirty, int OutOfOrder, int ArrivalsExpected, int ArrivalsCheckedIn,
        int DeparturesExpected, int DeparturesCheckedOut, int GuestsInHouse, decimal RoomRevenueToday, decimal OtherRevenueToday, decimal PaymentsToday,
        decimal OpenBalance, int OpenTickets, int OpenHkTasks, int KbsPending, int PendingWakeups, DateOnly? LastNightAudit);
}
