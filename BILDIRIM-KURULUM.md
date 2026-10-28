# WellDose — Kilit Ekranı Bildirim Kurulumu (Revizyon 8, taslak)

Bu sürüm **ön yüz + Supabase veritabanı + Edge Function + zamanlanmış görev** birlikte kurulduğunda iPhone ve Android'de uygulama kapalıyken Web Push bildirimi gönderebilir. Sadece `dist` yüklemek yeterli değildir.

**Önemli:** Gerçek iPhone/Android üzerinde test edilinceye kadar bildirimler etkin sayılmamalıdır. Web Push internet erişimine, sistem bildirim iznine, platformun arka plan kısıtlarına ve zamanlanmış görevin çalışmasına bağlıdır. Doz planlamada kritik/tek güvenilir alarm olarak kullanılmamalıdır. Bildirimde ilaç adı veya doz yazılmaz.

## 1. Anahtar çiftini kendi Mac'inde oluştur

Terminal'de `node` kullanarak P-256 anahtarını oluştur. Komutu çalıştırınca **PUBLIC KEY** ve **PRIVATE KEY** görünecek. PRIVATE KEY'i sohbet, ekran görüntüsü veya GitHub'a koyma.

```bash
node -e 'const {generateKeyPairSync}=require("node:crypto");const {publicKey,privateKey}=generateKeyPairSync("ec",{namedCurve:"prime256v1"});const p=publicKey.export({format:"jwk"}),s=privateKey.export({format:"jwk"});console.log("PUBLIC KEY:",Buffer.concat([Buffer.from([4]),Buffer.from(p.x,"base64url"),Buffer.from(p.y,"base64url")]).toString("base64url"));console.log("PRIVATE KEY:",s.d);'
```

`src/push-config.ts` içindeki `PUSH_VAPID_PUBLIC_KEY` değerine yalnızca **PUBLIC KEY** yazılacak. `PRIVATE KEY` **sadece Supabase Edge Function Secrets** içine konacak.

## 2. Veritabanını hazırla

Supabase'de **WellDose projesi → SQL Editor** bölümünde `push_notifications.sql` dosyasını çalıştır. Bu, yalnızca bildirime ait iki yeni tablo ekler; önceki sağlık kayıtlarını değiştirmez.

Sonra **Table Editor**'da `push_subscriptions`, `push_deliveries` tablolarının oluştuğunu ve ikisinde RLS'nin açık olduğunu doğrula.

## 3. Edge Function ve sunucu sırları

Supabase **Edge Functions**'da `send-welldose-push` fonksiyonunu `supabase/functions/send-welldose-push/index.ts` dosyasından yayımla (CLI veya Dashboard). Bu fonksiyon için **Verify JWT kapalı** olmalı; çağrılar içeride güçlü, gizli `x-welldose-job-secret` başlığıyla doğrulanır.

**Supabase Edge Function Secrets** alanına aşağıdakileri gir:

| Anahtar | Değer |
|---|---|
| `WELLDOSE_VAPID_PUBLIC_KEY` | Birinci adımda ürettiğin public key |
| `WELLDOSE_VAPID_PRIVATE_KEY` | Sadece burada saklanacak private key |
| `WELLDOSE_VAPID_SUBJECT` | `mailto:` ile başlayan ulaşılabilir e-posta adresin |
| `WELLDOSE_PUSH_JOB_SECRET` | Rastgele oluşturulmuş uzun ve gizli bir değer |

Supabase tarafından sağlanan `SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY` (veya `SUPABASE_SECRET_KEYS`) otomatik olarak fonksiyonda bulunmalı. **Bu anahtarları asla Vite uygulamasına, GitHub'a veya Netlify'ın statik `dist` klasörüne koyma.**

## 4. Her dakika sunucudan tetikle

Supabase **Integrations → Cron** bölümünden 1 dakikada bir çalışan bir HTTP isteği oluştur:

- Method: `POST`
- URL: `https://<YOUR-SUPABASE-PROJECT>.supabase.co/functions/v1/send-welldose-push`
- HTTP header: `x-welldose-job-secret: <WELLDOSE_PUSH_JOB_SECRET>`
- Schedule: `* * * * *`

Kendi Supabase proje adresini kullan. Sır değerini **yalnızca yönetim ekranına** gir. Zamanlayıcının başarılı çalıştığını Cron History ve Edge Function Logs üzerinden kontrol et. Gecikme toleransı 5 dakikadır; daha uzun kesinti sırasında kaçan hatırlatmalar geriye dönük gönderilmez.

## 5. Mac'te ön yüzü derle ve var olan Netlify sitesine yükle

```bash
cd "$HOME/Downloads/welldose_accounts"
npm run build
```

Netlify'da **mevcut** `welldose.netlify.app` sitesinin dağıtım sayfasına sadece `dist` klasörünü yükle. `src/push-config.ts` dosyasında public key boşsa buton kurulum eksik uyarısı verir.

## 6. iPhone/Android testi

1. iPhone Safari'de `https://welldose.netlify.app` → **Paylaş → Ana Ekrana Ekle**; WellDose'u ana ekran simgesinden aç. Android Chrome'da **Yükle / Ana Ekrana ekle**.
2. Giriş yap → **Tedavi** sayfasının altına kaydır → **Bu cihazda bildirimleri aç** → izin ver.
3. **En az 5 dakika sonraya** sahte/ilaç içermeyen bir test hatırlatması oluştur (`Deneme bildirimi` gibi). **Enjeksiyon kaydı oluşturma, doz alındı olarak işaretleme.**
4. WellDose'u kapat, telefon ekranını kilitle, zamanı bekle. **Genel** metinli tek bildirim gelmeli; gerçek ilaç adı/dozu görünmemeli.
5. Telefonun Bildirim Ayarları'nı ve Supabase Cron/Function Logs'u kontrol et. Eğer bildirim gelmezse yeniden kurma yerine loglardaki hatayla incele.

## Bilinen sınırlar

- Bu sistem bildirim yolları sağlar; kesintisiz çalan, zorunlu sesli **yerel saat alarmı** değildir. iOS Sessiz/Focus modları ve telefonun bildirim ayarları sesi bastırabilir.
- Tekrarlayan hatırlatmalar şu an **sabit 24 saatlik UTC aralıklarla** hesaplanır. Saat dilimi/yaz saati değişikliklerinde yerel saatin sabit kalması ayrıca geliştirilmelidir.
- Bildirim kurmak için her cihazda ayrı izin gerekir; **cihazda kapat** yalnızca o cihazı etkiler.
- Hatırlatma hiçbir zaman ilacın gerçekten alındığı anlamına gelmez.
- Kullanıcıya ait tüm sağlık kayıtları mevcut Supabase RLS kuralları altında kalır. Push servislerine ilaç adı, doz, rapor veya kullanıcı profili gönderilmez.
