# THREEDEE 3D ÜRÜN MÜZESİ — Güncelleme 2

ThreeDee logolu, klasik müzikli, **birinci şahıs gezilen sanal müze** ve **şifreli admin paneli**. Bu sürüm, ağır 3MF yüklemelerinde mobil tarayıcının kilitlenmesini önlemeye odaklanır.

## Özellikler

- Müzede WASD/ok tuşları ile yürüyüş, sürükleyerek etrafa bakma
- Android/iPhone: sol alttaki sanal joystick ile yürüme, ekranın kalanını sürükleyerek bakma
- Ürünlerin üzerine dokunma veya yaklaşıp **E / Ürünü incele** ile detay açma
- Detayda 360° döndürme, yakınlaştırma, fiyat, stok adedi ve açıklama
- `/admin` üzerinden şifre ile giriş, ürün ekleme/düzenleme/silme, stok ve fiyat değişikliği
- Doğrudan **.3mf, .glb, .stl** yükleme (maks. 32 MB); sunucu büyük 3MF ve STL dosyalarını 36.000 üçgene kadar küçülterek **hafif GLB önizleme** üretir. Orijinal dosya da saklanır.
- 3MF/STL hatalıysa veya aşırı büyükse müze yine açılır, ilgili ürün temsili modelle gösterilir; admin panelinde uyarı görünür.
- Gerçek modeller galeride yalnızca yaklaşıldığında açılır, uzaklaşınca hafif siluet gösterilir; telefonda aynı anda az sayıda gerçek model kullanılır.
- Kullanıcı tarafından yüklenen **ThreeDee** logo görseli girişte, üst menüde, müze duvarında ve yönetici ekranında görünür.
- Müzeye girince başlayan, aç/kapat butonu olan, projeye özel hazırlanmış klasik tarzda enstrümantal müzik (telifli kayıt kullanılmaz).
- Başlangıçta 8 adet **temsili örnek ürün** (fiyatlar ve modeller gerçek değil)
- Çalışmak için veritabanı veya npm kütüphanesi gerektirmez (Node.js 20+). 3D görselleştirme için tarayıcı internete bağlı olmalı: Three.js CDN üzerinden açılır.

## Bilgisayarda başlatma

1. Node.js 20 veya üstünü yükle.
2. İstersen terminalde yönetici şifresi ayarla: `ADMIN_PASSWORD="kendine-ozel-guclu-sifre" node server.js` (macOS/Linux).
3. Windows PowerShell: `$env:ADMIN_PASSWORD="kendine-ozel-guclu-sifre"; node server.js`.
4. Şifre ayarlamazsan sunucu güvenli bir **geçici admin şifresi** üretip terminalde gösterir.
5. Müşteri müzesi: `http://localhost:3000`
6. Admin paneli: `http://localhost:3000/admin`

## GitHub + Render ile yayınlama (telefondan da yapılabilir)

1. Bu klasörün içindeki `server.js`, `package.json`, `render.yaml`, `public/` dosyalarını yeni bir GitHub deposunun **kök dizinine** yükle.
2. Render'da **New > Web Service** seç, GitHub deposunu bağla. **Runtime: Node**, **Build command:** `echo No dependencies`, **Start command:** `node server.js`. Mevcut projede Build/Start komutlarını değiştirmene gerek yok.
3. **Environment** bölümünde `ADMIN_PASSWORD` anahtarını oluştur; uzun, özel bir şifre ayarla.
4. Render'ın verdiği `https://...onrender.com` bağlantısı müşteri müzesi; `https://...onrender.com/admin` yönetici panelidir.
5. **ÇOK ÖNEMLİ:** Render'ın ücretsiz planında yerel dosya sistemi kalıcı değildir. Yeni ürünler ve 3MF dosyaları yeniden başlatma/yeniden deploy sonrasında kaybolabilir. Kalıcı yayın için ücretli persistent disk veya harici depolama gerekir. Kalıcı disk takarken mount path olarak `/opt/render/project/src/storage` seçilebilir; `DATA_DIR` değişkenini bu yola ayarla (varsayılan yol da aynısıdır). Render'da persistent disk ücretli planda mevcuttur.

## Sınırlar ve sonraki geliştirmeler

- İlk sürümde **sepet, ödeme, üyelik ve sipariş yönetimi yoktur**; ürün sergileme/inceleme çalışır.
- 3MF önizleme dönüştürücüsü model dosyalarındaki temel üçgen geometrisini kullanır. Karmaşık 3MF bileşenleri/renkleri/üreticiye özel bilgiler eksik görünebilir. Bu durumda optimize **GLB** yükle. Admin paneli dönüştürücü hata mesajını gösterir.
- Önceden kaydedilen 3MF/STL ürünleri, **aynı kalıcı disk** erişilebilir durumdaysa sunucu başlarken otomatik önizleme oluşturmayı dener. Kalıcı diski olmayan Render kurulumlarında yeniden deploy, mevcut yüklemeleri silebilir.
- 3MF/STL çıktısı en fazla 36.000 üçgen içeren telefon dostu bir önizlemedir; bu bir baskı dosyasının yerine geçmez. Çok karmaşık modellerde parçaların birleşim konumları veya malzemeler doğru çıkmayabilir.
- 6 MB üstündeki ham GLB tarayıcıyı korumak için 3D olarak açılmaz; optimize edilmiş daha küçük GLB yükle.
- Ürünler JSON dosyasında saklanır, büyük ölçekli gerçek satış için veri tabanı + objelerin bulutta saklanması + daha kapsamlı admin yetkilendirmesi eklenmelidir.
- Açılış ürünleri yalnızca örnektir: fiyatlar da dahil olmak üzere yayın öncesi admin panelinden düzenleyin/silin.
- Müze vitrini ürün sayısına göre uzayacak şekilde tasarlanmıştır; koleksiyon panelinden tüm ürünlere her zaman erişilebilir.

## Dosya yapısı

- `server.js`: API, admin oturumu, 3MF dosya kaydı
- `model-preview-worker.js`: 3MF/STL modelini ayrı iş parçacığında güvenli, basitleştirilmiş GLB dosyasına dönüştürür
- `public/classical.ogg`: Projeye özel orijinal klasik tarzda döngü müzik
- `public/threedee-logo.webp`: Kullanıcı tarafından verilen logo
- `public/index.html`: Müşteri müzesi
- `public/museum.js`: Birinci şahıs hareket, Three.js müzesi, 3D model görüntüleme
- `public/admin.html`: Admin paneli
- `public/admin.js`: Ürün formu, yönetim API'si
- `public/style.css`: Arayüz tasarımı
- `storage/`: Ürün verisi ve yüklenen modeller (ilk çalıştırmada oluşur)

## 3MF yükleme testi

`examples/ornek-test-kup.3mf` dosyası, admin yükleme işlemini denemek için gerçek bir basit 3MF küp geometrisi içerir. Yönetici panelinde **Yeni ürün ekle** > **3D model yükle** alanından seçebilirsin.

## Güncelleme yapacaklar için dikkat

- Eski dosyalarla aynı proje klasörüne **model-preview-worker.js** dosyasını da mutlaka yükle. Tek başına `museum.js` değiştirmek yeterli değildir.
- `public` klasörüne `threedee-logo.webp` ve `classical.ogg` dosyalarını ekle.
- Render mevcut `ADMIN_PASSWORD` değişkenini korur. Bu değişken tanımlanmamışsa her restart sonrası geçici şifre değişebilir; kalıcı özel şifre tanımla.
- **Önemli:** Render ücretsiz/ephemeral storage ile çalışıyorsa deploy öncesinde mevcut ürünlerini ve model dosyalarını yedekle. Repo güncellemesi ürün ve modellerin kaybolmasına yol açabilir. Kalıcı saklama çözülmeden gerçek satışa geçme.
- Müzede müzik tarayıcı kuralları nedeniyle ilk kullanıcı dokunuşundan sonra ("Müzeye Gir") başlar.
- Tarayıcıda hâlâ eski sayfa varsa sayfayı yenile veya özel sekmede aç.
