# PGS Radar

Pegasus Havayolları filosunun [OpenSky Network](https://opensky-network.org) verisiyle
canlı konum takibini 3D bir küre üzerinde gösteren, bağımsız bir web uygulaması.
Vite + CesiumJS ile yazıldı, Apple'ın ürün sayfalarındaki sade/cam-efektli
estetikten ilham alıyor.

## Nasıl çalışıyor

- **Veri**: `src/opensky.js`, OpenSky'nin `/states/all` uç noktasını çağırıp
  çağrı işareti `PGT` ile başlayan (Pegasus'un ICAO kodu) uçuşları filtreler.
  Kimlik doğrulama gerekmez.
- **Görselleştirme**: `src/main.js`, ion hesabı gerektirmeyen bir CesiumJS
  `Viewer` kurar (`baseLayer: false` + düz ellipsoid terrain + CARTO Positron
  açık tema harita karoları), ve her uçuş için heading'e göre döndürülen bir
  uçak ikonu (billboard) yerleştirir.
- **Arayüz**: `src/style.css`, cam-efektli (backdrop-blur) paneller, SF Pro
  yazı tipi yığını ve minimal turuncu (Pegasus) vurgu rengiyle Apple tarzı
  bir görünüm hedefler. Açık/koyu tema sistem tercihine göre otomatik geçer.

## Kredi bütçesi ve veri yolu

OpenSky'nin anonim erişimi günlük kredi bütçesiyle sınırlıdır (yazıldığı
sırada ~400 kredi/gün, IP başına). Uygulama bunun içinde kalmak için iki şey
yapar:

1. **Bounding box ile sorgu.** Tüm gezegeni isteyen bir `/states/all` yanıtı
   birkaç megabayt ve 4 kredi; sınırlandırılmış olanı 1 kredi ve çok daha
   küçük. Varsayılan kutu Avrupa, Kuzey Afrika, Orta Doğu ve Orta Asya'yı
   kapsar (Pegasus'un uçtuğu alan).
2. **Tarayıcıdan doğrudan çağrı.** İstek sunucudan değil ziyaretçinin
   tarayıcısından gider; böylece her ziyaretçi kendi IP'sinin kredi
   bütçesini harcar, tek bir ortak bütçe değil.

Doğrudan çağrı başarısız olursa (CORS, rate limit) uygulama `/api/states`
altındaki serverless yedeğe düşer. Bu yedek tek bir çıkış IP'si kullandığı
için yanıtı edge'de 20 saniye cache'ler.

### Daha yüksek kota (opsiyonel)

Vercel projesine `OPENSKY_CLIENT_ID` ve `OPENSKY_CLIENT_SECRET` ortam
değişkenlerini eklerseniz `/api/states` OpenSky'nin OAuth2 client-credentials
akışını kullanır. Bu değerler sunucu tarafında kalır, tarayıcıya gönderilmez —
client secret'ı asla doğrudan istemci koduna koymayın.

## Yerel geliştirme

```bash
npm install
npm run dev
```

`http://localhost:5173` adresinde açılır.

`npm run dev` ve `npm run preview` yalnızca statik siteyi sunar; `/api/states`
yedeğini yerelde çalıştırmak isterseniz `vercel dev` kullanın.

## Ortam değişkenleri

Hepsi opsiyoneldir; hiçbiri ayarlanmadan uygulama çalışır. Örnekler için
`.env.example` dosyasına bakın.

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `VITE_CALLSIGN_PREFIX` | `PGT` | Takip edilecek çağrı işareti öneki |
| `VITE_POLL_INTERVAL_MS` | `25000` | OpenSky yenileme aralığı (ms) |
| `VITE_BBOX_LAMIN` / `VITE_BBOX_LAMAX` | `15` / `65` | Sorgu kutusu enlem sınırları |
| `VITE_BBOX_LOMIN` / `VITE_BBOX_LOMAX` | `-15` / `80` | Sorgu kutusu boylam sınırları |
| `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` | — | Sunucu tarafı OAuth2 (yukarı bakın) |

## Vercel'e deploy

Proje Vercel'de `pgsradar` adıyla kurulu ve bu GitHub reposuna bağlı; üretim
dalına push atmak otomatik deploy tetikler. Sıfırdan kurmak isterseniz:

1. Vercel'de **New Project** → repoyu import edin.
2. Framework otomatik olarak Vite algılanır (`vercel.json` bunu teyit eder).
3. **Project Name** alanına `pgsradar` yazın — Vercel proje adını
   kullanılabilirse doğrudan alt domain olarak atar: `pgsradar.vercel.app`.
4. `/api` klasörü Vite build'inin dışında, serverless function olarak
   ayrıca deploy edilir; ek ayar gerekmez.

## Bilinen sınırlamalar / geliştirilebilecek noktalar

- **Uçuş rotası bilgisi**: OpenSky state vector'leri kalkış/varış havaalanı
  bilgisi içermez — sadece anlık konum/irtifa/hız/heading verir. Rota
  bilgisi göstermek isterseniz OpenSky'nin ayrı "flights" uç noktasını veya
  ikinci bir kaynağı (ör. AviationStack) devreye almanız gerekir.
- **Heading döndürme**: Uçak ikonu ekran-uzayında (`alignedAxis: UNIT_Z`)
  döndürülüyor; bu çoğu görünümde doğru sonucu verir ama kamera aşırı
  eğildiğinde küçük sapmalar olabilir.
- **Bounding box**: Varsayılan kutunun dışına çıkan bir PGT uçuşu (ör. çok
  uzak bir tarifeli olmayan uçuş) listede görünmez. Kutuyu yukarıdaki env
  değişkenleriyle genişletebilirsiniz.
- **Mobil**: 680px altında uçuş listesi paneli gizlenir; küre üzerinden
  uçağa dokunarak detay kartına ulaşılır.
