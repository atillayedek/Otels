# Ferrolit Restoran (Android)

Garson tableti/telefonu için adisyon uygulaması. Arayüz `desktop-client` ile aynı kaynaktan restoran modunda derlenir
(`npm run build:restaurant` → `desktop-client/dist-restaurant`); Rust bağlantı katmanı `desktop-client/src-tauri/src` modülleridir.

Derleme (repo yolu Türkçe karakter içerdiğinden ASCII bir bağlantı klasörü üzerinden):

1. `desktop-client` içinde `npm run build:restaurant`
2. `mklink /J C:\Users\<kullanıcı>\hprest <repo>\restaurant-app`
3. Bağlantı klasöründe: `npx --prefix <repo>\desktop-client tauri android build --apk --target aarch64`
   (ANDROID_HOME, NDK_HOME ve RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc tanımlı olmalı)

İmzalama PMS Android uygulamasıyla aynı anahtarı kullanır: `src-tauri/gen/android/keystore.properties` (Git'e eklenmez).
