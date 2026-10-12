using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;

namespace HotelPms.Server.Realtime;

public sealed record RealtimeEvent(string Topic, string? Id);

public sealed record ConnectedClient(Guid ConnectionId, Guid UserId, string Username, Guid? DeviceId, string? Hostname, string? Ip, DateTime ConnectedAt);

/// <summary>
/// LAN içindeki istemcilere WebSocket ile değişiklik bildirimi. Polling kullanılmaz; istemci bildirimi aldığında
/// ilgili veriyi yeniden yükler. Bildirim yalnız konu ve kimlik içerir, kişisel veri taşımaz.
/// </summary>
public sealed class RealtimeHub(ILogger<RealtimeHub> log)
{
    sealed class Conn(ConnectedClient info, WebSocket socket)
    {
        public ConnectedClient Info { get; } = info;
        public WebSocket Socket { get; } = socket;
        public Channel<string> Outbox { get; } = Channel.CreateBounded<string>(new BoundedChannelOptions(500) { FullMode = BoundedChannelFullMode.DropOldest });
    }

    readonly ConcurrentDictionary<Guid, Conn> _conns = new();

    public IReadOnlyList<ConnectedClient> Clients => _conns.Values.Select(c => c.Info).ToList();

    public void Broadcast(RealtimeEvent e)
    {
        var json = JsonSerializer.Serialize(new { type = "change", topic = e.Topic, id = e.Id, at = DateTime.UtcNow }, Json.Options);
        foreach (var c in _conns.Values) c.Outbox.Writer.TryWrite(json);
    }

    /// <summary>Belirli bir kullanıcının/cihazın bağlantısını kapatır (oturum veya cihaz iptali).</summary>
    public void Disconnect(Func<ConnectedClient, bool> predicate)
    {
        foreach (var c in _conns.Values.Where(c => predicate(c.Info)))
        {
            c.Outbox.Writer.TryWrite(JsonSerializer.Serialize(new { type = "session_revoked" }));
            c.Outbox.Writer.TryComplete();
        }
    }

    public async Task HandleAsync(HttpContext http, RequestContext ctx)
    {
        if (!http.WebSockets.IsWebSocketRequest)
        {
            http.Response.StatusCode = 400;
            return;
        }
        var user = ctx.RequireUser();
        using var socket = await http.WebSockets.AcceptWebSocketAsync();
        var info = new ConnectedClient(Guid.NewGuid(), user.Id, user.Username, ctx.DeviceId ?? user.DeviceId, ctx.Hostname, ctx.Ip?.ToString(), DateTime.UtcNow);
        var conn = new Conn(info, socket);
        _conns[info.ConnectionId] = conn;
        log.LogInformation("Gerçek zamanlı bağlantı açıldı {Username} {Ip}", user.Username, info.Ip);
        try
        {
            await conn.Outbox.Writer.WriteAsync(JsonSerializer.Serialize(new { type = "hello", serverTime = DateTime.UtcNow }, Json.Options));
            var sender = SendLoop(conn, http.RequestAborted);
            var receiver = ReceiveLoop(conn, http.RequestAborted);
            await Task.WhenAny(sender, receiver);
        }
        catch (WebSocketException) { }
        catch (OperationCanceledException) { }
        finally
        {
            _conns.TryRemove(info.ConnectionId, out _);
            log.LogInformation("Gerçek zamanlı bağlantı kapandı {Username}", user.Username);
        }
    }

    static async Task SendLoop(Conn conn, CancellationToken ct)
    {
        using var ping = new PeriodicTimer(TimeSpan.FromSeconds(25));
        var pingTask = Task.Run(async () =>
        {
            while (await ping.WaitForNextTickAsync(ct))
                conn.Outbox.Writer.TryWrite("{\"type\":\"ping\"}");
        }, ct);
        await foreach (var msg in conn.Outbox.Reader.ReadAllAsync(ct))
        {
            if (conn.Socket.State != WebSocketState.Open) break;
            await conn.Socket.SendAsync(Encoding.UTF8.GetBytes(msg), WebSocketMessageType.Text, true, ct);
        }
        if (conn.Socket.State == WebSocketState.Open)
            await conn.Socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "closed", CancellationToken.None);
    }

    static async Task ReceiveLoop(Conn conn, CancellationToken ct)
    {
        var buffer = new byte[1024];
        while (conn.Socket.State == WebSocketState.Open)
        {
            var r = await conn.Socket.ReceiveAsync(buffer, ct);
            if (r.MessageType == WebSocketMessageType.Close) break;
        }
    }
}
