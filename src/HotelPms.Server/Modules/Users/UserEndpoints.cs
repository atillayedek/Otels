using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Realtime;

namespace HotelPms.Server.Modules.Users;

public sealed record UserDto(Guid Id, string Username, string FullName, string? Email, bool IsActive, bool MustChangePassword,
    DateTime? LastLoginAt, DateTime? LockedUntil, string[] Roles, int Version);
public sealed record CreateUserRequest(string Username, string FullName, string? Email, string Password, string[] Roles);
public sealed record UpdateUserRequest(string FullName, string? Email, bool IsActive, string[] Roles, int Version);
public sealed record ResetPasswordRequest(string NewPassword);
public sealed record RoleDto(string Code, string Name, bool IsSystem, string[] Permissions);
public sealed record PermissionDto(string Code, string Module, string Description);
public sealed record UpdateRoleRequest(string Name, string[] Permissions);
public sealed record CreateRoleRequest(string Code, string Name, string[] Permissions);
public sealed record DeviceDto(Guid Id, string Name, string Kind, string? Hostname, string? LastIp, string? ClientVersion,
    string? LastUser, string Status, DateTime RegisteredAt, DateTime LastSeenAt);
public sealed record SessionDto(Guid Id, string Username, string? DeviceName, string? Ip, DateTime CreatedAt, DateTime LastSeenAt, DateTime ExpiresAt);

public static class UserEndpoints
{
    const string UserSelect = """
        SELECT u.id, u.username, u.full_name, u.email, u.is_active, u.must_change_password, u.last_login_at, u.locked_until,
               COALESCE(array_agg(ur.role_code ORDER BY ur.role_code) FILTER (WHERE ur.role_code IS NOT NULL), '{}') AS roles, u.version
        FROM pms.users u LEFT JOIN pms.user_roles ur ON ur.user_id = u.id
        """;

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/users").WithTags("Users").RequirePermission("user.manage");

        g.MapGet("/", (Db db) => db.QueryAsync<UserDto>(UserSelect + " GROUP BY u.id ORDER BY u.username"));

        g.MapPost("/", (CreateUserRequest req, CommandRunner cmd) => cmd.RunAsync("user.create", req with { Password = "***" }, async tx =>
        {
            var username = Validate.Required(req.Username, "Kullanıcı adı", 40).ToLowerInvariant();
            if (!global::System.Text.RegularExpressions.Regex.IsMatch(username, "^[a-z0-9._-]{3,40}$"))
                throw PmsException.Validation("Kullanıcı adı 3-40 karakter; yalnız küçük harf, rakam, nokta, tire ve alt çizgi içerebilir.");
            if (PasswordHasher.PolicyError(req.Password) is { } pe) throw PmsException.Validation(pe);
            await EnsureRolesAssignable(tx, req.Roles);
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.users (username, full_name, email, password_hash, must_change_password)
                VALUES (@username, @fullName, @email, @hash, true) RETURNING id
                """, new { username, fullName = Validate.Required(req.FullName, "Ad soyad", 120), email = Validate.Email(req.Email), hash = PasswordHasher.Hash(req.Password) });
            foreach (var r in req.Roles.Distinct())
                await tx.ExecAsync("INSERT INTO pms.user_roles (user_id, role_code) VALUES (@id, @r)", new { id, r });
            await tx.AuditAsync("user.create", "user", id, null, new { username, req.FullName, req.Roles });
            return new { id };
        }, requireKey: false));

        g.MapPut("/{id:guid}", (Guid id, UpdateUserRequest req, CommandRunner cmd, SessionService sessions) => cmd.RunAsync("user.update", new { id, req }, async tx =>
        {
            var before = await tx.OneOrNullAsync<UserDto>(UserSelect + " WHERE u.id = @id GROUP BY u.id", new { id }) ?? throw PmsException.NotFound("Kullanıcı");
            if (id == tx.User.Id && (!req.IsActive || !req.Roles.Contains("SUPER_ADMIN") && before.Roles.Contains("SUPER_ADMIN")))
                throw PmsException.Validation("Kendi hesabınızı pasifleştiremez veya kendi yönetici rolünüzü kaldıramazsınız.");
            await EnsureRolesAssignable(tx, req.Roles);
            await EnsureNotLastAdmin(tx, id, req.IsActive, req.Roles);
            await tx.ExecVersionedAsync("""
                UPDATE pms.users SET full_name = @fullName, email = @email, is_active = @active, updated_at = now(), version = version + 1
                WHERE id = @id AND version = @version
                """, new { id, fullName = Validate.Required(req.FullName, "Ad soyad", 120), email = Validate.Email(req.Email), active = req.IsActive, version = req.Version });
            await tx.ExecAsync("DELETE FROM pms.user_roles WHERE user_id = @id", new { id });
            foreach (var r in req.Roles.Distinct())
                await tx.ExecAsync("INSERT INTO pms.user_roles (user_id, role_code) VALUES (@id, @r)", new { id, r });
            if (!req.IsActive)
                await tx.ExecAsync("UPDATE pms.sessions SET revoked_at = now(), revoke_reason = 'user_deactivated' WHERE user_id = @id AND revoked_at IS NULL", new { id });
            await tx.AuditAsync("user.update", "user", id, before, req);
            sessions.InvalidateCache();
            return new { id };
        }, requireKey: false));

        g.MapPost("/{id:guid}/reset-password", (Guid id, ResetPasswordRequest req, CommandRunner cmd, SessionService sessions) => cmd.RunAsync("user.reset_password", new { id }, async tx =>
        {
            if (PasswordHasher.PolicyError(req.NewPassword) is { } pe) throw PmsException.Validation(pe);
            var n = await tx.ExecAsync("""
                UPDATE pms.users SET password_hash = @h, must_change_password = true, failed_attempts = 0, locked_until = NULL,
                    password_changed_at = now(), version = version + 1 WHERE id = @id
                """, new { id, h = PasswordHasher.Hash(req.NewPassword) });
            if (n == 0) throw PmsException.NotFound("Kullanıcı");
            await tx.ExecAsync("UPDATE pms.sessions SET revoked_at = now(), revoke_reason = 'password_reset' WHERE user_id = @id AND revoked_at IS NULL", new { id });
            await tx.AuditAsync("user.reset_password", "user", id);
            sessions.InvalidateCache();
            return new { id };
        }, requireKey: false));

        g.MapPost("/{id:guid}/unlock", (Guid id, CommandRunner cmd) => cmd.RunAsync("user.unlock", new { id }, async tx =>
        {
            await tx.ExecAsync("UPDATE pms.users SET failed_attempts = 0, locked_until = NULL WHERE id = @id", new { id });
            await tx.AuditAsync("user.unlock", "user", id);
            return new { id };
        }, requireKey: false));

        var roles = app.MapGroup("/api/v1/roles").WithTags("Users").RequirePermission("user.manage");
        roles.MapGet("/", (Db db) => db.QueryAsync<RoleDto>("""
            SELECT r.code, r.name, r.is_system, COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS permissions
            FROM pms.roles r LEFT JOIN pms.role_permissions rp ON rp.role_code = r.code GROUP BY r.code ORDER BY r.is_system DESC, r.name
            """));
        roles.MapGet("/permissions", (Db db) => db.QueryAsync<PermissionDto>("SELECT code, module, description FROM pms.permissions ORDER BY module, code"));
        roles.MapPost("/", (CreateRoleRequest req, CommandRunner cmd, SessionService sessions) => cmd.RunAsync("role.create", req, async tx =>
        {
            var code = Validate.Required(req.Code, "Rol kodu", 40).ToUpperInvariant();
            if (!global::System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Z][A-Z0-9_]{1,40}$")) throw PmsException.Validation("Rol kodu yalnız büyük harf, rakam ve _ içerebilir.");
            await tx.ExecAsync("INSERT INTO pms.roles (code, name) VALUES (@code, @name)", new { code, name = Validate.Required(req.Name, "Rol adı", 80) });
            await SetRolePermissions(tx, code, req.Permissions);
            await tx.AuditAsync("role.create", "role", code, null, req);
            sessions.InvalidateCache();
            return new { code };
        }, requireKey: false));
        roles.MapPut("/{code}", (string code, UpdateRoleRequest req, CommandRunner cmd, SessionService sessions) => cmd.RunAsync("role.update", new { code, req }, async tx =>
        {
            if (code == "SUPER_ADMIN") throw PmsException.Validation("Süper yönetici rolünün yetkileri değiştirilemez.");
            var before = await tx.ListAsync<string>("SELECT permission_code FROM pms.role_permissions WHERE role_code = @code", new { code });
            if (await tx.ExecAsync("UPDATE pms.roles SET name = @name WHERE code = @code", new { code, name = Validate.Required(req.Name, "Rol adı", 80) }) == 0)
                throw PmsException.NotFound("Rol");
            await SetRolePermissions(tx, code, req.Permissions);
            await tx.AuditAsync("role.update", "role", code, before, req.Permissions);
            sessions.InvalidateCache();
            return new { code };
        }, requireKey: false));

        var devices = app.MapGroup("/api/v1/devices").WithTags("Users").RequirePermission("device.manage");
        devices.MapGet("/", (Db db) => db.QueryAsync<DeviceDto>("""
            SELECT d.id, d.name, d.kind, d.hostname, host(d.last_ip) AS last_ip, d.client_version, u.username AS last_user, d.status, d.registered_at, d.last_seen_at
            FROM pms.devices d LEFT JOIN pms.users u ON u.id = d.last_user_id ORDER BY d.last_seen_at DESC LIMIT 500
            """));
        devices.MapPost("/{id:guid}/revoke", (Guid id, CommandRunner cmd, SessionService sessions, RealtimeHub hub) => cmd.RunAsync("device.revoke", new { id }, async tx =>
        {
            if (id == tx.Ctx.DeviceId) throw PmsException.Validation("Şu an kullandığınız cihazı iptal edemezsiniz.");
            if (await tx.ExecAsync("UPDATE pms.devices SET status = 'revoked', revoked_at = now(), revoked_by = @uid WHERE id = @id AND status = 'active'", new { id, uid = tx.User.Id }) == 0)
                throw PmsException.NotFound("Aktif cihaz");
            await tx.ExecAsync("UPDATE pms.sessions SET revoked_at = now(), revoke_reason = 'device_revoked' WHERE device_id = @id AND revoked_at IS NULL", new { id });
            await tx.AuditAsync("device.revoke", "device", id);
            sessions.InvalidateCache();
            hub.Disconnect(c => c.DeviceId == id);
            return new { id };
        }, requireKey: false));
        devices.MapPost("/{id:guid}/restore", (Guid id, CommandRunner cmd) => cmd.RunAsync("device.restore", new { id }, async tx =>
        {
            await tx.ExecAsync("UPDATE pms.devices SET status = 'active', revoked_at = NULL, revoked_by = NULL WHERE id = @id", new { id });
            await tx.AuditAsync("device.restore", "device", id);
            return new { id };
        }, requireKey: false));

        var sessionsGroup = app.MapGroup("/api/v1/sessions").WithTags("Users").RequirePermission("user.manage");
        sessionsGroup.MapGet("/", (Db db) => db.QueryAsync<SessionDto>("""
            SELECT s.id, u.username, d.name AS device_name, host(s.ip) AS ip, s.created_at, s.last_seen_at, s.expires_at
            FROM pms.sessions s JOIN pms.users u ON u.id = s.user_id LEFT JOIN pms.devices d ON d.id = s.device_id
            WHERE s.revoked_at IS NULL AND s.expires_at > now() ORDER BY s.last_seen_at DESC
            """));
        sessionsGroup.MapPost("/{id:guid}/revoke", (Guid id, CommandRunner cmd, SessionService sessions, RealtimeHub hub) => cmd.RunAsync("session.revoke", new { id }, async tx =>
        {
            var uid = await tx.ScalarAsync<Guid?>("UPDATE pms.sessions SET revoked_at = now(), revoke_reason = 'admin_revoke' WHERE id = @id AND revoked_at IS NULL RETURNING user_id", new { id })
                ?? throw PmsException.NotFound("Aktif oturum");
            await tx.AuditAsync("session.revoke", "session", id);
            sessions.InvalidateCache();
            return new { id };
        }, requireKey: false));
    }

    static async Task EnsureRolesAssignable(Tx tx, string[] roles)
    {
        if (roles.Length == 0) throw PmsException.Validation("En az bir rol seçilmelidir.");
        var known = await tx.ListAsync<string>("SELECT code FROM pms.roles WHERE code = ANY(@roles)", new { roles });
        if (known.Count != roles.Distinct().Count()) throw PmsException.Validation("Tanımsız rol seçildi.");
        if (roles.Contains("SUPER_ADMIN") && !tx.User.Roles.Contains("SUPER_ADMIN"))
            throw PmsException.Forbidden("Süper yönetici rolünü yalnız süper yönetici atayabilir.");
    }

    static async Task EnsureNotLastAdmin(Tx tx, Guid id, bool active, string[] roles)
    {
        if (active && roles.Contains("SUPER_ADMIN")) return;
        var others = await tx.ScalarAsync<long>("""
            SELECT count(*) FROM pms.users u JOIN pms.user_roles ur ON ur.user_id = u.id
            WHERE ur.role_code = 'SUPER_ADMIN' AND u.is_active AND u.id <> @id
            """, new { id });
        var isAdmin = await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.user_roles WHERE user_id = @id AND role_code = 'SUPER_ADMIN')", new { id });
        if (isAdmin && others == 0) throw PmsException.Validation("Sistemde en az bir aktif süper yönetici kalmalıdır.");
    }

    static async Task SetRolePermissions(Tx tx, string code, string[] permissions)
    {
        var known = await tx.ListAsync<string>("SELECT code FROM pms.permissions WHERE code = ANY(@p)", new { p = permissions });
        if (known.Count != permissions.Distinct().Count()) throw PmsException.Validation("Tanımsız izin seçildi.");
        await tx.ExecAsync("DELETE FROM pms.role_permissions WHERE role_code = @code", new { code });
        foreach (var p in known)
            await tx.ExecAsync("INSERT INTO pms.role_permissions (role_code, permission_code) VALUES (@code, @p)", new { code, p });
    }
}
