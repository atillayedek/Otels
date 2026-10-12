using System.Net;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Platform;
using HotelPms.Shared;

namespace HotelPms.Server.Auth;

/// <summary>
/// /api altındaki her istek için: sürüm el sıkışması, CSRF başlığı, oturum çözümleme, cihaz ve izin kontrolü,
/// veritabanı/disk durumuna göre yazma isteklerinin reddedilmesi.
/// </summary>
public sealed class AuthMiddleware(RequestDelegate next)
{
    public const string DeviceHeader = "X-PMS-Device-Id";
    public const string HostnameHeader = "X-PMS-Hostname";
    public const string ClientVersionHeader = "X-PMS-Client-Version";
    public const string CsrfHeader = "X-PMS-Request";

    public async Task InvokeAsync(HttpContext http, RequestContext ctx, SessionService sessions, HealthState health)
    {
        var path = http.Request.Path;
        if (!path.StartsWithSegments("/api"))
        {
            await next(http);
            return;
        }

        ctx.Ip = http.Connection.RemoteIpAddress is { } ip && ip.IsIPv4MappedToIPv6 ? ip.MapToIPv4() : http.Connection.RemoteIpAddress;
        if (Guid.TryParse(http.Request.Headers[DeviceHeader], out var deviceId)) ctx.DeviceId = deviceId;
        var host = http.Request.Headers[HostnameHeader].ToString();
        ctx.Hostname = string.IsNullOrWhiteSpace(host) ? null : host.Length > 63 ? host[..63] : host;
        http.Response.Headers["X-PMS-Server-Version"] = PmsConstants.VersionText;

        var cv = http.Request.Headers[ClientVersionHeader].ToString();
        if (cv.Length > 0 && Version.TryParse(cv.Split('-')[0], out var clientVersion) && clientVersion < PmsConstants.MinClientVersion)
            throw new PmsException(426, "client_outdated", "Bu istemci sürümü sunucuyla uyumlu değil. Güncelleme gerekiyor.");

        var method = http.Request.Method;
        var isWrite = !(HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method));
        if (isWrite && http.Request.Headers[CsrfHeader] != "1" && !path.StartsWithSegments("/api/v1/manage"))
            throw new PmsException(403, "csrf", "İstek doğrulanamadı. Sayfayı yenileyin.");

        var endpoint = http.GetEndpoint();
        var isSystemPath = path.StartsWithSegments("/api/v1/system") || path.StartsWithSegments("/api/v1/manage");
        if (!isSystemPath)
        {
            if (!health.DatabaseReady)
                throw new PmsException(503, "db_unavailable", "Veritabanı bağlantısı geçici olarak kullanılamıyor.");
            if (isWrite && health.DiskCritical)
                throw new PmsException(507, "disk_full", "Sunucu disk alanı kritik seviyede. Veri kaybını önlemek için kayıt işlemleri durduruldu. Yöneticinize başvurun.");
        }

        if (http.Request.Cookies.TryGetValue(SessionService.CookieName, out var token))
            ctx.User = await sessions.ResolveAsync(token, http.RequestAborted);

        if (endpoint?.Metadata.GetMetadata<AnonymousPmsAttribute>() is not null)
        {
            await next(http);
            return;
        }

        var user = ctx.RequireUser();
        if (user.MustChangePassword && !path.StartsWithSegments("/api/v1/auth"))
            throw new PmsException(403, "must_change_password", "Devam etmeden önce parolanızı değiştirmeniz gerekiyor.");
        foreach (var p in endpoint?.Metadata.GetOrderedMetadata<PermissionAttribute>() ?? [])
            if (!user.Has(p.Code)) throw PmsException.Forbidden();

        await next(http);
    }
}
