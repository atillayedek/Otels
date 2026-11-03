using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;

namespace HotelPms.Server.Modules.Reservations;

public sealed record ReservationCodeDto(Guid Id, string Kind, string Code, string Name, int SortOrder, bool IsActive, int UsedCount, int Version);
public sealed record SaveReservationCodeRequest(string Kind, string Code, string Name, int SortOrder, bool IsActive, int? Version);

/// <summary>Rezervasyon kodları (market, segment): tanım listesi; rezervasyon formunda seçilir, segment raporunda gruplanır.</summary>
public static class ReservationCodeEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/reservation-codes").WithTags("Reservations");
        g.MapGet("/", (Db db) => db.QueryAsync<ReservationCodeDto>("""
            SELECT c.id, c.kind, c.code, c.name, c.sort_order, c.is_active,
                   (SELECT count(*)::int FROM pms.reservations r WHERE (c.kind = 'market' AND r.market = c.code) OR (c.kind = 'segment' AND r.segment = c.code)) AS used_count,
                   c.version
            FROM pms.reservation_codes c ORDER BY c.kind, c.sort_order, c.code
            """)).RequirePermission("reservation.view");
        g.MapPost("/", (SaveReservationCodeRequest req, CommandRunner cmd) => cmd.RunAsync("reservation_code.create", req, async tx =>
        {
            var p = Params(req);
            if (await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.reservation_codes WHERE kind = @kind AND code = @code)", new { p.kind, p.code }))
                throw PmsException.Conflict($"{p.code} kodu zaten tanımlı.");
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.reservation_codes (kind, code, name, sort_order, is_active) VALUES (@kind, @code, @name, @sort, @active) RETURNING id
                """, new { p.kind, p.code, p.name, sort = req.SortOrder, active = req.IsActive });
            await tx.AuditAsync("reservation_code.create", "reservation_code", id, null, req);
            tx.Publish("reservationCodes");
            return new { id };
        }, requireKey: false)).RequirePermission("rate.manage");
        g.MapPut("/{id:guid}", (Guid id, SaveReservationCodeRequest req, CommandRunner cmd) => cmd.RunAsync("reservation_code.update", new { id, req }, async tx =>
        {
            var p = Params(req);
            var old = await tx.OneOrNullAsync<(string Kind, string Code)>("SELECT kind, code FROM pms.reservation_codes WHERE id = @id", new { id });
            if (old == default) throw PmsException.NotFound("Rezervasyon kodu");
            // Kullanılmış kodun kendisi değiştirilemez (eski rezervasyonlar bu koda bağlı); adı, sırası ve aktifliği değişebilir.
            if ((old.Kind != p.kind || old.Code != p.code) && await UsedAsync(tx, old.Kind, old.Code))
                throw PmsException.Validation("Bu kod rezervasyonlarda kullanılmış; kod değiştirilemez. Adını değiştirin veya pasif yapıp yeni kod açın.");
            if (await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.reservation_codes WHERE kind = @kind AND code = @code AND id <> @id)", new { p.kind, p.code, id }))
                throw PmsException.Conflict($"{p.code} kodu zaten tanımlı.");
            await tx.ExecVersionedAsync("""
                UPDATE pms.reservation_codes SET kind = @kind, code = @code, name = @name, sort_order = @sort, is_active = @active, version = version + 1
                WHERE id = @id AND version = @version
                """, new { id, p.kind, p.code, p.name, sort = req.SortOrder, active = req.IsActive, version = req.Version ?? -1 });
            await tx.AuditAsync("reservation_code.update", "reservation_code", id, null, req);
            tx.Publish("reservationCodes");
            return new { id };
        }, requireKey: false)).RequirePermission("rate.manage");
        g.MapDelete("/{id:guid}", (Guid id, CommandRunner cmd) => cmd.RunAsync("reservation_code.delete", new { id }, async tx =>
        {
            var old = await tx.OneOrNullAsync<(string Kind, string Code)>("SELECT kind, code FROM pms.reservation_codes WHERE id = @id", new { id });
            if (old == default) throw PmsException.NotFound("Rezervasyon kodu");
            if (await UsedAsync(tx, old.Kind, old.Code)) throw PmsException.Validation("Bu kod rezervasyonlarda kullanılmış; silinemez. Pasif yapabilirsiniz.");
            await tx.ExecAsync("DELETE FROM pms.reservation_codes WHERE id = @id", new { id });
            await tx.AuditAsync("reservation_code.delete", "reservation_code", id);
            tx.Publish("reservationCodes");
            return new { id };
        }, requireKey: false)).RequirePermission("rate.manage");
    }

    static Task<bool> UsedAsync(Tx tx, string kind, string code) => tx.ScalarAsync<bool>(
        "SELECT EXISTS (SELECT 1 FROM pms.reservations WHERE (@kind = 'market' AND market = @code) OR (@kind = 'segment' AND segment = @code))", new { kind, code });

    static (string kind, string code, string name) Params(SaveReservationCodeRequest r)
    {
        var kind = r.Kind is "market" or "segment" ? r.Kind : throw PmsException.Validation("Kod türü market veya segment olmalıdır.");
        var code = Validate.Required(r.Code, "Kod", 20).ToUpperInvariant();
        if (!global::System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Z0-9_-]{1,20}$")) throw PmsException.Validation("Kod yalnız harf (A-Z), rakam, - ve _ içerebilir.");
        return (kind, code, Validate.Required(r.Name, "Ad", 60));
    }
}
