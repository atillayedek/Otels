using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Dapper;
using HotelPms.Server.Auth;
using HotelPms.Server.Realtime;
using Npgsql;

namespace HotelPms.Server.Infrastructure;

/// <summary>
/// Kritik bir komutun transaction kapsamı. Tüm sorgular aynı transaction içinde çalışır;
/// audit kaydı ve idempotency sonucu da aynı transaction'a yazılır. Commit olmadan istemciye başarı dönmez.
/// </summary>
public sealed class Tx
{
    internal Tx(NpgsqlConnection c, NpgsqlTransaction t, RequestContext ctx)
    {
        Conn = c;
        Transaction = t;
        Ctx = ctx;
    }

    public NpgsqlConnection Conn { get; }
    public NpgsqlTransaction Transaction { get; }
    public RequestContext Ctx { get; }
    public CurrentUser User => Ctx.RequireUser();
    internal List<RealtimeEvent> Events { get; } = [];

    CommandDefinition Def(string sql, object? p) => new(sql, p, Transaction);

    public Task<int> ExecAsync(string sql, object? p = null) => Conn.ExecuteAsync(Def(sql, p));
    public Task<T?> ScalarAsync<T>(string sql, object? p = null) => Conn.ExecuteScalarAsync<T>(Def(sql, p));
    public Task<T> OneAsync<T>(string sql, object? p = null) => Conn.QuerySingleAsync<T>(Def(sql, p));
    public Task<T?> OneOrNullAsync<T>(string sql, object? p = null) => Conn.QuerySingleOrDefaultAsync<T>(Def(sql, p));
    public async Task<List<T>> ListAsync<T>(string sql, object? p = null) => (await Conn.QueryAsync<T>(Def(sql, p))).AsList();

    /// <summary>Optimistic concurrency: etkilenen satır yoksa kayıt başkası tarafından değiştirilmiştir.</summary>
    public async Task ExecVersionedAsync(string sql, object p)
    {
        if (await ExecAsync(sql, p) == 0) throw PmsException.Concurrency();
    }

    public Task AuditAsync(string action, string entityType, object? entityId, object? oldValue = null, object? newValue = null, string? reason = null) =>
        ExecAsync("""
            INSERT INTO pms.audit_log (user_id, username, device_id, hostname, ip, action, entity_type, entity_id, old_value, new_value, reason, correlation_id)
            VALUES (@uid, @uname, @device, @host, @ip::inet, @action, @etype, @eid, @old::jsonb, @new::jsonb, @reason, @corr)
            """, new
        {
            uid = Ctx.User?.Id,
            uname = Ctx.User?.Username,
            device = Ctx.DeviceId,
            host = Ctx.Hostname,
            ip = Ctx.Ip?.ToString(),
            action,
            etype = entityType,
            eid = entityId?.ToString(),
            old = oldValue is null ? null : JsonSerializer.Serialize(oldValue, Json.Options),
            @new = newValue is null ? null : JsonSerializer.Serialize(newValue, Json.Options),
            reason,
            corr = Ctx.CorrelationId,
        });

    /// <summary>Commit sonrası LAN'daki diğer istemcilere bildirilecek değişiklik.</summary>
    public void Publish(string topic, object? id = null) => Events.Add(new RealtimeEvent(topic, id?.ToString()));

    public Task LockAsync(string scope, Guid id) =>
        ExecAsync("SELECT pg_advisory_xact_lock(hashtext(@scope), hashtext(@id))", new { scope, id = id.ToString() });
}

public sealed class CommandRunner(Db db, RequestContext ctx, RealtimeHub hub, IHttpContextAccessor http, ILogger<CommandRunner> log)
{
    public const string IdempotencyHeader = "Idempotency-Key";

    /// <summary>
    /// Komutu tek transaction içinde çalıştırır.
    /// <paramref name="requireKey"/> true ise Idempotency-Key başlığı zorunludur: aynı kullanıcı + anahtar + istek
    /// ikinci kez geldiğinde (çift tıklama, ağ yeniden denemesi) işlem tekrar uygulanmaz, ilk sonuç döner.
    /// </summary>
    public async Task<IResult> RunAsync<T>(string action, object? request, Func<Tx, Task<T>> body, bool requireKey = true,
        IsolationLevel isolation = IsolationLevel.ReadCommitted)
    {
        var user = ctx.RequireUser();
        var key = http.HttpContext?.Request.Headers[IdempotencyHeader].ToString();
        if (string.IsNullOrWhiteSpace(key))
        {
            if (requireKey) throw PmsException.Validation("İşlem anahtarı (Idempotency-Key) eksik.");
            key = null;
        }
        else if (key.Length is < 8 or > 100) throw PmsException.Validation("İşlem anahtarı geçersiz.");

        var requestHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(action + "|" + JsonSerializer.Serialize(request, Json.Options))));

        await using var c = await db.OpenAsync();
        await using var t = await c.BeginTransactionAsync(isolation);
        var tx = new Tx(c, t, ctx);

        if (key is not null)
        {
            var inserted = await tx.ScalarAsync<int?>("""
                INSERT INTO pms.idempotency_keys (user_id, key, action, request_hash, status_code, response)
                VALUES (@uid, @key, @action, @hash, 0, '{}') ON CONFLICT DO NOTHING RETURNING 1
                """, new { uid = user.Id, key, action, hash = requestHash });
            if (inserted is null)
            {
                var prev = await tx.OneAsync<(string Action, string RequestHash, int StatusCode, string Response)>(
                    "SELECT action, request_hash, status_code, response::text FROM pms.idempotency_keys WHERE user_id = @uid AND key = @key",
                    new { uid = user.Id, key });
                await t.RollbackAsync();
                if (prev.Action != action || prev.RequestHash != requestHash)
                    throw PmsException.Conflict("Bu işlem anahtarı farklı bir istek için kullanılmış.", "idempotency_mismatch");
                log.LogInformation("Tekrarlanan istek ilk sonuçla yanıtlandı {Action} {Key}", action, key);
                return Results.Text(prev.Response, "application/json", Encoding.UTF8, prev.StatusCode);
            }
        }

        T result = await body(tx);
        var json = JsonSerializer.Serialize(result, Json.Options);
        if (key is not null)
            await tx.ExecAsync("UPDATE pms.idempotency_keys SET status_code = 200, response = @json::jsonb WHERE user_id = @uid AND key = @key",
                new { json, uid = user.Id, key });
        await t.CommitAsync();

        foreach (var e in tx.Events.Distinct()) hub.Broadcast(e);
        return Results.Text(json, "application/json", Encoding.UTF8, 200);
    }

    /// <summary>Okuma amaçlı transaction gerektiren işlemler için (ör. tutarlı rapor anlık görüntüsü).</summary>
    public async Task<T> ReadAsync<T>(Func<Tx, Task<T>> body)
    {
        await using var c = await db.OpenAsync();
        await using var t = await c.BeginTransactionAsync(IsolationLevel.RepeatableRead);
        var r = await body(new Tx(c, t, ctx));
        await t.CommitAsync();
        return r;
    }
}
