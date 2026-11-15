# ThreeDee V8 — Shopier ile ödeme ve sipariş takibi

Bu paket **yalnızca değişen dosyaları** içerir. V7 sohbet, V6 üyelik, ürünler, 3MF dosyaları ve diğer Supabase kayıtları değişmez. Bu sürüm önceki V8 PayTR kodunu Shopier ile **değiştirir**. PayTR'ı aynı anda kullanmaz.

## Önemli: henüz canlı ödeme testi yapılmadı

Shopier mağazası `https://www.shopier.com/threedee` için gerçek API anahtarı olmadan Shopier'de ödeme denemesi gerçekleştirilemez. Bu nedenle mağazanın ürün oluşturma API erişimini, alıcı ekranındaki nihai fiyatı ve gerçek ödeme sonrası `/orders` cevabını **canlıda doğrulamak gerekir**. İşlem sonuçları ancak Shopier API üzerinden doğrulandığında `paid` olarak işaretlenir. API yanıtı farklıysa sipariş güvenlik için `pending` kalır ve gerçek ödeme olmuşsa Shopier panelinden kontrol edilir.

## Dosyalar ve GitHub

ZIP içerisindeki **beş** dosyayı GitHub `threedeetr/3d-urun-muzesi` deposunda aynı dizinlerde değiştir:

- `server.js`
- `payment-v8.js`
- `public/checkout.html`
- `public/checkout.js`
- `public/admin.js`

**Özellikle `payment-v8.js` dosyasını değiştir!** Eski PayTR dosyasının yerini Shopier uyarlaması alıyor. `customer-v6.js`, `supabase-store.js`, müze, admin HTML/CSS ve sohbet dosyalarını değiştirme. `KURULUM-SHOPIER-V8.md` ve `ThreeDee-V8-Shopier-Supabase.sql` kod olarak sunucuya yüklenmek zorunda değil.

## 1. Supabase veritabanı

- `https://supabase.com/dashboard` → mevcut ThreeDee projesi → **SQL Editor** → **New query**.
- `ThreeDee-V8-Shopier-Supabase.sql` dosyasının içeriğini yapıştır, **Run**.
- Mevcut ürün ve siparişler silinmez; `museum_orders` tablosuna Shopier referans alanları eklenir.
- Eğer önceden V8 PayTR SQL'ini çalıştırdıysan bu SQL mevcut alanları korur.

## 2. Shopier'de kişisel erişim anahtarı oluştur

- Shopier hesabına **sen** giriş yap.
- **Hesap Yönetimi → Kişisel Erişim Anahtarı** bölümüne git.
- Shopier'in şart koştuğu **iki adımlı doğrulamayı (2FA)** önceden etkinleştir.
- PAT oluştur; bu anahtar sadece bir kez gösterilir.
- **PAT'i ChatGPT'ye, GitHub'a, ekran görüntüsüne veya başka birine gönderme.** Kendi Render Environment bölümüne yaz. Bu anahtar hesabında tam erişim verebilir.
- Kaynak: https://help.shopier.com/help/kisisel-erisim-anahtari-nedir

## 3. Render ortam değişkenleri

Render → `3d-urun-muzesi` → Environment:

```
SHOPIER_PAT=<Shopier panelinde oluşturduğun PAT>
SHOPIER_LIVE_READY=0
PUBLIC_SITE_URL=https://threed-urun-muzesi.onrender.com
THREEDEE_SHIPPING_FEE_TRY=0
```

`SHOPIER_LIVE_READY=0` olduğu sürece **Shopier ödemesi KAPALIDIR**; müşteriler ödeme yapılmamış talep bırakabilir. Gerçek ödeme sürecini açmak için mağaza/API izinleri ve fiyatları kontrol ettikten sonra `SHOPIER_LIVE_READY=1` ayarla. Bu değişiklik **gerçek Shopier ödemesini etkinleştirir**; Shopier için otomatik sandbox/test modu varsayılmamıştır.

`SHOPIER_IMAGE_URL` isteğe bağlıdır. Varsayılan: `https://threed-urun-muzesi.onrender.com/threedee-banner.jpg`. Fotoğraf herkese açık bir HTTPS `.jpg` veya `.png` olmalı. Eğer V7.1 bannerı yüklenmediyse farklı bir ürün görselinin herkese açık JPG/PNG URL'sini bu değişkene yaz.

Eski `PAYTR_...` ortam değişkenleri bu kodla **kullanılmaz**. Değişkenleri sonra silebilirsin. `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ADMIN_PASSWORD` değişmeden kalır. Build ve Start komutları aynı: `echo No dependencies`, `node server.js`.

## 4. Ürün ve ödeme akışı

1. Müşteri ThreeDee hesabına girer ve ürünleri sepete ekler.
2. `/checkout` sayfasında adresini girip sipariş oluşturur.
3. Sunucu tutarı hesaplar ve Shopier API'de `customListing: true` ile, **tek siparişe özel** bir fiziksel ürün oluşturur. Sepet içeriği açıklamada listelenir. Bu Shopier ürünü, müzenin orijinal ürünlerinin yerini almaz.
4. Shopier ürün bağlantısı ThreeDee'de görünür; müşteri ayrı Shopier sekmesinde ödeme yapar.
5. Sonra ThreeDee'ye döner. `Siparişlerim` yenilendiğinde sunucu Shopier API'de ürün ID'sini arar; **Shopier `paid`, doğru tutar, para birimi ve ürün/adedin tamamı eşleşmeden** siparişi `paid` yapmaz.
6. Admin `/admin` bölümünde siparişe bakıp üretim/kargo durumlarını günceller.

Shopier checkout, kendi kargo/adres ekranını gösterebilir. Canlı denemede **Shopier'deki adres ve tutarı** kontrol et; ThreeDee'deki adresle aynı olmayabilir. Kargo/indirim farkı oluşursa sipariş otomatik `paid` olmayacaktır. Siparişin Shopier'de ödenmiş görünmesine rağmen ThreeDee'de beklemesi durumunda mağaza panelinden işlem ve tutarı kontrol et, müşteriyi ikinci kez ödeme yapmaya yönlendirme.

## 5. Canlıya almadan önce

- Önce mevcut veritabanının yedeğini al. Bu paket mevcut kayıtları silmez; yedek yine önerilir.
- Eski PayTR üzerinde bekleyen ödemeleri tamamla veya kapat: bu sürüm PayTR bildirim endpoint'ini devre dışı bırakır.
- `SHOPIER_LIVE_READY=0` ile sitenin açıldığını, üye/sepet/yorum özelliklerinin çalıştığını doğrula.
- Shopier'de API ürün oluşturma iznini doğrula. `LIVE_READY=1` geçişini yapmadan önce Shopier hesabının canlı işlemleri kabul ettiğinden emin ol.
- **Küçük tutarlı, gerçekten ödenen tek bir siparişle** bağlantı, fiyat, ödeme ve otomatik durum güncellemesini kontrol et; gerekiyorsa Shopier üzerinden iade et.
- Teslimat/satış şartları, KVKK, mesafeli satış sözleşmesi, stok rezervasyonu ve iade operasyonlarını son haline getir. Bu paket otomatik iade/fatura/stok düşme sağlamaz.
- Her sipariş için Shopier'de ayrı bir özel ürün oluşur; terk edilmiş bağlantıları mağaza panelinden zaman zaman temizlemek gerekir.

## 6. Sınırlamalar

- Bu sürüm **mağaza bağlantısıyla değil, `SHOPIER_PAT` ile** tam entegre olur. Sadece `https://www.shopier.com/threedee` bağlantısı API izni sağlamaz.
- Otomatik ödeme doğrulaması ziyaretçi/admin sipariş sayfası yenilendiğinde yapılır; Shopier webhook kurulumu bu sürümde yoktur.
- Shopier API'de beklenmeyen cevap veya izin hatası olursa sipariş güvenlik nedeniyle beklemede kalır.
- Gerçek PAT/Shopier hesabıyla uçtan uca ödeme testi henüz yapılmadı. Kullanıcının gerçek işlem öncesi test etmesi zorunludur.

Kaynaklar:
- https://help.shopier.com/help/shopier-api-nedir
- https://help.shopier.com/help/kisisel-erisim-anahtari-nedir
- https://skmtc.dev/shopier/apis/shopier/docs/products/post
- https://skmtc.dev/shopier/apis/shopier/docs/orders/get
