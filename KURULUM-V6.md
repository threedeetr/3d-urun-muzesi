# ThreeDee V6 — kurulum ve güvenlik notları

Bu paket **yalnızca yeni/değişen dosyaları** içerir. Mevcut ThreeDee V5 dosyalarının geri kalanı korunur. Canlı GitHub/Render deposuna bu çalışmada değişiklik yapılmadı.

## Yeni özellikler

1. Müşteri e-posta/şifre kayıt ve giriş: **Supabase Auth**. Şifreler ThreeDee tarafından saklanmaz. Doğrulama e-postası etkinse kayıt sonrası doğrulama gerekir.
2. Müşteri sepeti ve favorileri: Giriş yapınca Supabase'de hesap bazlı saklanır. Misafir sepeti/favorileri mevcut tarayıcıda geçici tutulur, girişte hesaba aktarılır.
3. Sipariş/ödeme adımı: `/checkout`. İletişim ve teslimat bilgileriyle **ödenmemiş sipariş talebi** oluşturur. **Hiçbir kart bilgisi istemez, ücret tahsil etmez, stok düşmez.** Ödeme kuruluşu ayrıca bağlanmalıdır.
4. Canlı ziyaretçiler: Müzedeki diğer ziyaretçilerin düşük poligonlu renkli karakterleri ve görünen adları. Aynı Render instance'ı üzerinde yaklaşık 2,5 saniyede bir konum yenilenir. Son 16 saniyede aktif olmayan ziyaretçiler kaybolur. Telefonlarda en fazla 14, masaüstünde en fazla 28 uzak karakter gösterilir. Sunucu restart olursa anlık ziyaretçi listesi sıfırlanır, ürün/veri kayıtları sıfırlanmaz.
5. Admin: Ödenmemiş sipariş talepleri `/admin` ekranında görünür; 'Yeni', 'İletişime geçildi', 'İptal' durumları bulunur.

## Adım 1 — Supabase SQL (önce)

- https://supabase.com/dashboard adresinde mevcut **ThreeDee projenizi** açın.
- Sol menüden **SQL Editor** > **New query**.
- ZIP içindeki `ThreeDee-V6-Supabase.sql` dosyasını metin olarak açın, içeriğin tümünü SQL Editor'e yapıştırın ve **Run** düğmesine basın.
- **Table Editor** altında şu üç yeni tablo görünecek: `museum_favorites`, `museum_cart`, `museum_orders`.
- **DİKKAT:** Yeni bir proje açmayın; mevcut `museum_products`, `museum_reviews` ve Storage bucket'ları değişmeyecek.

## Adım 2 — Supabase müşteri kayıt ayarları

- **Authentication** > **Providers** > **Email** bölümünü açın. Email kaydının etkin olduğundan emin olun.
- **Confirm Email** açık kalması tavsiye edilir; müşteriler doğrulama bağlantısını açmalıdır.
- **Authentication** > **URL Configuration** bölümünde `Site URL` olarak aşağıdaki adresi belirleyin:
  `https://threed-urun-muzesi.onrender.com`
- Aynı adresi gerekiyorsa **Redirect URLs** listesine ekleyin.
- Doğrulama e-postası spam kutusuna düşebilir. Supabase'in ücretsiz varsayılan e-posta sınırları olabilir; gerçek satışa geçmeden kendi SMTP sağlayıcınızı bağlayın.

## Adım 3 — Render ayarları

- Mevcut `SUPABASE_URL` ve `SUPABASE_SECRET_KEY` ayarlarını **koruyun**; değiştirmeniz gerekmiyor.
- `ADMIN_PASSWORD` kalıcı, güçlü bir şifre olmalı.
- Opsiyonel ama önerilen: `CUSTOMER_SESSION_SECRET` adıyla 32+ karakter güçlü, rastgele bir sır oluşturun. Sunucuda HTTP-only oturum çerezlerini şifrelemek için kullanılır. Bunu kimseyle paylaşmayın veya GitHub'a koymayın. **Bu sırrı daha sonra değiştirirseniz müşterilerin yeniden giriş yapması gerekir**, verileri silinmez.
- Render Build Command: `echo No dependencies`; Start Command: `node server.js` değişmedi.

## Adım 4 — GitHub'a yükleme

- ZIP'i açın. İçindeki dizin yapısını koruyarak `threedeetr/3d-urun-muzesi` deposuna yükleyin.
- Eski `server.js`, `public/index.html`, `public/museum.js`, `public/style.css`, `public/admin.html`, `public/admin.js` dosyalarını yeni sürümleriyle değiştirin.
- Yeni `customer-v6.js`, `public/shop.js`, `public/checkout.html`, `public/checkout.js` dosyalarını ekleyin.
- SQL dosyasını GitHub'a yüklemek zorunda değilsiniz (SQL Editor'de çalıştırılması yeterlidir). `tests` klasörü de isteğe bağlıdır.
- Değişiklikleri commit edin; Render otomatik deploy edecek.

## Adım 5 — Kontrol

1. `/api/health` adresi `{"status":"ok","storage":"supabase"}` döndürmeli.
2. Telefonda müzeye girin, sağ üstten **Giriş** > **Kayıt ol** seçeneğini açın. E-postanızı doğrulayın ve giriş yapın.
3. Admin panelinde `isDemo=false` olan, stokta bulunan gerçek bir ürün sergileyin. 3D incelemeden **Sepete ekle** ve **Favorilere ekle** işlevlerini deneyin.
4. `/checkout` ekranına geçin. Talep oluşturduğunuzda 'Ödeme alınmadı' notunu göreceksiniz. Admin'de 'Sipariş talepleri' altında görünmeli.
5. İki **farklı cihazda veya gizli mod/normal modda** müzeye girin; iki kullanıcı birbirini renkli 3D karakter olarak görmeli. Aynı tarayıcının iki sekmesi aynı ziyaretçi çerezini paylaşabileceğinden **tek ziyaretçi** gibi görülebilir.

## Limitler ve sonraki adımlar

- **Gerçek online ödeme yok.** Kredi kartı bilgilerini ThreeDee'nin kendi formlarında toplamayın. İleride Shopier, iyzico, PayTR gibi bir ödeme kuruluşunun güvenli ödeme sayfası/entegrasyonu gerekir. Bağlandıktan sonra stok düşme, iade ve sipariş durumları güvenilir ödeme bildirimlerine göre yapılmalıdır.
- Anlık ziyaretçiler tek Node instance belleğindedir. Çok sunuculu ölçek için Supabase Realtime/Redis gerekir.
- Müşteri hesabına ait kişisel ve teslimat bilgilerini sadece admin/ilgili müşteri görebilir; SQL'de veri tabloları RLS ile kapalı, erişim sunucu tarafındadır. Bu prototipi gerçek ticari kullanıma açmadan KVKK bilgilendirmesi, mesafeli satış sözleşmesi, iade/iptal sayfası, şifre kurtarma ve gönderi/gizlilik politikalarını ekleyin.
- Yeni canlı sürümü gerçek telefonda ve gerçek Supabase test hesabında ayrıca deneyin. Testler yerelde sahte Supabase üzerinde yapıldı; canlı servis bu çalışmada değiştirilmedi.
