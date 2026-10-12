use serde_json::Value;
use std::time::Duration;
use tokio::net::UdpSocket;

const PORT: u16 = 47820;
const REQUEST: &[u8] = b"HOTELPMS_DISCOVER_V1";

/// Yerel ağda PMS sunucularını UDP yayınıyla bulur. Yanıtlar yalnız sunucu adı, port, sürüm ve CA parmak izi içerir.
#[tauri::command]
pub async fn discover_servers() -> Result<Vec<Value>, String> {
    let socket = UdpSocket::bind("0.0.0.0:0").await.map_err(|_| "Ağ yayını başlatılamadı.".to_string())?;
    socket.set_broadcast(true).map_err(|e| e.to_string())?;
    for _ in 0..2 {
        let _ = socket.send_to(REQUEST, ("255.255.255.255", PORT)).await;
        let _ = socket.send_to(REQUEST, ("127.0.0.1", PORT)).await;
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
    let mut found: Vec<Value> = Vec::new();
    let mut buf = [0u8; 4096];
    let deadline = tokio::time::Instant::now() + Duration::from_millis(1800);
    loop {
        match tokio::time::timeout_at(deadline, socket.recv_from(&mut buf)).await {
            Ok(Ok((n, from))) => {
                if let Ok(mut v) = serde_json::from_slice::<Value>(&buf[..n]) {
                    if v.get("product").and_then(|p| p.as_str()) != Some("HotelPMS") {
                        continue;
                    }
                    v["replyFrom"] = Value::String(from.ip().to_string());
                    let host = v.get("hostname").cloned();
                    if !found.iter().any(|f| f.get("hostname") == host.as_ref()) {
                        found.push(v);
                    }
                }
            }
            _ => break,
        }
    }
    Ok(found)
}
