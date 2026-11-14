# ÜÇ BOYUTLU MÜZE — İlk Sürüm

3D baskı ürünleri için **birinci şahıs gezilen sanal müze** ve **şifreli admin paneli**.

## Özellikler

- Müzede WASD/ok tuşları ile yürüyüş, sürükleyerek etrafa bakma
- Android/iPhone: sol alttaki sanal joystick ile yürüme, ekranın kalanını sürükleyerek bakma
- Ürünlerin üzerine dokunma veya yaklaşıp **E / Ürünü incele** ile detay açma
- Detayda 360° döndürme, yakınlaştırma, fiyat, stok adedi ve açıklama
- `/admin` üzerinden şifre ile giriş, ürün ekleme/düzenleme/silme, stok ve fiyat değişikliği
- Doğrudan **.3mf, .glb, .stl** yükleme (maks. 32 MB); müşteri tarafında gerçek 3D model açılır
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
2. Render'da **New > Web Service** seç, GitHub deposunu bağla. **Runtime: Node**, **Build command:** `echo No dependencies`, **Start command:** `node server.js`.
3. **Environment** bölümünde `ADMIN_PASSWORD` anahtarını oluştur; uzun, özel bir şifre ayarla.
4. Render'ın verdiği `https://...onrender.com` bağlantısı müşteri müzesi; `https://...onrender.com/admin` yönetici panelidir.
5. **ÖNEMLİ:** Render'ın ücretsiz planında yerel dosya sistemi kalıcı değildir. Yeni ürünler ve 3MF dosyaları yeniden başlatma/yeniden deploy sonrasında kaybolabilir. Kalıcı yayın için ücretli persistent disk veya harici depolama gerekir. Kalıcı disk takarken mount path olarak `/opt/render/project/src/storage` seçilebilir; `DATA_DIR` değişkenini bu yola ayarla (varsayılan yol da aynısıdır). Render'da persistent disk ücretli planda mevcuttur.

## Sınırlar ve sonraki geliştirmeler

- İlk sürümde **sepet, ödeme, üyelik ve sipariş yönetimi yoktur**; ürün sergileme/inceleme çalışır.
- 3MF ayrıştırıcısı 3MF'in ana model ve temel malzeme bilgilerini destekler; bazı ileri eklentiler, renkler veya üreticiye özel nitelikler görünmeyebilir. Bu durumda **GLB** kullanmak daha iyi sonuç verebilir.
- 3MF, STL gibi baskı formatları WebGL için optimize değildir; çok yüksek poligonlu dosyalar telefonda ağır açılabilir. 10–20 MB altında, optimize modeller önerilir.
- Ürünler JSON dosyasında saklanır, büyük ölçekli gerçek satış için veri tabanı + objelerin bulutta saklanması + daha kapsamlı admin yetkilendirmesi eklenmelidir.
- Açılış ürünleri yalnızca örnektir: fiyatlar da dahil olmak üzere yayın öncesi admin panelinden düzenleyin/silin.
- Müze vitrini ürün sayısına göre uzayacak şekilde tasarlanmıştır; koleksiyon panelinden tüm ürünlere her zaman erişilebilir.

## Dosya yapısı

- `server.js`: API, admin oturumu, 3MF dosya kaydı
- `public/index.html`: Müşteri müzesi
- `public/museum.js`: Birinci şahıs hareket, Three.js müzesi, 3D model görüntüleme
- `public/admin.html`: Admin paneli
- `public/admin.js`: Ürün formu, yönetim API'si
- `public/style.css`: Arayüz tasarımı
- `storage/`: Ürün verisi ve yüklenen modeller (ilk çalıştırmada oluşur)

## 3MF yükleme testi

`examples/ornek-test-kup.3mf` dosyası, admin yükleme işlemini denemek için gerçek bir basit 3MF küp geometrisi içerir. Yönetici panelinde **Yeni ürün ekle** > **3D model yükle** alanından seçebilirsin.
