# Görev Defteri (Expo / React Native)

Kişisel günlük & haftalık görev + ezber takip uygulaması. Her sabah yerel bildirimle
o günün görevlerini ve "günün ezberi"ni hatırlatır. Veriler telefonda saklanır.

## Kurulum
```bash
npm install
# native sürümleri hizalamak istersen (opsiyonel):
npx expo install --fix
```

## Çalıştırma
```bash
npx expo start
```
- Hızlı önizleme: **Expo Go** ile QR kodu okut.
- ⚠️ **Bildirimler için development build gerekir.** Expo SDK 53+ ile Expo Go'da
  bildirimler kısıtlıdır. Gerçek push için:
  ```bash
  npx expo run:android   # veya: npx expo run:ios (Mac gerekir)
  ```

## Bildirimler
- Gerçek cihazda çalışır (emülatörde/simülatörde çalışmaz).
- İlk açılışta bildirim izni ister. "Bugün" sekmesindeki **Günlük hatırlatma**
  kartından saati ayarlayıp aç → "Kaydet". Her gün o saatte tekrar eder.

## Yapı
- `App.js` — tüm ekran (Bugün / Günlük / Haftalık / Ezber), stiller, veri katmanı.
- Veri: `AsyncStorage` (`gd-config`, `gd-progress`, `gd-remind`).
- Bildirim: `expo-notifications` (günlük tekrar eden yerel bildirim).

## Sonraki adımlar (fikir)
- Bildirim metnini dinamik yap: her sabah o günün görev sayısını + ezberi göster
  (uygulama açıldığında yeniden planlayarak).
- Fişek `firsat-radari`'ndeki n8n + Telegram ile bulut tarafı bir yedek hatırlatma.
- Fraunces/mono font eklemek için: `npx expo install expo-font @expo-google-fonts/fraunces`.

## APK / AAB derleme (indirilebilir dosya)

Derleme bulutta EAS Build ile yapılır (ücretsiz Expo hesabı yeter):

```bash
npm install -g eas-cli      # bir kez
eas login                   # Expo hesabınla giriş (yoksa expo.dev'den aç)
eas init                    # projeyi bağlar, app.json'a projectId ekler

# 1) Doğrudan telefona kurulacak APK (test / sideload):
eas build -p android --profile preview
#   → bitince indirme linki verir → .apk indir → telefona at, kur

# 2) Google Play için AAB (mağaza .apk değil .aab ister):
eas build -p android --profile production
#   → .aab indir → Play Console'a yükle
```

Notlar:
- Play Store için Google Play Developer hesabı gerekir (tek seferlik ~25$).
- İmza anahtarını (keystore) EAS senin için üretir ve saklar; Play App Signing ile uyumlu.
- Sürüm: `eas.json` `autoIncrement` ile versionCode'u otomatik artırır.
- Yerel alternatif (Android SDK kuruluysa): `npx expo prebuild` sonra
  `cd android && ./gradlew assembleRelease` (APK) ya da `./gradlew bundleRelease` (AAB).
