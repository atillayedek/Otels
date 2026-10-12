using Dapper;
using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Realtime;

namespace HotelPms.Server.Modules.Users;

public sealed record LoginRequest(string Username, string Password, Guid DeviceId, string? DeviceName, string? DeviceKind, string? ClientVersion);
public sealed record MeResponse(Guid Id, string Username, string FullName, IReadOnlyList<string> Roles, IReadOnlyList<string> Permissions, bool MustChangePassword, Guid? DeviceId);
public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);

public static class AuthEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/auth").WithTags("Auth");

        g.MapPost("/login", async (LoginRequest req, SessionService sessions, RequestContext ctx, HttpContext http) =>
        {
            if (req.DeviceId == Guid.Empty) throw PmsException.Validation("Cihaz kimliği eksik.");
            var kind = req.DeviceKind == "client" ? "client" : "browser";
            var name = Validate.Optional(ctx.Hostname ?? req.DeviceName, 63) ?? (kind == "browser" ? "Tarayıcı" : "PMS Client");
            var r = await sessions.LoginAsync(req.Username, req.Password, req.DeviceId, name, kind,
                Validate.Optional(req.ClientVersion, 30), ctx.Ip, http.Request.Headers.UserAgent.ToString(), http.RequestAborted);
            http.Response.Cookies.Append(SessionService.CookieName, r.Token, new CookieOptions
            {
                HttpOnly = true,
                Secure = http.Request.IsHttps,
                SameSite = SameSiteMode.Strict,
                Path = "/",
                Expires = DateTimeOffset.UtcNow.Add(SessionService.AbsoluteTimeout),
            });
            return ToMe(r.User);
        }).AllowAnonymousPms().RequireRateLimiting("login");

        g.MapPost("/logout", async (RequestContext ctx, SessionService sessions, RealtimeHub hub, HttpContext http, Db db) =>
        {
            var u = ctx.RequireUser();
            await sessions.RevokeAsync(u.SessionId, "logout", http.RequestAborted);
            await using var c = await db.OpenAsync();
            await c.ExecuteAsync("INSERT INTO pms.audit_log (user_id, username, device_id, ip, action, entity_type, entity_id) VALUES (@id, @un, @dev, @ip::inet, 'auth.logout', 'session', @sid)",
                new { id = u.Id, un = u.Username, dev = ctx.DeviceId, ip = ctx.Ip?.ToString(), sid = u.SessionId.ToString() });
            http.Response.Cookies.Delete(SessionService.CookieName);
            return Results.NoContent();
        });

        g.MapGet("/me", (RequestContext ctx) => ToMe(ctx.RequireUser()));

        g.MapPost("/change-password", async (ChangePasswordRequest req, RequestContext ctx, Db db, SessionService sessions) =>
        {
            var u = ctx.RequireUser();
            if (PasswordHasher.PolicyError(req.NewPassword) is { } pe) throw PmsException.Validation(pe);
            await using var c = await db.OpenAsync();
            var hash = await c.ExecuteScalarAsync<string>("SELECT password_hash FROM pms.users WHERE id = @id", new { id = u.Id });
            if (!PasswordHasher.Verify(req.CurrentPassword ?? "", hash!)) throw PmsException.Validation("Mevcut parola hatalı.");
            if (req.NewPassword == req.CurrentPassword) throw PmsException.Validation("Yeni parola eskisiyle aynı olamaz.");
            await using var tx = await c.BeginTransactionAsync();
            await c.ExecuteAsync("""
                UPDATE pms.users SET password_hash = @h, must_change_password = false, password_changed_at = now(), updated_at = now(), version = version + 1 WHERE id = @id;
                UPDATE pms.sessions SET revoked_at = now(), revoke_reason = 'password_changed' WHERE user_id = @id AND id <> @sid AND revoked_at IS NULL;
                INSERT INTO pms.audit_log (user_id, username, device_id, ip, action, entity_type, entity_id) VALUES (@id, @un, @dev, @ip::inet, 'auth.password_changed', 'user', @id::text);
                """, new { h = PasswordHasher.Hash(req.NewPassword), id = u.Id, sid = u.SessionId, un = u.Username, dev = ctx.DeviceId, ip = ctx.Ip?.ToString() }, tx);
            await tx.CommitAsync();
            sessions.InvalidateCache();
            return Results.NoContent();
        });
    }

    static MeResponse ToMe(CurrentUser u) =>
        new(u.Id, u.Username, u.FullName, u.Roles, u.Permissions.OrderBy(p => p).ToList(), u.MustChangePassword, u.DeviceId);
}
