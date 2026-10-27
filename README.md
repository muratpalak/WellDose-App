# WellDose Accounts — çok kullanıcılı beta

Bu uygulama, mevcut **sahibine özel WellDose 3.0 Sites sürümünden ayrı** hazırlanmış, gerçek Supabase kullanıcı hesapları kullanan web uygulamasıdır. Mevcut kişisel sağlık verileri buraya **otomatik aktarılmaz**.

## Tamamlananlar

- E-posta ile tek kullanımlık giriş bağlantısı akışı (Supabase Auth)
- Apple ve Google girişleri için hazır, şimdilik **devre dışı** bağlantı düğmeleri
- Her hesap için ayrı vücut ölçümleri ve tedavi günlüğü
- Sağlık bilgilerinin saklanmasına yönelik ilk açık onay ekranı ve sunucuda onay kaydı
- Çoklu cihazda veri okuma/kaydetme, tedavi günlüğünde sürüm çakışması kontrolü
- Kişisel JSON dışa aktarma, kendi sağlık kayıtlarını silme
- Zepp Life ve Apple Sağlık entegrasyonunun henüz otomatik olmadığını belirten açıklamalar

## Ücretsiz güvenlik doğrulaması (27 Ekim 2026)

- Supabase RLS politikaları **dört tabloda** birer hesapla sınırlandı. Geçici A/B test kullanıcılarıyla okuma, başka hesabın kaydını güncelleme ve başka hesaba kayıt ekleme sınandı. Denemeler başarılı; işlem `ROLLBACK` ile geri alındı, test verisi bırakılmadı.
- Uygulama, oturum değiştiğinde veya sağlık kayıtları yüklenemediğinde önceki hesaptan kalan verileri göstermeyecek şekilde güncellendi. Yükleme hatasında **Yeniden dene** ekranı açılır.
- Bağlantı hatasıyla sonuçlanan form kayıtları mevcut form alanlarını temizlemez.
- Verilerin dışa aktarımı artık ilk 500 kayıtla sınırlı değildir: ölçümler sayfalanarak yüklenir. Çok sayıda ölçümün gerçek hesapla denenmesi hâlâ gereklidir.
- Kaynak derlemesi ve temel güvenlik denetimi geçti. Bu, gerçek e-posta teslimi, iki gerçek hesapla tarayıcı testi veya üretim güvenlik sertifikasyonu yerine geçmez.

## Yerel çalıştırma

```bash
npm ci
npm run dev
```

Üretim paketi için `npm run build`. Dağıtılacak statik çıktı `dist/` klasöründedir. Sunucu tarafında Supabase projesi `llfontintakkgztkddlv` kullanılır; kaynakta **yalnızca tarayıcıda kullanılabilen publishable API anahtarı** bulunur. `service_role` anahtarı yoktur ve kesinlikle eklenmemelidir.

## Ücretsiz GitHub Pages yayınına hazırlık

Pakette manuel tetiklenen `.github/workflows/pages.yml` bulunur. GitHub Free, herkese açık depolar için Pages kullanımını destekler. **Henüz yayın tetiklenmedi.** Depoya kaynaklar yüklendikten sonra GitHub deposundaki **Settings → Pages → Build and deployment → Source: GitHub Actions** ayarı gerekir. Önce test ve hukuk kontrollerini bitirin; sonra **Actions → WellDose - ücretsiz GitHub Pages yayını → Run workflow** ile yayınlanabilir.

Proje adresi tipik olarak `https://KULLANICI.github.io/DEPO/` olacaktır. Bu *örnektir*, canlı adres değildir. Yayından önce Supabase **Authentication → URL Configuration** bölümüne tam gerçek adresi hem Site URL hem de izinli yönlendirme adresi olarak ekleyin. `vite.config.ts` ile `/DEPO/` gibi alt dizinler desteklenir; giriş bağlantıları da aynı alt dizine döner. E-posta gönderimini ve iki gerçek kullanıcı ile oturum ayrımını ayrıca test edin. Sağlık kayıtları açılmadan önce nihai KVKK/GDPR belgeleri hazırlanmalıdır.

## Genel kullanıma açılmadan önce

1. Bağımsız bir alan adı ve statik hosting seçip Supabase **Authentication → URL Configuration** içindeki Site URL ve izinli redirect URL'leri dağıtım adresine göre ayarlayın. Mevcut owner-private ChatGPT Site bu uygulamanın yayın adresi değildir.
2. E-posta gönderimi ve gerçek e-posta bağlantısı ile oturum açmayı test edin; canlı kullanımda kendi SMTP sağlayıcınızı ve kötüye kullanım sınırlarını yapılandırın.
3. Apple Developer hesabında App ID, Services ID, callback URL ve signing key oluşturun; Google Cloud'da OAuth Client ID/Secret yapılandırın. Bunlar tamamlandıktan sonra `src/config.ts` içinde ilgili giriş düğmelerini etkinleştirin.
4. Apple Sağlık için ayrı native iOS uygulaması ve HealthKit kullanıcı izni gereklidir. Zepp Life'ın Apple Sağlık'a aktarabildiği ölçümler sürüm/model bazında doğrulanmalıdır.
5. KVKK/GDPR aydınlatma, uygun hukuki dayanak ve ayrı izinler, saklama/silme prosedürü, verilerin yurtdışına aktarılması, yaş koşulları ve erişim denetimleri profesyonel incelemeden geçirilmelidir. Bu beta içindeki kısa onay ekranı nihai hukuk metni **değildir**.
6. Bildirim altyapısı (push/SMS/e-posta), otomatik fiyat güncelleme, arka plan araştırma güncelleme ve OCR entegrasyonu bağımsız uygulama için ayrıca taşınmalıdır. Bu özellikler bu beta pakette **henüz çalışmıyor**.

## Gizlilik / bakım

Veritabanındaki `user_profiles`, `user_consents`, `health_samples` ve `journal_records` tablolarında RLS aktiftir; kullanıcı yalnızca kendi `user_id` kaydına erişir. Client tarafında yetkili sunucu anahtarı bulunmaz. Giriş doğrulamasının, e-posta tesliminin, gerçek iPhone aktarımının ve hukuki yayına hazırlığın ayrıca tamamlanması gerekir.
