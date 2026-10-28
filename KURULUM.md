# WellDose — Sağlık Belgelerim ve Tarih Kontrolü (Revizyon 3)

Bu paket WellDose'un sağlık belgesi bölümünü revize eder:

- Kan tahlilleri, idrar tahlilleri, radyoloji raporları
- Doktor notları, hasta notları, reçeteler
- **Tüm Belgeler:** Yalnızca arşivi görüntüler. Bu sayfadan yeni belge yüklenemez.
- Bir kategoriye girince belge türü otomatik belirlenir ve değiştirilemez.
- Gerçek yükleme yüzdesi, bağlantı hatasında uyarı ve 90 saniye zaman aşımı.
- Kayıtlarda **Düzenle**, **Sil** ve varsa **Dosyayı indir**.
- Dosya boyutu hem arayüzde hem sunucuda en fazla **5 MB**.
- **Tarih güvenliği:** Kilo/ölçüm, tedavi günlüğü ve sağlık belgeleri için geçmiş tarihler serbest; gelecek tarih veya saatleri kaydetmek yasaktır. Üst sınır takvim alanına odaklanınca yenilenir ve kaydetmeden önce tekrar doğrulanır.

## Kurulum sırası

1. Mac'teki çalışan `welldose_accounts/src/main.ts` ve `src/styles.css` dosyalarının kopyasını al.
2. Paketteki `src/main.ts` ve `src/styles.css` dosyalarını Mac'teki aynı konumdaki dosyalarla değiştir. **`src/config.ts` dosyasına dokunma.**
3. Supabase **WellDose** projesinin özel dosya alanı ve veritabanı limiti 5 MB'ye zaten güncellendi. **SQL dosyasını tekrar çalıştırma.** `health_documents.sql` yalnızca yeni/sıfır bir kurulum için başvuru kopyasıdır.
4. Terminal'de `welldose_accounts` klasöründeyken `npm run build` ardından `npm run dev` çalıştır.
5. WellDose'a giriş yap. **Tüm Belgeler** sayfasında ekleme formu olmadığını kontrol et.
6. **Hasta Notu** bölümünde önce yalnızca metin içeren bir deneme kaydı oluştur, ardından **Düzenle** ve **Sil** işlemlerini test et.
7. Küçük bir PDF (5 MB'den küçük) yükle; **yüzde**, **indirme** ve **düzenleme** işlemlerini test et.
8. Ölçümlerim'de dünkü bir saatle deneme ölçümü gir. Gelecek yarını seçmeye çalış; formun engellemesini kontrol et.
9. Tedavi Günlüğü'nde geçmiş bir uygulama saati ve Sağlık Belgelerim'de geçmiş bir belge tarihi ile kayıt yap; ileri tarihli denemelerin kabul edilmediğini doğrula.

## Gizlilik ve sınırlamalar

- Belgeler **private** Supabase Storage bucket'ında tutulur. Kullanıcıların dosya yolları UUID ile başlar ve RLS yalnızca hesabın kendisine izin verir.
- PDF, JPEG, PNG, WebP kabul edilir; sınır **5 MB**'dir. PDF dosyalarında boş/genel MIME bildirimleri normalize edilir.
- Her belge yalnızca belgeyi yükleyen kullanıcı tarafından indirilebilir ve silinebilir.
- Dosya değiştirirken eski dosya üzerine yazılmaz; yeni dosya ayrı yüklenir ve kayıt güncellendikten sonra eski dosya temizlenir.
- Sağlık belgeleri **Tüm kayıt bilgilerini indir (JSON)** dosyasında metaveri olarak bulunur; PDF ve görselleri ayrı indirmen gerekir.
- Bu sürüm belgeleri yorumlamaz, hastalık tanısı veya tedavi önerisi vermez.
- Gerçek hastaların kullanacağı genel hizmete geçmeden önce aydınlatma/açık rıza metinleri ve veri saklama-silme süreçleri ayrıca değerlendirilmelidir.

## Kontroller

- TypeScript denetimi ve Vite üretim derlemesi başarılı.
- Supabase tablo, özel bucket ve 5 MB sunucu sınırı doğrulandı.
- Gerçek tarayıcıda PDF yükleme testi, Mac'te yeni kodlar açıldıktan sonra yapılacak.

## Güvenli geri dönüş

Uygulama kodlarında sorun olursa yedeklediğin `main.ts` ve `styles.css` dosyalarını geri koyabilirsin. SQL tarafında oluşturulan yeni veri alanlarını rastgele silme; varsa önce içindeki belgelerin yedeğini al.
