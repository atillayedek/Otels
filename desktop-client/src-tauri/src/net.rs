use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::config::{machine_name, ServerEntry};
use crate::Shared;

/// Yalnız verilen CA'ya güvenen TLS yapılandırması.
pub fn tls_config(ca_pem: &str) -> Result<Arc<rustls::ClientConfig>, String> {
    let mut roots = rustls::RootCertStore::empty();
    let mut reader = ca_pem.as_bytes();
    let mut count = 0;
    for cert in rustls_pemfile::certs(&mut reader) {
        let cert = cert.map_err(|_| "Sunucu CA sertifikası okunamadı.".to_string())?;
        roots.add(cert).map_err(|_| "Sunucu CA sertifikası geçersiz.".to_string())?;
        count += 1;
    }
    if count == 0 {
        return Err("Sunucu CA sertifikası bulunamadı.".into());
    }
    let cfg = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(Arc::new(cfg))
}

fn pinned_client(server: &ServerEntry, timeout: Duration) -> Result<reqwest::Client, String> {
    let cfg = tls_config(&server.ca_pem)?;
    reqwest::Client::builder()
        .use_preconfigured_tls((*cfg).clone())
        .connect_timeout(Duration::from_secs(5))
        .timeout(timeout)
        .user_agent(concat!("Ferrolit-PMS-Client/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

fn fingerprint(ca_pem: &str) -> Result<String, String> {
    let mut reader = ca_pem.as_bytes();
    let der = rustls_pemfile::certs(&mut reader).next().ok_or("CA sertifikası yok")?.map_err(|_| "CA sertifikası okunamadı")?;
    Ok(hex::encode_upper(Sha256::digest(der.as_ref())))
}

/// Ağ hatasını kullanıcıya anlaşılır Türkçe mesaja çevirir (teknik ayrıntı gösterilmez).
fn describe(e: &reqwest::Error) -> String {
    let text = format!("{e:?}").to_lowercase();
    if e.is_timeout() {
        "Sunucu zamanında yanıt vermedi.".into()
    } else if text.contains("certificate") || text.contains("invalidcertificate") || text.contains("unknownissuer") || text.contains("notvalidforname") {
        "Sunucu sertifikası doğrulanamadı. Sunucu değişmiş olabilir; bağlantıyı Ayarlar'dan yeniden ekleyin.".into()
    } else if e.is_connect() {
        "Sunucuya bağlanılamadı. Sunucunun açık olduğunu, adres/port bilgisini ve güvenlik duvarını kontrol edin.".into()
    } else {
        "Sunucuyla iletişim kurulamadı.".into()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    info: Value,
    ca_pem: String,
    ca_fingerprint: String,
    fingerprint_matches_server: bool,
}

/// İlk tanışma: sunucu bilgisi ve CA sertifikası doğrulamasız alınır, parmak izi kullanıcıya gösterilir.
/// Kullanıcı parmak izini Server Manager ekranındakiyle karşılaştırıp onaylamadan bağlantı kaydedilmez.
#[tauri::command]
pub async fn probe_server(host: String, port: u16) -> Result<ProbeResult, String> {
    let host = host.trim().to_string();
    if host.is_empty() {
        return Err("Sunucu adı veya IP adresi girin.".into());
    }
    let entry = ServerEntry { id: String::new(), name: String::new(), host, port, ca_pem: String::new(), ca_fingerprint: String::new(), added_at: String::new() };
    let insecure = reqwest::Client::builder()
        .use_rustls_tls()
        .danger_accept_invalid_certs(true)
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let base = entry.base_url();
    let info: Value = insecure.get(format!("{base}/api/v1/system/info")).send().await.map_err(|e| describe(&e))?
        .json().await.map_err(|_| "Bu adreste bir PMS sunucusu bulunamadı.".to_string())?;
    if info.get("product").and_then(|p| p.as_str()) != Some("HotelPMS") {
        return Err("Bu adreste bir PMS sunucusu bulunamadı.".into());
    }
    let ca_pem = insecure.get(format!("{base}/api/v1/system/ca.crt")).send().await.map_err(|e| describe(&e))?
        .text().await.map_err(|e| describe(&e))?;
    let fp = fingerprint(&ca_pem)?;
    let server_fp = info.get("caFingerprintSha256").and_then(|v| v.as_str()).unwrap_or_default().to_uppercase();
    Ok(ProbeResult { info, ca_pem, fingerprint_matches_server: fp == server_fp, ca_fingerprint: fp })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    ok: bool,
    message: String,
    latency_ms: u128,
    server_version: Option<String>,
    compatible: bool,
    database_ready: bool,
    hotel_name: Option<String>,
    setup_required: bool,
}

/// Kayıtlı (veya kaydedilmek üzere olan) bağlantıyı sabitlenmiş CA ile uçtan uca dener.
#[tauri::command]
pub async fn test_connection(entry: ServerEntry) -> Result<TestResult, String> {
    let client = pinned_client(&entry, Duration::from_secs(10))?;
    let base = entry.base_url();
    let started = Instant::now();
    let fail = |m: String| TestResult { ok: false, message: m, latency_ms: 0, server_version: None, compatible: false, database_ready: false, hotel_name: None, setup_required: false };
    let info: Value = match client.get(format!("{base}/api/v1/system/info")).send().await {
        Ok(r) => match r.json().await {
            Ok(v) => v,
            Err(_) => return Ok(fail("Sunucu yanıtı okunamadı.".into())),
        },
        Err(e) => return Ok(fail(describe(&e))),
    };
    let latency = started.elapsed().as_millis();
    let health: Value = match client.get(format!("{base}/api/v1/system/health")).send().await {
        Ok(r) => r.json().await.unwrap_or(Value::Null),
        Err(_) => Value::Null,
    };
    let server_version = info.get("version").and_then(|v| v.as_str()).map(String::from);
    let min_client = info.get("minClientVersion").and_then(|v| v.as_str()).unwrap_or("0.0.0");
    let compatible = version_ge(env!("CARGO_PKG_VERSION"), min_client);
    let database_ready = health.get("database").and_then(|v| v.as_bool()).unwrap_or(false);
    let message = if !compatible {
        "Bu istemci sürümü sunucuyla uyumlu değil. Güncelleme gerekiyor.".to_string()
    } else if !database_ready {
        "Sunucuya ulaşıldı ancak veritabanı şu an kullanılamıyor.".to_string()
    } else {
        format!("Bağlantı başarılı ({latency} ms).")
    };
    Ok(TestResult {
        ok: compatible && database_ready,
        message,
        latency_ms: latency,
        server_version,
        compatible,
        database_ready,
        hotel_name: info.get("hotelName").and_then(|v| v.as_str()).map(String::from),
        setup_required: info.get("setupRequired").and_then(|v| v.as_bool()).unwrap_or(false),
    })
}

fn version_ge(a: &str, b: &str) -> bool {
    let p = |s: &str| s.split(['.', '-']).take(3).map(|x| x.parse::<u32>().unwrap_or(0)).collect::<Vec<_>>();
    p(a) >= p(b)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiResponse {
    status: u16,
    body: Value,
}

async fn active_context(state: &tauri::State<'_, Shared>) -> Result<(ServerEntry, Option<String>, String), String> {
    let s = state.lock().await;
    let server = s.config.active().cloned().ok_or("Sunucu bağlantısı tanımlı değil. Ayarlar → Sunucu Bağlantısı'ndan ekleyin.")?;
    Ok((server, s.token.clone(), s.config.device_id.clone()))
}

fn check_path(path: &str) -> Result<(), String> {
    if !path.starts_with("/api/v1/") || path.contains("..") || path.contains("://") {
        return Err("Geçersiz istek yolu.".into());
    }
    Ok(())
}

fn with_headers(rb: reqwest::RequestBuilder, token: &Option<String>, device_id: &str) -> reqwest::RequestBuilder {
    let mut rb = rb
        .header("X-PMS-Device-Id", device_id)
        .header("X-PMS-Hostname", machine_name())
        .header("X-PMS-Client-Version", env!("CARGO_PKG_VERSION"));
    if let Some(t) = token {
        rb = rb.bearer_auth(t);
    }
    rb
}

/// Arayüzün tek API kapısı. Oturum anahtarı burada eklenir; giriş yanıtındaki token arayüze iletilmez.
#[tauri::command]
pub async fn api_request(
    state: tauri::State<'_, Shared>,
    method: String,
    path: String,
    body: Option<Value>,
    idempotency_key: Option<String>,
) -> Result<ApiResponse, String> {
    check_path(&path)?;
    let (server, token, device_id) = active_context(&state).await?;
    let long = path.starts_with("/api/v1/night-audit/run") || path.starts_with("/api/v1/imports") || path.starts_with("/api/v1/backups");
    let client = pinned_client(&server, Duration::from_secs(if long { 900 } else { 60 }))?;
    let m = reqwest::Method::from_bytes(method.to_uppercase().as_bytes()).map_err(|_| "Geçersiz yöntem.")?;
    let mut rb = with_headers(client.request(m, format!("{}{}", server.base_url(), path)), &token, &device_id);
    if let Some(k) = idempotency_key {
        rb = rb.header("Idempotency-Key", k);
    }
    if let Some(b) = body {
        rb = rb.json(&b);
    }
    let resp = rb.send().await.map_err(|e| describe(&e))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| describe(&e))?;
    let mut body: Value = if text.is_empty() { Value::Null } else { serde_json::from_str(&text).unwrap_or(Value::String(text)) };

    if path == "/api/v1/auth/login" && status == 200 {
        let t = body.get("token").and_then(|v| v.as_str()).map(String::from);
        state.lock().await.token = t;
        body = body.get("user").cloned().unwrap_or(Value::Null);
    } else if path == "/api/v1/auth/logout" || status == 401 {
        let mut s = state.lock().await;
        s.token = None;
        if let Some(h) = s.realtime.take() {
            h.abort();
        }
    }
    Ok(ApiResponse { status, body })
}

/// Dosya yükleme (veri aktarımı, belge). Dosya yolu yerel dosya seçme diyaloğundan gelir.
#[tauri::command]
pub async fn api_upload(
    state: tauri::State<'_, Shared>,
    path: String,
    file_path: String,
    fields: HashMap<String, String>,
) -> Result<ApiResponse, String> {
    check_path(&path)?;
    let (server, token, device_id) = active_context(&state).await?;
    let client = pinned_client(&server, Duration::from_secs(900))?;
    let bytes = tokio::fs::read(&file_path).await.map_err(|_| "Dosya okunamadı.".to_string())?;
    let name = std::path::Path::new(&file_path).file_name().and_then(|n| n.to_str()).unwrap_or("dosya").to_string();
    let mut form = reqwest::multipart::Form::new().part("file", reqwest::multipart::Part::bytes(bytes).file_name(name));
    for (k, v) in fields {
        form = form.text(k, v);
    }
    let resp = with_headers(client.post(format!("{}{}", server.base_url(), path)), &token, &device_id)
        .multipart(form).send().await.map_err(|e| describe(&e))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| describe(&e))?;
    let body = if text.is_empty() { Value::Null } else { serde_json::from_str(&text).unwrap_or(Value::String(text)) };
    Ok(ApiResponse { status, body })
}

/// Rapor/dışa aktarma dosyasını kullanıcının seçtiği konuma kaydeder.
#[tauri::command]
pub async fn api_download(state: tauri::State<'_, Shared>, path: String, save_path: String) -> Result<ApiResponse, String> {
    check_path(&path)?;
    let (server, token, device_id) = active_context(&state).await?;
    let client = pinned_client(&server, Duration::from_secs(600))?;
    let resp = with_headers(client.get(format!("{}{}", server.base_url(), path)), &token, &device_id)
        .send().await.map_err(|e| describe(&e))?;
    let status = resp.status().as_u16();
    if status != 200 {
        let text = resp.text().await.unwrap_or_default();
        return Ok(ApiResponse { status, body: serde_json::from_str(&text).unwrap_or(Value::Null) });
    }
    let bytes = resp.bytes().await.map_err(|e| describe(&e))?;
    tokio::fs::write(&save_path, &bytes).await.map_err(|_| "Dosya kaydedilemedi.".to_string())?;
    Ok(ApiResponse { status, body: Value::String(save_path) })
}
