# ThreeDee V7 — müze canlı sohbeti

Bu paket, mevcut **V6**'nın üzerine eklenen **sadece değişen/yeni** dosyalardır. Supabase'deki ürün, yorum, sipariş, sepet ve favori tablolarını değiştirmez. **Canlı siteye bu çalışmada dağıtım yapılmadı.**

## 1) Supabase: SQL'i önce çalıştır

1. https://supabase.com/dashboard → mevcut ThreeDee projesi
2. Solda **SQL Editor** → **New query**
3. Paket içindeki `ThreeDee-V7-Sohbet-Supabase.sql` dosyasını aç ve tamamını editöre yapıştır.
4. **Run** düğmesine bas. **Table Editor** bölümünde `museum_chat_messages` ve `museum_chat_mutes` tabloları oluşacak.
5. Başka tabloyu silme veya önceki V4/V6 kurulum SQL'ini tekrar çalıştırma. Yeni Supabase anahtarı gerekmiyor.

## 2) GitHub'da sadece değişen dosyaları yükle

`https://github.com/threedeetr/3d-urun-muzesi`

- `server.js` — **değiştir**
- `chat-v7.js` — **yeni, ana klasöre**
- `public/index.html` — **değiştir**
- `public/style.css` — **değiştir**
- `public/chat.js` — **yeni**
- `public/admin.html` — **değiştir**
- `public/admin.js` — **değiştir**

Dosyaları doğru klasörlerine koy. `public/museum.js`, `public/shop.js`, `customer-v6.js`, `supabase-store.js` ve diğer dosyalara dokunma.

**Render:** Build Command `echo No dependencies`, Start Command `node server.js` aynı kalacak. Ortam değişkenlerin (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ADMIN_PASSWORD`, varsa `CUSTOMER_SESSION_SECRET`) değişmeyecek.

## 3) Canlı müzede dene

1. `https://threed-urun-muzesi.onrender.com` adresini aç.
2. Sağ alttaki **Sohbet** butonuna bas. Misafirken mesajları okuyabilmelisin.
3. Yazmak için mevcut müşteri hesabıyla giriş yap. İki farklı hesap/telefonla müzeye gir.
4. Bir hesapla "Merhaba!" yaz. Diğer telefonda birkaç saniye içinde görünmeli (yaklaşık **3,5 saniyede bir güncellenir**).
5. Küfür, bağlantı, aynı mesaj tekrarı ve 6 saniyeden sık mesaj denemesi reddedilmeli.
6. `/admin` sayfasında **Canlı sohbet moderasyonu** alanından mesaj silebilir, hesabı **24 saat susturabilirsin**.

## Nasıl çalışıyor?

- Müzenin tamamında **tek, ortak sohbet odası** var.
- Mesajları herkes okuyabilir. **Sadece giriş yapmış, doğrulanmış Supabase hesabı** yazabilir.
- Ad sunucu tarafından müşteri hesabından alınır; gönderici adı mesaj isteğinde değiştirilemez.
- Otomatik filtre; yaygın küfürleri, bazı kamufle yazımları, linkleri, e-postaları ve aşırı noktalama/tekrarları reddeder. Kusursuz otomatik moderasyon garanti edilemez; admin silme/susturma bu nedenle de var.
- **Spam engeli:** mesajlar arasında en az 6 saniye; dakikada en fazla 6, on dakikada en fazla 25 mesaj; aynı mesajı beş dakika tekrar gönderme yasağı. Tek sunucuda ek ani gönderim kilidi de var.
- Son 24 saatin en fazla 60 mesajı arayüzde gösterilir. Daha eski mesajlar Supabase'den yaklaşık 7 gün sonra sunucu tarafından otomatik temizlenir.
- Mobilde açık sohbet paneli varken üç boyutlu sahnenin kontrolleri etkilenmez; sohbet kapanınca müzeye devam edilir.
- Ödeme, sipariş, ürün, 3MF, favori ve Supabase Auth altyapısı değiştirilmedi.

## Sınırlar ve sonraki geliştirmeler

- Bu sürümde sohbet yaklaşık 3,5 saniyelik **kısa sorgulama** ile güncellenir; WebSocket veya Supabase Realtime kanalı kullanılmıyor. Düşük/orta ziyaretçi hacminde prototip için uygundur. Ziyaretçi sayısı büyürse gerçek zamanlı pub/sub ve daha gelişmiş moderasyon gerekir.
- Müzedeki canlı karakterlerin üzerine mesaj balonu koyulmadı; sohbet panelinden yazışılıyor.
- Hakaret ve spam filtreleri sınırlıdır; tüm kötü niyetli ifadeleri yakalayamaz. Ticari ve herkese açık kullanımda raporlama, moderasyon politikası ve kötüye kullanım izleme eklenmeli.
- Ücretsiz Supabase planındaki sorgu ve depolama sınırlarına tabidir.
