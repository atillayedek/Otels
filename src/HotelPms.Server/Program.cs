using System.Threading.RateLimiting;
using HotelPms.Server;
using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Accounting;
using HotelPms.Server.Modules.Backup;
using HotelPms.Server.Modules.Documents;
using HotelPms.Server.Modules.Folios;
using HotelPms.Server.Modules.Guests;
using HotelPms.Server.Modules.Integrations;
using HotelPms.Server.Modules.Migration;
using HotelPms.Server.Modules.NightAudit;
using HotelPms.Server.Modules.Property;
using HotelPms.Server.Modules.Reports;
using HotelPms.Server.Modules.Reservations;
using HotelPms.Server.Modules.Rooms;
using HotelPms.Server.Modules.Setup;
using HotelPms.Server.Modules.Platform;
using HotelPms.Server.Modules.Pos;
using HotelPms.Server.Modules.Stock;
using HotelPms.Server.Modules.Users;
using HotelPms.Server.Modules.Wifi;
using HotelPms.Server.Realtime;
using HotelPms.Shared;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Npgsql;
using Serilog;
using Serilog.Formatting.Compact;

Console.OutputEncoding = System.Text.Encoding.UTF8;
var paths = new PmsPaths();

// ------------------------------------------------------------------ CLI alt komutları (installer / Server Manager)
if (args.Length > 0 && args[0] is "provision" or "unregister" or "backup" or "renew-cert" or "version" or "stop-postgres")
    return await Cli.RunAsync(args, paths);

paths.EnsureDirectories();
var config = ServerConfig.Load(paths);
var secrets = new SecretStore(paths);
var devHttpOnly = Environment.GetEnvironmentVariable("HOTELPMS_HTTP_ONLY") == "1";

Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .MinimumLevel.Override("Microsoft.AspNetCore", Serilog.Events.LogEventLevel.Warning)
    .MinimumLevel.Override("Microsoft.Hosting.Lifetime", Serilog.Events.LogEventLevel.Information)
    .Enrich.FromLogContext()
    .Enrich.WithProperty("App", "HotelPMS.Server")
    .WriteTo.Console()
    .WriteTo.File(new CompactJsonFormatter(), Path.Combine(paths.LogsDir, "server-.log"), rollingInterval: RollingInterval.Day,
        retainedFileCountLimit: 60, fileSizeLimitBytes: 50_000_000, rollOnFileSizeLimit: true, shared: true)
    .CreateLogger();

try
{
    var builder = WebApplication.CreateBuilder(new WebApplicationOptions
    {
        Args = args,
        ContentRootPath = AppContext.BaseDirectory,
    });
    builder.Host.UseWindowsService(o => o.ServiceName = PmsConstants.ServiceName);
    builder.Host.UseSystemd();
    builder.Host.UseSerilog();

    builder.WebHost.ConfigureKestrel(k =>
    {
        k.AddServerHeader = false;
        k.Limits.MaxRequestBodySize = 30 * 1024 * 1024;
        if (devHttpOnly)
        {
            k.ListenAnyIP(config.HttpPort);
            return;
        }
        var certs = new CertificateManager(paths, secrets);
        if (!certs.HasServerCertificate) certs.EnsureCertificates();
        else certs.EnsureCertificates(); // IP adresi değiştiyse sertifika yenilenir.
        ServerCertificateHolder.Current = certs.LoadServerCertificate();
        k.ListenAnyIP(config.HttpsPort, o =>
        {
            o.Protocols = HttpProtocols.Http1AndHttp2;
            // Sertifika her bağlantıda güncel tutucudan alınır; IP değişince sağlık denetimi yeniler, yeniden başlatma gerekmez.
            o.UseHttps(h => h.ServerCertificateSelector = (_, _) => ServerCertificateHolder.Current);
        });
        if (config.HttpPort > 0) k.ListenAnyIP(config.HttpPort);
    });

    var s = builder.Services;
    s.AddSingleton(paths);
    s.AddSingleton(config);
    s.AddSingleton(secrets);
    var pg = new PostgresTools(paths, config, secrets);
    var dataSource = new NpgsqlDataSourceBuilder(pg.AppConnectionString()).Build();
    s.AddSingleton(dataSource);
    s.AddSingleton<Db>();
    s.AddSingleton<HealthState>();
    s.AddSingleton<RealtimeHub>();
    s.AddSingleton<SessionService>();
    s.AddSingleton<LicenseService>();
    s.AddSingleton<IntegrationRegistry>();
    s.AddSingleton<BackupService>();
    s.AddSingleton<MigrationRunnerFactory>();
    s.AddSingleton<ImportService>();
    s.AddSingleton<WifiService>();
    s.AddScoped<RequestContext>();
    s.AddScoped<CommandRunner>();
    s.AddHttpContextAccessor();
    s.AddHostedService<StartupTasks>();
    s.AddHostedService<HealthMonitor>();
    s.AddHostedService<BackupScheduler>();
    s.AddHostedService<DiscoveryResponder>();
    s.AddSingleton<RadiusServer>();
    s.AddHostedService(sp => sp.GetRequiredService<RadiusServer>());
    s.AddSingleton<WifiPushService>();
    s.AddHostedService(sp => sp.GetRequiredService<WifiPushService>());
    s.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(o => o.MultipartBodyLengthLimit = 210L * 1024 * 1024);
    s.AddExceptionHandler<PmsExceptionHandler>();
    s.AddProblemDetails();
    s.ConfigureHttpJsonOptions(o => Json.Configure(o.SerializerOptions));
    s.AddOpenApi("v1", o => o.AddSchemaTransformer<DecimalAsStringSchemaTransformer>());
    s.AddRateLimiter(o =>
    {
        o.RejectionStatusCode = 429;
        o.AddPolicy("login", ctx => RateLimitPartition.GetFixedWindowLimiter(
            ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
        o.OnRejected = async (ctx, ct) =>
        {
            ctx.HttpContext.Response.StatusCode = 429;
            await ctx.HttpContext.Response.WriteAsJsonAsync(new ErrorResponse("rate_limited", "Çok fazla deneme. Bir dakika sonra tekrar deneyin.", "-"), Json.Options, ct);
        };
    });
    Db.ConfigureDapper();

    var app = builder.Build();

    app.UseExceptionHandler();
    app.Use(async (ctx, next) =>
    {
        // HTTP yalnız HTTPS'e yönlendirme ve CA sertifikası/el sıkışma için açıktır.
        if (!devHttpOnly && !ctx.Request.IsHttps)
        {
            var p = ctx.Request.Path;
            if (!(p.StartsWithSegments("/api/v1/system/ca.crt") || p.StartsWithSegments("/api/v1/system/info") || p.StartsWithSegments("/api/v1/system/health")))
            {
                var host = ctx.Request.Host.Host;
                var port = config.HttpsPort == 443 ? "" : ":" + config.HttpsPort;
                ctx.Response.Redirect($"https://{host}{port}{ctx.Request.PathBase}{ctx.Request.Path}{ctx.Request.QueryString}", permanent: false);
                return;
            }
        }
        var h = ctx.Response.Headers;
        h["X-Content-Type-Options"] = "nosniff";
        h["X-Frame-Options"] = "DENY";
        h["Referrer-Policy"] = "no-referrer";
        h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()";
        h["Cross-Origin-Opener-Policy"] = "same-origin";
        h["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
                                       "font-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";
        if (ctx.Request.Path.StartsWithSegments("/api")) h.CacheControl = "no-store";
        await next();
    });
    app.UseRateLimiter();
    app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(30) });
    app.UseMiddleware<AuthMiddleware>();

    app.MapOpenApi("/api/openapi/{documentName}.json").AllowAnonymousPms();
    SystemEndpoints.Map(app);
    LicenseService.Map(app);
    SetupEndpoints.Map(app);
    AuthEndpoints.Map(app);
    UserEndpoints.Map(app);
    PropertyEndpoints.Map(app);
    RoomEndpoints.Map(app);
    HousekeepingEndpoints.Map(app);
    GuestEndpoints.Map(app);
    PrivacyEndpoints.Map(app);
    AccountEndpoints.Map(app);
    ReservationEndpoints.Map(app);
    GroupEndpoints.Map(app);
    TraceEndpoints.Map(app);
    LostFoundEndpoints.Map(app);
    AllotmentEndpoints.Map(app);
    FolioEndpoints.Map(app);
    ExchangeRateEndpoints.Map(app);
    StockEndpoints.Map(app);
    PosEndpoints.Map(app);
    AccountingEndpoints.Map(app);
    NightAuditEndpoints.Map(app);
    ReportEndpoints.Map(app);
    KbsService.Map(app);
    DocumentEndpoints.Map(app);
    BackupEndpoints.Map(app);
    ImportEndpoints.Map(app);
    WifiEndpoints.Map(app);
    app.Map("/api/v1/realtime", (HttpContext http, RequestContext ctx, RealtimeHub hub) => hub.HandleAsync(http, ctx));
    app.MapFallback("/api/{**rest}", () => Results.Json(new ErrorResponse("not_found", "API ucu bulunamadı.", "-"), Json.Options, statusCode: 404));

    // Sunucu yalnız API sunar; PMS ekranları PMS Client içindedir.
    app.MapGet("/", () => Results.Text("HotelPMS sunucusu çalışıyor. Bu adres yalnız PMS Client tarafından kullanılır.", "text/plain; charset=utf-8"));

    await app.RunAsync();
    return 0;
}
catch (Exception ex) when (ex is not HostAbortedException)
{
    Log.Fatal(ex, "Sunucu başlatılamadı");
    return 1;
}
finally
{
    await Log.CloseAndFlushAsync();
}

namespace HotelPms.Server
{
    /// <summary>Başlangıçta şemayı hazırlar. Hata olursa sunucu çalışmaya devam eder ve durumu raporlar (kör başarı yok).</summary>
    public sealed class StartupTasks(MigrationRunnerFactory migrations, BackupService backups, HealthState health,
        ILogger<StartupTasks> log) : BackgroundService
    {
        protected override async Task ExecuteAsync(CancellationToken ct)
        {
            for (var attempt = 1; !ct.IsCancellationRequested; attempt++)
            {
                try
                {
                    await migrations.Create().ApplyAsync(() => backups.CreateAsync("pre_schema", null, ct), ct);
                    health.StartupError = null;
                    health.DatabaseReady = true;
                    log.LogInformation("Veritabanı şeması güncel ({Version})", MigrationRunner.LatestVersion);
                    return;
                }
                catch (InvalidOperationException ex)
                {
                    // Şema kayması / uyumsuz sürüm: otomatik tekrar denenmez.
                    health.StartupError = ex.Message;
                    log.LogCritical(ex, "Şema doğrulaması başarısız");
                    return;
                }
                catch (Exception ex) when (ex is NpgsqlException or TimeoutException or System.Net.Sockets.SocketException)
                {
                    log.LogWarning("Veritabanına bağlanılamadı (deneme {Attempt}); 5 sn sonra tekrar denenecek: {Message}", attempt, ex.Message);
                    await Task.Delay(TimeSpan.FromSeconds(5), ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    health.StartupError = "Şema güncellemesi başarısız oldu. Ayrıntı sunucu logunda.";
                    log.LogCritical(ex, "Migration başarısız");
                    return;
                }
            }
        }
    }
}
