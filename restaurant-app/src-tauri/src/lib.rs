//! Ferrolit Restoran: garson tableti/telefonu için adisyon uygulaması.
//! Bağlantı, sertifika sabitleme ve API katmanı PMS istemcisiyle aynıdır (modüller desktop-client'tan derlenir).
//!
//! Güvenlik modeli:
//! - Arayüz (WebView) ağ isteği yapmaz; tüm PMS API ve WebSocket trafiği bu Rust katmanından geçer.
//! - Sunucunun yerel sertifika otoritesi (CA) ilk bağlantıda parmak iziyle gösterilir, kullanıcı onayıyla
//!   istemci yapılandırmasına kaydedilir ve sonraki tüm bağlantılarda yalnız bu CA'ya güvenilir (sabitleme).
//!   Windows sertifika deposu değiştirilmez.
//! - Oturum anahtarı (Bearer token) yalnız bellekte tutulur, arayüze ve diske verilmez.

// config, discovery, net, realtime: build.rs tarafından desktop-client/src-tauri/src altından eklenir.
include!(concat!(env!("OUT_DIR"), "/shared_mods.rs"));

use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

pub struct AppState {
    pub config: config::ClientConfig,
    pub config_path: std::path::PathBuf,
    pub token: Option<String>,
    pub realtime: Option<tauri::async_runtime::JoinHandle<()>>,
}

pub type Shared = Arc<Mutex<AppState>>;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&dir)?;
            let path = dir.join("client.json");
            let cfg = config::ClientConfig::load_or_create(&path)?;
            app.manage::<Shared>(Arc::new(Mutex::new(AppState { config: cfg, config_path: path, token: None, realtime: None })));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            config::client_info,
            config::list_servers,
            config::save_server,
            config::remove_server,
            config::set_active_server,
            discovery::discover_servers,
            net::probe_server,
            net::test_connection,
            net::api_request,
            net::api_upload,
            net::api_download,
            realtime::realtime_start,
            realtime::realtime_stop,
        ])
        .run(tauri::generate_context!())
        .expect("Ferrolit Restoran başlatılamadı");
}
