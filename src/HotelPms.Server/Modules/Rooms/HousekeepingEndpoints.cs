using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Property;

namespace HotelPms.Server.Modules.Rooms;

public sealed record HkTaskDto(Guid Id, Guid RoomId, string RoomNumber, string? Floor, string TaskType, string Status, DateOnly BusinessDate,
    Guid? AssignedUserId, string? AssignedTo, string? Notes, DateTime CreatedAt, DateTime? CompletedAt, int Version);
public sealed record CreateHkTaskRequest(Guid RoomId, string TaskType, Guid? AssignedUserId, string? Notes);
public sealed record UpdateHkTaskRequest(string Status, Guid? AssignedUserId, string? Notes, int Version);
public sealed record StaffDto(Guid Id, string Username, string FullName);

public sealed record TicketDto(Guid Id, long TicketNo, Guid? RoomId, string? RoomNumber, string? Location, string Issue, string? Description,
    string Priority, string Status, Guid? AssignedUserId, string? AssignedTo, DateTime OpenedAt, string? OpenedBy, DateTime? ResolvedAt,
    string? Notes, int Version);
public sealed record CreateTicketRequest(Guid? RoomId, string? Location, string Issue, string? Description, string Priority,
    Guid? AssignedUserId, bool BlockRoom, DateOnly? BlockFrom, DateOnly? BlockTo, string? BlockKind);
public sealed record UpdateTicketRequest(string Status, string Priority, Guid? AssignedUserId, string? Notes, int Version);

public static class HousekeepingEndpoints
{
    const string TaskSelect = """
        SELECT k.id, k.room_id, r.number AS room_number, r.floor, k.task_type, k.status, k.business_date, k.assigned_user_id,
               u.full_name AS assigned_to, k.notes, k.created_at, k.completed_at, k.version
        FROM pms.hk_tasks k JOIN pms.rooms r ON r.id = k.room_id LEFT JOIN pms.users u ON u.id = k.assigned_user_id
        """;
    const string TicketSelect = """
        SELECT m.id, m.ticket_no, m.room_id, r.number AS room_number, m.location, m.issue, m.description, m.priority, m.status,
               m.assigned_user_id, au.full_name AS assigned_to, m.opened_at, ou.full_name AS opened_by, m.resolved_at, m.notes, m.version
        FROM pms.maintenance_tickets m LEFT JOIN pms.rooms r ON r.id = m.room_id
        LEFT JOIN pms.users au ON au.id = m.assigned_user_id LEFT JOIN pms.users ou ON ou.id = m.opened_by
        """;

    public static void Map(WebApplication app)
    {
        var hk = app.MapGroup("/api/v1/housekeeping").WithTags("Housekeeping");

        hk.MapGet("/tasks", (Db db, DateOnly? date, string? status, string? floor, Guid? assignee) => db.QueryAsync<HkTaskDto>(TaskSelect + """
             WHERE (@date::date IS NULL OR k.business_date = @date)
               AND (@status::text IS NULL OR k.status = @status)
               AND (@floor::text IS NULL OR r.floor = @floor)
               AND (@assignee::uuid IS NULL OR k.assigned_user_id = @assignee)
             ORDER BY k.status = 'done', r.floor NULLS LAST, r.number LIMIT 1000
            """, new { date, status, floor, assignee })).RequirePermission("housekeeping.view");

        hk.MapGet("/staff", (Db db) => db.QueryAsync<StaffDto>("""
            SELECT DISTINCT u.id, u.username, u.full_name FROM pms.users u JOIN pms.user_roles ur ON ur.user_id = u.id
            JOIN pms.role_permissions rp ON rp.role_code = ur.role_code
            WHERE u.is_active AND rp.permission_code IN ('housekeeping.update','maintenance.manage') ORDER BY u.full_name
            """)).RequirePermission("housekeeping.view");

        hk.MapPost("/tasks", (CreateHkTaskRequest req, CommandRunner cmd) => cmd.RunAsync("hk_task.create", req, async tx =>
        {
            if (req.TaskType is not ("departure_clean" or "stayover_clean" or "inspection" or "turndown" or "deep_clean" or "other"))
                throw PmsException.Validation("Geçersiz görev türü.");
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.hk_tasks (room_id, task_type, business_date, assigned_user_id, notes, created_by)
                VALUES (@RoomId, @TaskType, @bd, @AssignedUserId, @notes, @uid) RETURNING id
                """, new { req.RoomId, req.TaskType, bd, req.AssignedUserId, notes = Validate.Optional(req.Notes, 500), uid = tx.User.Id });
            await tx.AuditAsync("hk_task.create", "hk_task", id, null, req);
            tx.Publish("housekeeping");
            tx.Publish("rooms", req.RoomId);
            return new { id };
        }, requireKey: false)).RequirePermission("housekeeping.assign");

        hk.MapPut("/tasks/{id:guid}", (Guid id, UpdateHkTaskRequest req, CommandRunner cmd, RequestContext ctx) =>
        {
            return cmd.RunAsync("hk_task.update", new { id, req }, async tx =>
            {
                if (req.Status is not ("open" or "in_progress" or "done" or "cancelled")) throw PmsException.Validation("Geçersiz görev durumu.");
                var before = await tx.OneOrNullAsync<HkTaskDto>(TaskSelect + " WHERE k.id = @id", new { id }) ?? throw PmsException.NotFound("Görev");
                if (before.AssignedUserId != req.AssignedUserId || req.Status == "cancelled") ctx.Require("housekeeping.assign");
                await tx.ExecVersionedAsync("""
                    UPDATE pms.hk_tasks SET status = @Status, assigned_user_id = @AssignedUserId, notes = @notes,
                        completed_at = CASE WHEN @Status = 'done' THEN now() ELSE NULL END,
                        completed_by = CASE WHEN @Status = 'done' THEN @uid ELSE NULL END, version = version + 1
                    WHERE id = @id AND version = @Version
                    """, new { id, req.Status, req.AssignedUserId, notes = Validate.Optional(req.Notes, 500), uid = tx.User.Id, req.Version });
                if (req.Status == "done" && before.TaskType is "departure_clean" or "stayover_clean" or "deep_clean")
                    await tx.ExecAsync("UPDATE pms.rooms SET hk_status = 'clean', hk_updated_at = now(), hk_updated_by = @uid, version = version + 1 WHERE id = @room AND hk_status IN ('dirty','cleaning')",
                        new { room = before.RoomId, uid = tx.User.Id });
                if (req.Status == "in_progress")
                    await tx.ExecAsync("UPDATE pms.rooms SET hk_status = 'cleaning', hk_updated_at = now(), hk_updated_by = @uid, version = version + 1 WHERE id = @room AND hk_status = 'dirty'",
                        new { room = before.RoomId, uid = tx.User.Id });
                await tx.AuditAsync("hk_task.update", "hk_task", id, before, req);
                tx.Publish("housekeeping");
                tx.Publish("rooms", before.RoomId);
                return new { id };
            }, requireKey: false);
        }).RequirePermission("housekeeping.update");

        var mt = app.MapGroup("/api/v1/maintenance").WithTags("Maintenance");
        mt.MapGet("/tickets", (Db db, string? status, Guid? roomId) => db.QueryAsync<TicketDto>(TicketSelect + """
             WHERE (@status::text IS NULL OR m.status = @status OR (@status = 'active' AND m.status IN ('open','in_progress')))
               AND (@roomId::uuid IS NULL OR m.room_id = @roomId)
             ORDER BY m.status IN ('resolved','closed','cancelled'),
                      CASE m.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, m.opened_at DESC LIMIT 1000
            """, new { status, roomId })).RequirePermission("maintenance.view");

        mt.MapPost("/tickets", (CreateTicketRequest req, CommandRunner cmd) => cmd.RunAsync("maintenance.create", req, async tx =>
        {
            if (req.Priority is not ("low" or "normal" or "high" or "urgent")) throw PmsException.Validation("Geçersiz öncelik.");
            if (req.RoomId is null && string.IsNullOrWhiteSpace(req.Location)) throw PmsException.Validation("Oda veya konum belirtilmelidir.");
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.maintenance_tickets (room_id, location, issue, description, priority, assigned_user_id, opened_by)
                VALUES (@RoomId, @location, @issue, @description, @Priority, @AssignedUserId, @uid) RETURNING id
                """, new
            {
                req.RoomId, location = Validate.Optional(req.Location, 100), issue = Validate.Required(req.Issue, "Arıza", 200),
                description = Validate.Optional(req.Description, 2000), req.Priority, req.AssignedUserId, uid = tx.User.Id,
            });
            if (req.BlockRoom)
            {
                if (req.RoomId is null || req.BlockFrom is null || req.BlockTo is null) throw PmsException.Validation("Oda blokajı için oda ve tarih aralığı gereklidir.");
                await RoomEndpoints.CreateBlockAsync(tx, new CreateRoomBlockRequest(req.RoomId.Value, req.BlockKind ?? "out_of_order",
                    req.BlockFrom.Value, req.BlockTo.Value, "Arıza: " + req.Issue.Trim(), id));
            }
            await tx.AuditAsync("maintenance.create", "maintenance_ticket", id, null, req);
            tx.Publish("maintenance");
            if (req.RoomId is { } r) tx.Publish("rooms", r);
            return new { id };
        }, requireKey: false)).RequirePermission("maintenance.manage");

        mt.MapPut("/tickets/{id:guid}", (Guid id, UpdateTicketRequest req, CommandRunner cmd) => cmd.RunAsync("maintenance.update", new { id, req }, async tx =>
        {
            if (req.Status is not ("open" or "in_progress" or "resolved" or "closed" or "cancelled")) throw PmsException.Validation("Geçersiz durum.");
            if (req.Priority is not ("low" or "normal" or "high" or "urgent")) throw PmsException.Validation("Geçersiz öncelik.");
            var before = await tx.OneOrNullAsync<TicketDto>(TicketSelect + " WHERE m.id = @id", new { id }) ?? throw PmsException.NotFound("Arıza kaydı");
            var resolving = req.Status is "resolved" or "closed" or "cancelled";
            await tx.ExecVersionedAsync("""
                UPDATE pms.maintenance_tickets SET status = @Status, priority = @Priority, assigned_user_id = @AssignedUserId, notes = @notes,
                    resolved_at = CASE WHEN @resolving THEN COALESCE(resolved_at, now()) ELSE NULL END,
                    resolved_by = CASE WHEN @resolving THEN COALESCE(resolved_by, @uid) ELSE NULL END, version = version + 1
                WHERE id = @id AND version = @Version
                """, new { id, req.Status, req.Priority, req.AssignedUserId, notes = Validate.Optional(req.Notes, 4000), resolving, uid = tx.User.Id, req.Version });
            if (resolving)
            {
                var released = await tx.ListAsync<Guid>("""
                    UPDATE pms.room_blocks SET is_active = false, released_at = now(), released_by = @uid WHERE ticket_id = @id AND is_active RETURNING room_id
                    """, new { id, uid = tx.User.Id });
                if (released.Count > 0) tx.Publish("availability");
            }
            await tx.AuditAsync("maintenance.update", "maintenance_ticket", id, before, req);
            tx.Publish("maintenance");
            if (before.RoomId is { } r) tx.Publish("rooms", r);
            return new { id };
        }, requireKey: false)).RequirePermission("maintenance.manage");
    }
}
