# WellDose Accounts — bağımsız test yayını

**Bu bir test planıdır, halka açık sağlık uygulaması yayını için onay değildir.**

## 1. Statik yayın

- Kaynak kodun kökü: `welldose_accounts/`
- Kurulum: `npm ci`
- Derleme: `npm run build`
- Çıktı: `dist/`
- `vercel.json` ve `netlify.toml` hazırlanmıştır. Bunlar kendiliğinden bir hesap açmaz, alan adı veya ücretli abonelik satın almaz.
- Bağımsız test adresi seçilmeden mevcut ChatGPT Sites adresi değiştirilmez. Sites'in dahili giriş yönetimi bağımsız Supabase OAuth oturumu yerine kullanılamaz.

## 2. E-posta girişinin açılması

WellDose Supabase proje kimliği: `llfontintakkgztkddlv`.

1. Test adresini aldıktan sonra **Supabase → Authentication → URL Configuration** içinde `Site URL` ve **Redirect URLs** listesinde bu adresin kesin kökenini (örneğin `https://beta.ornekalanadi.com`) yapılandır.
2. **Authentication → Providers → Email** üzerinden e-posta bağlantısı ve doğrulama ayarlarını gözden geçir.
3. Kendi SMTP sağlayıcını yapılandır. Varsayılan test gönderimi geniş kullanıcı kitlesi için uygun değildir.
4. Sadece onaylı test hesabına gönderim yaparak e-posta teslimi, tek kullanımlık bağlantı, oturum açma ve çıkışı doğrula.
5. İki ayrı deneme hesabı ile birbirinin sağlık ölçümlerini ve günlüklerini göremediğini uçtan uca test et.

## 3. Apple ve Google

- Apple Developer: App ID, Sign in with Apple yetkisi, Services ID, Keys ve callback URL. Supabase'in resmi Apple yönergesi: https://supabase.com/docs/guides/auth/social-sign-in/auth-apple
- Google Cloud: OAuth istemcisi ve yetkili redirect. Supabase'in resmi Google yönergesi: https://supabase.com/docs/guides/auth/social-login/auth-google
- Supabase'te sağlayıcı bilgileri tamamlandıktan ve test edildikten sonra `src/config.ts` içindeki `APPLE_LOGIN_READY` ve `GOOGLE_LOGIN_READY` değerleri `true` yapılabilir.
- **Hiçbir .p8 dosyasını, istemci sırrını, yönetici anahtarını veya SMS sağlayıcı anahtarını tarayıcı koduna koyma.**

## 4. Yayın öncesi durdurma koşulları

- Sağlık verilerinin özel nitelikli veri olarak işlenmesi için gerekli KVKK/GDPR belgeleri ve kullanıcının haklarını kullanacağı kanallar tamamlanmamışsa halka açma.
- Oturum güvenliği, e-posta teslimi, veri silme talebi, parola/oturum kurtarma, yedekleme ve felaket kurtarma süreçleri test edilmemişse halka açma.
- Apple Sağlık veri çekimini otomatikmiş gibi tanıtma; native iOS/HealthKit yardımcı uygulaması henüz geliştirilmedi.
- Mevcut özel WellDose 3.0 verilerini yeni uygulamaya **otomatik aktarma**.
