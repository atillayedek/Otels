using System.Net.Http.Json;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using HotelPms.Shared;

namespace HotelPms.Manager;

public sealed record HealthCheck(string Name, string Status, string Message);
public sealed record ConnectedClient(Guid ConnectionId, Guid UserId, string Username, Guid? DeviceId, string? Hostname, string? Ip, DateTime ConnectedAt);
public sealed record ManageStatus(string Status, string Hostname, List<string> Addresses, int HttpsPort, int HttpPort, string Version,
    string? DatabaseVersion, string SchemaVersion, bool DatabaseReady, string? StartupError, TimeSpan Uptime, int ConnectedClients,
    List<ConnectedClient> Clients, int ActiveSessions, List<string> LoggedInUsers, long DatabaseSizeBytes, DateTime? LastBackupAt,
    string? LastBackupStatus, long FreeDiskBytes, long TotalDiskBytes, long MemoryBytes, double CpuPercent, List<HealthCheck> Checks,
    string DataRoot, string BackupDirectory, string? SetupCode, string LogsDirectory, string? License = null, bool LicenseRestricted = false);
public sealed record BackupManifest(string Format, Guid Id, string Kind, DateTime CreatedAt, string AppVersion, string SchemaVersion,
    string DatabaseName, string DumpSha256, long DumpBytes, int StorageFiles, string MachineName);
public sealed record BackupFileInfo(string Path, string FileName, long SizeBytes, DateTime ModifiedAt, BackupManifest? Manifest, string? Problem);
sealed record ErrorBody(string? Code, string? Message, string? ErrorId);

public sealed class ManageException(string message) : Exception(message);

/// <summary>
/// Sunucunun yalnız 127.0.0.1'den erişilebilen yönetim API'si. Kimlik: sunucu gizli deposundaki yönetim anahtarı.
/// TLS sunucunun kendi yerel sertifika otoritesine karşı doğrulanır.
/// </summary>
public sealed class ManageClient : IDisposable
{
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    readonly HttpClient _http;

    public PmsPaths Paths { get; }
    public ServerConfig Config { get; }

    public ManageClient()
    {
        Paths = new PmsPaths();
        Config = ServerConfig.Load(Paths);
        var handler = new HttpClientHandler { ServerCertificateCustomValidationCallback = (_, cert, _, _) => ValidateAgainstLocalCa(cert) };
        _http = new HttpClient(handler) { BaseAddress = new Uri($"https://127.0.0.1:{Config.HttpsPort}"), Timeout = TimeSpan.FromMinutes(30) };
    }

    bool ValidateAgainstLocalCa(X509Certificate2? cert)
    {
        if (cert is null || !File.Exists(Paths.CaCertFile)) return false;
        using var ca = X509CertificateLoader.LoadCertificateFromFile(Paths.CaCertFile);
        using var chain = new X509Chain();
        chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
        chain.ChainPolicy.CustomTrustStore.Add(ca);
        chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
        return chain.Build(cert);
    }

    string Token()
    {
        var t = new SecretStore(Paths).TryGet(SecretStore.ManageToken);
        return t ?? throw new ManageException("Yönetim anahtarı bulunamadı. Sunucu kurulumu tamamlanmamış olabilir.");
    }

    async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, object? body = null, CancellationToken ct = default)
    {
        using var req = new HttpRequestMessage(method, path);
        req.Headers.Add(PmsConstants.ManageTokenHeader, Token());
        if (body is not null) req.Content = JsonContent.Create(body, options: Json);
        HttpResponseMessage res;
        try { res = await _http.SendAsync(req, ct); }
        catch (HttpRequestException) { throw new ManageException("Sunucu hizmetine bağlanılamadı. Hizmet çalışmıyor olabilir."); }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested) { throw new ManageException("Sunucu yanıt vermedi (zaman aşımı)."); }
        if (res.IsSuccessStatusCode) return res;
        ErrorBody? err = null;
        try { err = await res.Content.ReadFromJsonAsync<ErrorBody>(Json, ct); } catch (JsonException) { } catch (NotSupportedException) { }
        var msg = err?.Message ?? $"İşlem başarısız ({(int)res.StatusCode}).";
        if (err?.ErrorId is { } id && (int)res.StatusCode >= 500) msg += $" Hata kodu: {id}";
        res.Dispose();
        throw new ManageException(msg);
    }

    public async Task<ManageStatus> StatusAsync(CancellationToken ct = default)
    {
        using var r = await SendAsync(HttpMethod.Get, "/api/v1/manage/status", ct: ct);
        return (await r.Content.ReadFromJsonAsync<ManageStatus>(Json, ct))!;
    }

    public async Task<string> LogsAsync(int lines)
    {
        using var r = await SendAsync(HttpMethod.Get, $"/api/v1/manage/logs?lines={lines}");
        return await r.Content.ReadAsStringAsync();
    }

    public async Task<List<BackupFileInfo>> BackupsAsync()
    {
        using var r = await SendAsync(HttpMethod.Get, "/api/v1/manage/backups");
        return (await r.Content.ReadFromJsonAsync<List<BackupFileInfo>>(Json))!;
    }

    public async Task BackupAsync() { using var _ = await SendAsync(HttpMethod.Post, "/api/v1/manage/backup"); }

    public async Task RestoreAsync(string file, string confirmation)
    {
        using var _ = await SendAsync(HttpMethod.Post, "/api/v1/manage/restore", new { filePath = file, confirmation });
    }

    public async Task<long> MaintenanceAsync(string task)
    {
        using var r = await SendAsync(HttpMethod.Post, $"/api/v1/manage/maintenance/{task}");
        var doc = await r.Content.ReadFromJsonAsync<JsonElement>(Json);
        return doc.TryGetProperty("elapsedMs", out var e) ? e.GetInt64() : 0;
    }

    public async Task EmergencyResetAsync(string username, string password)
    {
        using var _ = await SendAsync(HttpMethod.Post, "/api/v1/manage/emergency-password-reset", new { username, newPassword = password });
    }

    public string? CaFingerprint()
    {
        if (!File.Exists(Paths.CaCertFile)) return null;
        try { return new CertificateManager(Paths, new SecretStore(Paths)).CaFingerprintSha256(); }
        catch (Exception) { return null; }
    }

    public void Dispose() => _http.Dispose();
}
