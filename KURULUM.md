# WellDose — iPhone ve Android Mobil Uyumluluk (Revizyon 7)

Bu paket, kullanıcı tarafından test edilen Revizyon 6'nın özelliklerini korur. Yalnızca ekranların mobil kullanımını iyileştirir; **veritabanında veya Supabase ayarlarında değişiklik gerektirmez**.

## Revizyon 7 — Mobil uyumluluk

- **iPhone Safari / Android Chrome:** 320 px ve üstü dar ekranlar, tabletler ve yatay/dikey yerleşimler için ekran boşlukları, kartlar, formlar ve butonlar iyileştirildi.
- **Beş sekmeli alt menü:** Genel, Ölçüm, Tedavi ve Belgeler doğrudan erişilir. **Diğer** menüsünde Doktor Raporu, Profilim ve Ayarlar bulunur. Böylece yedi sekmenin küçük yazılara sıkışması önlenir.
- **Dokunmatik alanlar:** Temel işlem düğmeleri daha geniş; menü, seçim kutusu ve grafik filtreleri dokunarak kullanım için düzenlendi. Klavyeden `Escape` ile Diğer menüsü kapatılabilir.
- **Formlar:** Mobil metin alanları 16 px yapılarak iPhone Safari'de odaklanırken istenmeyen otomatik yakınlaştırmanın önüne geçilmesi hedeflendi.
- **iPhone tarih seçimi düzeltmesi:** iOS takvimi ileri bir tarih veya saat gösterse bile seçim tamamlandığında ölçüm, tedavi uygulaması, belge tarihi veya doğum tarihi alanı geçersiz değeri geri alır ve açık bir uyarı verir. Kayıt anındaki mevcut güvenlik kontrolü de korunur. Hatırlatma başlangıcı ise planlama amacıyla geleceğe ayarlanabilir.
- **Grafik ve kayıtlar:** Grafik zaman/tür filtreleri yatay kaydırılabilir; kayıt listeleri, belge kategorileri ve profil düzenleme alanları küçük ekrana sığar.
- **Belge önizleme:** PDF ve fotoğraf görüntüleyicisi güvenli ekran boşluklarını ve güncel mobil ekran yüksekliğini dikkate alır.
- **Doktor raporu:** Seçilen kayıt sayısı ve **PDF oluştur** düğmesi mobilde erişilebilir bir alt çubukta da görünür. Önceden olduğu gibi, PDF sadece kullanıcının açıkça başlattığı yazdırma ekranında oluşturulur.
- **Gizlilik:** Sağlık verilerinin saklama/paylaşma kuralları, yükleme sınırları, doz girişleri ve hesap yönetimi değiştirilmedi.

### Gerçek telefonla test

1. Uygulamayı **HTTPS üzerinden yayımlanmış WellDose adresinde** iPhone Safari veya Android Chrome ile aç. Mac'teki `http://127.0.0.1:5173` adresi telefonda çalışmaz; `127.0.0.1` her cihazın kendisidir.
2. Giriş yap. **Genel → Ölçüm → Tedavi → Belgeler → Diğer** sekmelerine dokun. Diğer menüsünden Profilim, Doktor Raporu ve Ayarlar sayfalarını aç.
3. Form alanlarına dokunup iPhone'da ekranın kendiliğinden yakınlaşmadığını, klavyenin önemli düğmeleri kalıcı olarak kapatmadığını kontrol et.
4. Ölçüm tarihinden gelecekteki bir zamanı seçmeyi dene. iOS seçim çarkı ileri tarihi göstermeye devam edebilir; ancak seçim bittiğinde uygulama önceki geçerli tarihi geri getirmeli ve uyarı göstermelidir. **Bu testi kaydetmeden yap.** Ardından grafik tür/tarih sekmelerini yatay kaydır. Sağlık belgelerinde kategori değiştir, yalnızca kendine ait **hassas olmayan bir test dosyasını** önizle.
5. Doktor Raporu'nda deneme kaydı seç. Mobil alttaki sayaç değişmeli; **PDF oluştur** düğmesi yazdırma/paylaşım ekranını açmalı. Otomatik olarak kimseye gönderim yapılmamalı.
6. Telefonu yatay çevirip ekranları tekrar gözden geçir; özellikle sabit alt menü ve açılan Diğer menüsü üst üste binmemeli.

**Önemli:** Bu paket iPhone/Android için yerel App Store/Play Store uygulaması değildir; mobil tarayıcıya uyumlu web sürümüdür. Canlı mobil testler paketi kendi telefonunda açtıktan sonra tamamlanır.

---

## Revizyon 6 — Korunan özellikler

## Revizyon 6 — yeni özellikler

### 1) Ölçüm ve tedavi takibi

- Ölçümlerim ekranında **kilo, BKİ, vücut yağ oranı ve yağsız vücut kütlesi** için ayrı grafikler; **30 gün / 90 gün / 1 yıl / tümü** seçimi.
- İlk ve son değerin yanı sıra, aradaki mutlak değişim de görünür. Değişim kişisel kayıtlardır; tıbbi değerlendirme değildir.
- Tedavi Günlüğü'nde yalnızca **aynı ilaca ait** son 12 dozun grafiği.
- İlaç adı, ilk hatırlatma zamanı ve **tek sefer / 1 / 7 / 14 / 28 günde tekrar** ile hatırlatma oluşturma, duraklatma ve silme.
- Yaklaşan hatırlatma **Genel Bakış** ekranında gösterilir. İsteğe bağlı tarayıcı bildirimleri yalnızca **uygulama açık ve görünürken** denenir. Uygulama kapalıyken sistem bildirimi/e-posta/push gönderme altyapısı **yoktur**.
- Hatırlatma bir dozun uygulandığı anlamına gelmez. Gelecek tarih yalnızca planlanan hatırlatma için kullanılabilir; ölçüm ve gerçekten uygulanan doz kayıtları geçmiş tarihli olmalıdır.

### 2) Sağlık belgelerinde geliştirmeler

- Kan-idrar sonuçları, radyoloji, doktor ve hasta notları ve reçeteler mevcut kategorilerinde kalır.
- Kayıtlarda başlık, doktor, kurum ve açıklamaya göre **arama**.
- Özel bucket'taki PDF/görseli yetkili kullanıcı oturumunda **Önizle** ile açma; dosya indirme, düzenleme ve silme korunur.
- Önizleme dosyaları kullanıcı tarayıcısındaki geçici bellekte açılır; ortak bağlantı veya kalıcı herkese açık URL oluşturulmaz.

### 3) Doktor Raporu

- Yeni **Doktor Raporu** menüsünden profil, ölçüm, doz ve belgeler **tek tek işaretlenebilir**; hiçbir şey önceden seçili değildir.
- Seçilen metin verilerinden bir rapor görünümü hazırlanır; **Yazdır / PDF oluştur** düğmesiyle tarayıcının yazdırma penceresinden PDF olarak kaydedilebilir.
- Orijinal yüklenen PDF ve görseller özet PDF'ye **eklenmez**. Gerekirse Sağlık Belgelerim'den ayrıca indirilmelidir.
- Rapor üçüncü tarafa otomatik gönderilmez, sunucuda ayrıca saklanmaz. PDF **şifreli değildir**; yalnızca alıcısını kendin doğruladığın güvenli bir kanalla paylaş.

## Önceki profil özellikleri

Revizyon 4 ile eklenen **Profilim** formu ve Revizyon 5 ile eklenen **tek sayfalık profil özeti** bu sürümde korunur:

- **Oluştur:** Profil kaydı yokken form açılır. Kaydettikten sonra aynı ekranda özet görünür.
- **Düzenle:** Mevcut bilgileri formda güncelle; kaydedince özet yenilenir.
- **Sil:** Yalnızca kişisel profil ve hedefler kaydını siler. **Ölçümler, tedavi günlüğü ve sağlık belgeleri korunur.** İşlem öncesinde `PROFİL SİL` yazılarak onay verilir.
- **Yazdır / PDF:** Tarayıcının yazdırma ekranını açar. Yazıcıdan çıktı alınabilir veya PDF olarak kaydedilebilir. Menü ve işlem düğmeleri yazdırılmaz.
- **Gönder:** Önce hassas sağlık verileri uyarısı ve ikinci onay gösterilir. Onaylanınca cihaz/tarayıcı destekliyorsa yerleşik paylaşım menüsü açılır; **kendiliğinden kimseye gönderilmez**. Desteklenmeyen tarayıcılarda PDF/JSON indirip kendin paylaşabilirsin.
- **İndir (JSON):** Yalnızca Profilim ve Hedeflerim verilerini makine-okunur bir dosyada indirir. PDF çıktısı için **Yazdır / PDF** kullanılır.

Profil alanları:

- **Kişisel bilgiler:** Ad-soyad, geçmiş doğum tarihi ve boy.
- **Sağlık geçmişi:** Tanılar, alerjiler, düzenli ilaçlar, işlemler ve kişisel sağlık notları.
- **Hedefler:** Kişisel hedef kilo ve motivasyon notu.
- Alanlar isteğe bağlıdır; başka kullanıcılar profilini göremez.
- Hedef kilo özeti Genel Bakış ekranında gösterilir; profili JSON yedeğine ve veri silme işlemine dahil eder.
- Mevcut **Sağlık Belgelerim** bölümü aşağıdaki özellikleri korur:

- Kan tahlilleri, idrar tahlilleri, radyoloji raporları
- Doktor notları, hasta notları, reçeteler
- **Tüm Belgeler:** Yalnızca arşivi görüntüler. Bu sayfadan yeni belge yüklenemez.
- Bir kategoriye girince belge türü otomatik belirlenir ve değiştirilemez.
- Gerçek yükleme yüzdesi, bağlantı hatasında uyarı ve 90 saniye zaman aşımı.
- Kayıtlarda **Düzenle**, **Sil** ve varsa **Dosyayı indir**.
- Dosya boyutu hem arayüzde hem sunucuda en fazla **5 MB**.
- **Tarih güvenliği:** Kilo/ölçüm, tedavi günlüğü ve sağlık belgeleri için geçmiş tarihler serbest; gelecek tarih veya saatleri kaydetmek yasaktır. Üst sınır takvim alanına odaklanınca yenilenir ve kaydetmeden önce tekrar doğrulanır.

## Kurulum sırası

1. Mac'teki çalışan `welldose_accounts/src/main.ts` ve `src/styles.css` dosyalarının kopyasını al. Kullanıcının onayladığı **28 Ekim tarihli GitHub yedek dalı** korunmalıdır.
2. Paketteki `src/main.ts` ve `src/styles.css` dosyalarını Mac'teki aynı konumdaki dosyalarla değiştir. **`src/config.ts` dosyasına dokunma.**
3. Supabase **WellDose** projesine yeni profil alanları güvenli ve eklemeli migration ile zaten uygulandı. **`health_profile.sql` dosyasını tekrar çalıştırma.** Bu dosya kaynak kontrolü ve yeni kurulumlar içindir. Eski belge SQL ve 5 MB sunucu ayarları da zaten çalışıyor; onlara dokunma.
4. Terminal'de `welldose_accounts` klasöründeyken `npm run build` ardından `npm run dev` çalıştır. Bu yalnızca Mac'teki geliştirme sunucusunu başlatır. Telefon testi için mevcut HTTPS dağıtımına ayrıca güncel dosyaların yayımlanması gerekir.
5. **Ölçümlerim** sayfasına girip farklı ölçüm türleri ve tarih filtrelerini değiştir; ilk/son değerlerin kayda uygun olduğunu kontrol et.
6. **Tedavi Günlüğü** sayfasında mevcut dozların grafiğini ve ilaç seçimini test et. Planlı bir hatırlatma ekle; yeniden girişte korunduğunu, duraklatma/silme işlemlerini dene. Bildirim için tarayıcıdan izin almak isteğe bağlıdır.
7. **Sağlık Belgelerim** bölümünde arama yap; kendi hesabına ait küçük PDF/görselde önizlemeyi ve kapatmayı test et.
8. **Doktor Raporu** menüsünde yalnızca deneme kayıtlarını işaretle; yazdırma penceresini açıp **PDF olarak kaydet** seçimini kontrol et. Gerçek sağlık bilgilerini başka birine test amacıyla gönderme.
9. **Profilim** ve **Genel Bakış** sayfalarının önceki sürümdeki gibi çalıştığını doğrula.

### Önceki sürümlerden korunması gereken testler

Mevcut veri girişleri, güvenlik ve belge denetimleri için aşağıdaki eski adımlar korunmuştur:
1. WellDose'a giriş yap. **Tüm Belgeler** sayfasında ekleme formu olmadığını kontrol et.
2. **Hasta Notu** bölümünde yalnızca metin içeren bir deneme kaydı oluştur, ardından **Düzenle** ve **Sil** işlemlerini test et.
3. Küçük bir PDF (5 MB'den küçük) yükle; **yüzde**, **indirme** ve **düzenleme** işlemlerini test et.
4. Ölçümlerim'de dünkü bir saatle deneme ölçümü gir. Gelecek yarını seçmeye çalış; formun engellemesini kontrol et.
5. Tedavi Günlüğü'nde geçmiş bir uygulama saati ve Sağlık Belgelerim'de geçmiş bir belge tarihi ile kayıt yap; ileri tarihli denemelerin kabul edilmediğini doğrula.
6. **Profilim** sayfasında geçmiş doğum tarihi, boy, sağlık notu ve hedef kilo girip kaydet. **Kişisel bilgiler + hedefler + sağlık geçmişi aynı sayfada** görünmeli.
7. **Düzenle**, **Yazdır / PDF**, **İndir (JSON)** ve **Gönder → Vazgeç** işlemlerini dene. **Sil** testini yalnızca ayrı bir test hesabında gerçekleştir.
8. **Genel Bakış** ekranında hedef kiloyu ve **Ayarlar → Kayıt bilgilerini indir (JSON)** dosyasında `user_profile` alanını kontrol et.

## Gizlilik ve sınırlamalar

- Belgeler **private** Supabase Storage bucket'ında tutulur. Kullanıcıların dosya yolları UUID ile başlar ve RLS yalnızca hesabın kendisine izin verir.
- PDF, JPEG, PNG, WebP kabul edilir; sınır **5 MB**'dir. PDF dosyalarında boş/genel MIME bildirimleri normalize edilir.
- Her belge yalnızca belgeyi yükleyen kullanıcı tarafından indirilebilir ve silinebilir.
- Dosya değiştirirken eski dosya üzerine yazılmaz; yeni dosya ayrı yüklenir ve kayıt güncellendikten sonra eski dosya temizlenir.
- Sağlık belgeleri **Tüm kayıt bilgilerini indir (JSON)** dosyasında metaveri olarak bulunur; PDF ve görselleri ayrı indirmen gerekir.
- Profil alanları `public.user_profiles` tablosunda kullanıcıya özel RLS korumasıyla tutulur. Tanı, alerji ve ilaç bilgilerinin doğruluğu kullanıcı beyanına dayanır.
- Paylaşım isteği yalnızca açık kullanıcı onayıyla cihazdaki paylaşım ekranını çağırır. Paylaşacağın alıcıyı ve hangi bilgileri göndereceğini **her defasında kontrol et**. JSON ve yazdırılan PDF dosyaları cihazında korunmasız kalabilir; güvenli sakla.
- Profil ekranındaki **Sil** yalnızca `user_profiles` kaydını hedef alır; tüm kayıtları kalıcı silme işlevinden ayrıdır.
- Hatırlatmalar `journal_records.payload.reminders` alanına eklenir; yeni tablo veya şema değişikliği gerekmez. Önceden kayıtlı dozlar `payload.injections` altında korunur.
- Sistem bildirimleri (izin verildiyse) **tarayıcı açık ve görünür durumdayken** denenir. Bu hizmet **güvenilir bir arka plan alarmı** değildir; tıbbi dozları kaçırmamak için tek dayanak olarak kullanılmamalıdır.
- Doktor raporu yazdırma/PDF işlemi yereldir. PDF'deki seçilmiş kişisel veriler şifrelenmez, otomatik e-posta/mesaj gönderimi yapılmaz.
- Sağlık kayıtlarını kalıcı silme işlemi artık profil bilgilerini de siler. Bu işlevi gerçek verilerle test etme; önce ayrı bir test hesabı kullan.
- Bu sürüm belgeleri yorumlamaz, hastalık tanısı veya tedavi önerisi vermez.
- Gerçek hastaların kullanacağı genel hizmete geçmeden önce aydınlatma/açık rıza metinleri ve veri saklama-silme süreçleri ayrıca değerlendirilmelidir.

## Kontroller

- TypeScript denetimi ve Vite üretim derlemesi bu revizyonda başarılıdır. Mac'teki gerçek oturumla tarayıcı işlev testleri kurulumdan sonra yapılmalıdır.
- Supabase tablo, özel bucket ve 5 MB sunucu sınırı doğrulandı.
- Gerçek tarayıcıda PDF yükleme testi, Mac'te yeni kodlar açıldıktan sonra yapılacak.

## Güvenli geri dönüş

Uygulama kodlarında sorun olursa yedeklediğin `main.ts` ve `styles.css` dosyalarını geri koyabilirsin. SQL tarafında oluşturulan yeni veri alanlarını rastgele silme; varsa önce içindeki belgelerin yedeğini al.
