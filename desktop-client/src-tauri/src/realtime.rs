use std::time::Duration;

use futures_util::StreamExt;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::Connector;

use crate::Shared;

/// Sunucudan WebSocket ile değişiklik bildirimlerini alır ve arayüze "pms-realtime" olayı olarak iletir.
/// Bağlantı koparsa artan bekleme süreleriyle otomatik yeniden bağlanır; durum "pms-connection" olayıyla bildirilir.
#[tauri::command]
pub async fn realtime_start(app: AppHandle, state: tauri::State<'_, Shared>) -> Result<(), String> {
    let shared = state.inner().clone();
    let mut s = state.lock().await;
    if let Some(h) = s.realtime.take() {
        h.abort();
    }
    let handle = tauri::async_runtime::spawn(async move {
        let mut attempt: u32 = 0;
        loop {
            let (server, token, device_id) = {
                let s = shared.lock().await;
                match (s.config.active().cloned(), s.token.clone()) {
                    (Some(srv), Some(t)) => (srv, t, s.config.device_id.clone()),
                    _ => return,
                }
            };
            let url = format!("{}/api/v1/realtime", server.base_url()).replacen("https://", "wss://", 1);
            let result = async {
                let tls = crate::net::tls_config(&server.ca_pem)?;
                let mut req = url.as_str().into_client_request().map_err(|e| e.to_string())?;
                let h = req.headers_mut();
                h.insert("Authorization", HeaderValue::from_str(&format!("Bearer {token}")).map_err(|e| e.to_string())?);
                h.insert("X-PMS-Device-Id", HeaderValue::from_str(&device_id).map_err(|e| e.to_string())?);
                let (ws, _) = tokio_tungstenite::connect_async_tls_with_config(req, None, false, Some(Connector::Rustls(tls)))
                    .await
                    .map_err(|e| e.to_string())?;
                Ok::<_, String>(ws)
            }
            .await;
            match result {
                Ok(mut ws) => {
                    attempt = 0;
                    let _ = app.emit("pms-connection", json!({ "connected": true }));
                    while let Some(msg) = ws.next().await {
                        match msg {
                            Ok(m) if m.is_text() => {
                                if let Ok(v) = serde_json::from_str::<Value>(m.to_text().unwrap_or("{}")) {
                                    if v.get("type").and_then(|t| t.as_str()) == Some("session_revoked") {
                                        shared.lock().await.token = None;
                                        let _ = app.emit("pms-session-revoked", json!({}));
                                        return;
                                    }
                                    let _ = app.emit("pms-realtime", v);
                                }
                            }
                            Ok(m) if m.is_close() => break,
                            Ok(_) => {}
                            Err(_) => break,
                        }
                    }
                    let _ = app.emit("pms-connection", json!({ "connected": false }));
                }
                Err(_) => {
                    let _ = app.emit("pms-connection", json!({ "connected": false }));
                }
            }
            attempt = (attempt + 1).min(6);
            let wait = [1u64, 2, 3, 5, 8, 10, 15][attempt as usize];
            tokio::time::sleep(Duration::from_secs(wait)).await;
        }
    });
    s.realtime = Some(handle);
    Ok(())
}

#[tauri::command]
pub async fn realtime_stop(state: tauri::State<'_, Shared>) -> Result<(), String> {
    if let Some(h) = state.lock().await.realtime.take() {
        h.abort();
    }
    Ok(())
}
