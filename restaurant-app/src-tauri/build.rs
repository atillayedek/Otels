//! PMS istemcisinin bağlantı modüllerini (config, discovery, net, realtime) bu uygulamaya dahil eder.
//! Derleme Türkçe karakterli repo yolu yerine ASCII bir bağlantı klasöründen (junction) yapılabildiği için
//! göreli yol yerine gerçek (çözümlenmiş) yol kullanılır.
use std::{env, fs, path::PathBuf};

fn main() {
    let manifest = fs::canonicalize(env::var("CARGO_MANIFEST_DIR").unwrap()).unwrap();
    let shared = fs::canonicalize(manifest.join("../../desktop-client/src-tauri/src")).expect("desktop-client/src-tauri/src bulunamadı");
    let mut mods = String::new();
    for m in ["config", "discovery", "net", "realtime"] {
        let file = shared.join(format!("{m}.rs"));
        println!("cargo:rerun-if-changed={}", file.display());
        // Windows'ta canonicalize "\\?\" önekli yol döner; #[path] için düz, ileri eğik çizgili yola çevrilir.
        let p = file.display().to_string();
        let p = p.strip_prefix(r"\\?\").unwrap_or(&p).replace('\\', "/");
        mods.push_str(&format!("#[path = \"{p}\"]\nmod {m};\n"));
    }
    fs::write(PathBuf::from(env::var("OUT_DIR").unwrap()).join("shared_mods.rs"), mods).unwrap();
    tauri_build::build()
}
