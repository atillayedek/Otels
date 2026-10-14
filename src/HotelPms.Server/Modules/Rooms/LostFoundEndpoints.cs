using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Property;

namespace HotelPms.Server.Modules.Rooms;

public sealed record LostItemDto(Guid Id, long ItemNo, DateOnly FoundDate, string Location, Guid? RoomId, string? RoomNumber, Guid? GuestId, string? GuestName,
    string Category, string Description, string? Storage, string? FoundBy, string Status, string? ReturnedTo, DateTime? ClosedAt, string? ClosedBy,
    string? CloseNote, DateTime CreatedAt, string? CreatedBy, int Version);
public sealed record SaveLostItemRequest(DateOnly? FoundDate, string Location, Guid? RoomId, Guid? GuestId, string Category, string Description, string? Storage,
    string? FoundBy, int? Version);
public sealed record CloseLostItemRequest(string Action, string? ReturnedTo, string? Note, int Version);

/// <summary>Kayıp eşya defteri: bulunan eşya kaydı, sahibine teslim (teslim alan kişi zorunlu) veya imha/bağış. Kapanan kayıt değiştirilemez.</summary>
public static class LostFoundEndpoints
{
    static readonly string[] Categories = ["clothing", "electronics", "jewelry", "document", "money", "bag", "other"];

    const string Select = """
        SELECT l.id, l.item_no, l.found_date, l.location, l.room_id, rm.number AS room_number, l.guest_id, g.first_name || ' ' || g.last_name AS guest_name,
               l.category, l.description, l.storage, l.found_by, l.status, l.returned_to, l.closed_at, cu.username AS closed_by, l.close_note, l.created_at,
               u.username AS created_by, l.version
        FROM pms.lost_items l LEFT JOIN pms.rooms rm ON rm.id = l.room_id LEFT JOIN pms.guests g ON g.id = l.guest_id
        LEFT JOIN pms.users u ON u.id = l.created_by LEFT JOIN pms.users cu ON cu.id = l.closed_by
        """;

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/lost-items").WithTags("Lost & Found").RequirePermission("lost_found.manage");

        g.MapGet("/", (Db db, string? status, string? q) => db.QueryAsync<LostItemDto>(Select + """
             WHERE (@status::text IS NULL OR l.status = @status)
               AND (@q::text IS NULL OR l.description ILIKE '%' || @q || '%' OR l.location ILIKE '%' || @q || '%' OR rm.number = @q
                    OR (g.first_name || ' ' || g.last_name) ILIKE '%' || @q || '%' OR l.item_no::text = @q)
            ORDER BY l.status = 'stored' DESC, l.found_date DESC, l.item_no DESC LIMIT 500
            """, new { status = string.IsNullOrWhiteSpace(status) ? null : status, q = string.IsNullOrWhiteSpace(q) ? null : q.Trim() }));

        g.MapPost("/", (SaveLostItemRequest req, CommandRunner cmd) => cmd.RunAsync("lost_item.create", req, async tx =>
        {
            var p = await ParamsAsync(tx, req);
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.lost_items (found_date, location, room_id, guest_id, category, description, storage, found_by, created_by)
                VALUES (@FoundDate, @Location, @RoomId, @GuestId, @Category, @Description, @Storage, @FoundBy, @uid) RETURNING id
                """, new { p.FoundDate, p.Location, p.RoomId, p.GuestId, p.Category, p.Description, p.Storage, p.FoundBy, uid = tx.User.Id });
            await tx.AuditAsync("lost_item.create", "lost_item", id, null, p);
            tx.Publish("lost_items");
            return await tx.OneAsync<LostItemDto>(Select + " WHERE l.id = @id", new { id });
        })).RequirePermission("lost_found.manage");

        g.MapPut("/{id:guid}", (Guid id, SaveLostItemRequest req, CommandRunner cmd) => cmd.RunAsync("lost_item.update", new { id, req }, async tx =>
        {
            var before = await tx.OneOrNullAsync<LostItemDto>(Select + " WHERE l.id = @id", new { id }) ?? throw PmsException.NotFound("Kayıp eşya kaydı");
            if (before.Status != "stored") throw PmsException.Validation("Teslim edilmiş veya imha edilmiş kayıt değiştirilemez.");
            var p = await ParamsAsync(tx, req);
            await tx.ExecVersionedAsync("""
                UPDATE pms.lost_items SET found_date = @FoundDate, location = @Location, room_id = @RoomId, guest_id = @GuestId, category = @Category,
                    description = @Description, storage = @Storage, found_by = @FoundBy, version = version + 1
                WHERE id = @id AND version = @version
                """, new { id, p.FoundDate, p.Location, p.RoomId, p.GuestId, p.Category, p.Description, p.Storage, p.FoundBy, version = req.Version ?? -1 });
            await tx.AuditAsync("lost_item.update", "lost_item", id, before, p);
            tx.Publish("lost_items");
            return await tx.OneAsync<LostItemDto>(Select + " WHERE l.id = @id", new { id });
        }, requireKey: false)).RequirePermission("lost_found.manage");

        g.MapPost("/{id:guid}/close", (Guid id, CloseLostItemRequest req, CommandRunner cmd) => cmd.RunAsync("lost_item.close", new { id, req }, async tx =>
        {
            if (req.Action is not ("returned" or "disposed")) throw PmsException.Validation("İşlem 'returned' (teslim) veya 'disposed' (imha/bağış) olmalıdır.");
            var state = await tx.ScalarAsync<string?>("SELECT status FROM pms.lost_items WHERE id = @id", new { id }) ?? throw PmsException.NotFound("Kayıp eşya kaydı");
            if (state != "stored") throw PmsException.Validation("Kayıt zaten kapatılmış (teslim edildi veya imha edildi).");
            var returnedTo = req.Action == "returned" ? Validate.Required(req.ReturnedTo, "Teslim alan kişi (ad soyad, kimlik/iletişim)", 200) : null;
            var note = req.Action == "disposed" ? Validate.Required(req.Note, "İmha / bağış açıklaması", 500) : Validate.Optional(req.Note, 500);
            await tx.ExecVersionedAsync("""
                UPDATE pms.lost_items SET status = @status, returned_to = @returnedTo, close_note = @note, closed_at = now(), closed_by = @uid, version = version + 1
                WHERE id = @id AND version = @version AND status = 'stored'
                """, new { id, status = req.Action, returnedTo, note, uid = tx.User.Id, version = req.Version });
            await tx.AuditAsync("lost_item." + req.Action, "lost_item", id, null, new { returnedTo, note });
            tx.Publish("lost_items");
            return await tx.OneAsync<LostItemDto>(Select + " WHERE l.id = @id", new { id });
        })).RequirePermission("lost_found.manage");
    }

    static async Task<SaveLostItemRequest> ParamsAsync(Tx tx, SaveLostItemRequest r)
    {
        var bd = await PropertyEndpoints.BusinessDateAsync(tx);
        var found = r.FoundDate ?? bd;
        if (found > bd) throw PmsException.Validation("Bulunma tarihi iş gününden sonra olamaz.");
        if (!Categories.Contains(r.Category)) throw PmsException.Validation("Geçersiz eşya türü.");
        if (r.RoomId is { } room && !await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.rooms WHERE id = @room)", new { room })) throw PmsException.NotFound("Oda");
        if (r.GuestId is { } guest && !await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.guests WHERE id = @guest)", new { guest })) throw PmsException.NotFound("Misafir");
        return r with
        {
            FoundDate = found, Location = Validate.Required(r.Location, "Bulunduğu yer", 120), Description = Validate.Required(r.Description, "Eşya tanımı", 500),
            Storage = Validate.Optional(r.Storage, 120), FoundBy = Validate.Optional(r.FoundBy, 100),
        };
    }
}
