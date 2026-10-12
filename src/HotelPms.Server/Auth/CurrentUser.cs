using System.Net;

namespace HotelPms.Server.Auth;

public sealed record CurrentUser(
    Guid Id,
    string Username,
    string FullName,
    IReadOnlyList<string> Roles,
    IReadOnlySet<string> Permissions,
    Guid SessionId,
    Guid? DeviceId,
    bool MustChangePassword)
{
    public bool Has(string permission) => Permissions.Contains(permission);
}

/// <summary>İstek kapsamındaki kimlik ve cihaz bilgisi (audit kayıtlarına yazılır).</summary>
public sealed class RequestContext
{
    public CurrentUser? User { get; set; }
    public Guid? DeviceId { get; set; }
    public string? Hostname { get; set; }
    public IPAddress? Ip { get; set; }
    public string CorrelationId { get; set; } = Guid.NewGuid().ToString("N")[..12];

    public CurrentUser RequireUser() => User ?? throw new Infrastructure.PmsException(401, "unauthenticated", "Oturum açmanız gerekiyor.");

    public void Require(string permission)
    {
        var u = RequireUser();
        if (!u.Has(permission)) throw Infrastructure.PmsException.Forbidden();
    }
}

[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, AllowMultiple = true)]
public sealed class PermissionAttribute(string code) : Attribute
{
    public string Code { get; } = code;
}

public static class PermissionEndpointExtensions
{
    /// <summary>Uç noktaya sunucu taraflı izin kontrolü ekler. Arayüzde düğme gizlemek yetki değildir.</summary>
    public static TBuilder RequirePermission<TBuilder>(this TBuilder builder, params string[] codes) where TBuilder : IEndpointConventionBuilder
    {
        foreach (var c in codes) builder.WithMetadata(new PermissionAttribute(c));
        return builder;
    }

    public static TBuilder AllowAnonymousPms<TBuilder>(this TBuilder builder) where TBuilder : IEndpointConventionBuilder =>
        builder.WithMetadata(new AnonymousPmsAttribute());
}

[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public sealed class AnonymousPmsAttribute : Attribute;
