use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::Shared;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ServerEntry {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    /// Sunucunun yerel CA sertifikası (PEM, yalnız açık anahtar). Bağlantılar bu CA'ya sabitlenir.
    pub ca_pem: String,
    pub ca_fingerprint: String,
    pub added_at: String,
}

impl ServerEntry {
    pub fn base_url(&self) -> String {
        let host = if self.host.contains(':') && !self.host.starts_with('[') { format!("[{}]", self.host) } else { self.host.clone() };
        if self.port == 443 { format!("https://{host}") } else { format!("https://{host}:{}", self.port) }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClientConfig {
    pub device_id: String,
    pub servers: Vec<ServerEntry>,
    pub active_server_id: Option<String>,
}

impl ClientConfig {
    pub fn load_or_create(path: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        if path.exists() {
            let text = std::fs::read_to_string(path)?;
            if let Ok(cfg) = serde_json::from_str::<ClientConfig>(&text) {
                return Ok(cfg);
            }
            // Bozuk yapılandırma silinmez; yedeklenip yenisi oluşturulur.
            std::fs::rename(path, path.with_extension("json.bozuk"))?;
        }
        let cfg = ClientConfig { device_id: uuid::Uuid::new_v4().to_string(), servers: vec![], active_server_id: None };
        cfg.save(path)?;
        Ok(cfg)
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self).expect("yapılandırma serileştirilemedi"))?;
        std::fs::rename(tmp, path)
    }

    pub fn active(&self) -> Option<&ServerEntry> {
        let id = self.active_server_id.as_ref()?;
        self.servers.iter().find(|s| &s.id == id)
    }
}

pub fn machine_name() -> String {
    hostname::get().ok().and_then(|h| h.into_string().ok()).unwrap_or_else(|| "PMS-CLIENT".into())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInfo {
    device_id: String,
    hostname: String,
    version: String,
    active_server: Option<ServerEntry>,
}

#[tauri::command]
pub async fn client_info(state: tauri::State<'_, Shared>) -> Result<ClientInfo, String> {
    let s = state.lock().await;
    Ok(ClientInfo {
        device_id: s.config.device_id.clone(),
        hostname: machine_name(),
        version: env!("CARGO_PKG_VERSION").into(),
        active_server: s.config.active().cloned(),
    })
}

#[tauri::command]
pub async fn list_servers(state: tauri::State<'_, Shared>) -> Result<(Vec<ServerEntry>, Option<String>), String> {
    let s = state.lock().await;
    Ok((s.config.servers.clone(), s.config.active_server_id.clone()))
}

#[tauri::command]
pub async fn save_server(state: tauri::State<'_, Shared>, entry: ServerEntry, make_active: bool) -> Result<ServerEntry, String> {
    if entry.host.trim().is_empty() || entry.port == 0 {
        return Err("Sunucu adresi ve port zorunludur.".into());
    }
    crate::net::tls_config(&entry.ca_pem)?;
    let mut s = state.lock().await;
    let mut e = entry;
    if e.id.is_empty() {
        e.id = uuid::Uuid::new_v4().to_string();
    }
    s.config.servers.retain(|x| x.id != e.id);
    s.config.servers.push(e.clone());
    if make_active || s.config.active_server_id.is_none() {
        s.config.active_server_id = Some(e.id.clone());
        s.token = None;
    }
    s.config.save(&s.config_path).map_err(|err| format!("Yapılandırma kaydedilemedi: {err}"))?;
    Ok(e)
}

#[tauri::command]
pub async fn remove_server(state: tauri::State<'_, Shared>, id: String) -> Result<(), String> {
    let mut s = state.lock().await;
    s.config.servers.retain(|x| x.id != id);
    if s.config.active_server_id.as_deref() == Some(id.as_str()) {
        s.config.active_server_id = s.config.servers.first().map(|x| x.id.clone());
        s.token = None;
    }
    s.config.save(&s.config_path).map_err(|err| format!("Yapılandırma kaydedilemedi: {err}"))
}

#[tauri::command]
pub async fn set_active_server(state: tauri::State<'_, Shared>, id: String) -> Result<(), String> {
    let mut s = state.lock().await;
    if !s.config.servers.iter().any(|x| x.id == id) {
        return Err("Sunucu bulunamadı.".into());
    }
    s.config.active_server_id = Some(id);
    s.token = None;
    if let Some(h) = s.realtime.take() {
        h.abort();
    }
    s.config.save(&s.config_path).map_err(|err| format!("Yapılandırma kaydedilemedi: {err}"))
}
