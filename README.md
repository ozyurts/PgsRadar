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

## Veri yolu

Veri **sunucu tarafından** çekilir (`api/states.js`), tarayıcıdan değil. Bunun
iki zorunlu sebebi var ve ikisi de ölçülerek bulundu:

1. **CORS.** OpenSky yanıtı `access-control-allow-origin: https://opensky-network.org`
   başlığıyla dönüyor — yani başlık var ama yalnızca OpenSky'ın kendi sitesine
   izin veriyor. Başka bir origin'deki tarayıcı yanıtı hiçbir zaman okuyamaz.
2. **Bölge.** OpenSky Zürih'te barınıyor ve her bulut bölgesinden bağlantı
   kabul etmiyor. Vercel'in `iad1` bölgesinden TCP handshake 10 saniyede
   timeout oluyor; `fra1`'den aynı istek ~75 ms'de dönüyor. Bu yüzden
   fonksiyon `vercel.json` içinde `fra1`'e sabitlendi. **Bu ayarı
   değiştirmeyin**, yoksa veri akışı durur.

Sorgu bir bounding box ile sınırlandırılır; yanıt megabaytlar yerine ~35 KB olur.

### Kredi bütçesi

Tüm ziyaretçiler tek bir çıkış IP'sini paylaştığı için OpenSky kredi bütçesi de
ortaktır. Bunu ayakta tutan şey edge cache'idir: OpenSky'a giden istek sayısı
ziyaretçi sayısıyla değil, **izlenen farklı `CACHE_SECONDS` penceresi sayısıyla**
orantılıdır. 60 saniyelik cache ile 10 kişi de 1 kişi de izlese dakikada tek bir
üst-kaynak isteği olur.

Anonim erişim günde birkaç yüz kredi verir ve bu boyutta bir kutu en ucuz
kademe değildir; trafik artarsa ya `CACHE_SECONDS` değerini büyütün ya da
aşağıdaki kimlik bilgilerini ekleyin.

### Daha yüksek kota (opsiyonel)

Vercel projesine `OPENSKY_CLIENT_ID` ve `OPENSKY_CLIENT_SECRET` ortam
değişkenlerini eklerseniz `/api/states` OpenSky'nin OAuth2 client-credentials
akışını kullanır ve kota belirgin şekilde yükselir. Bu değerler sunucu
tarafında kalır, tarayıcıya gönderilmez — client secret'ı asla doğrudan
istemci koduna koymayın.

## Yerel geliştirme

```bash
npm install
npm run dev
```

`http://localhost:5173` adresinde açılır.

`npm run dev` ve `npm run preview` yalnızca statik siteyi sunar; veri için
gereken `/api/states` fonksiyonunu da çalıştırmak üzere `vercel dev` kullanın —
aksi halde yerelde uçuş görünmez.

`/diag.html` adresinde, veri yolunu tarayıcıdan test edip sonucu ekrana yazan
bir teşhis sayfası var.

## Ortam değişkenleri

Hepsi opsiyoneldir; hiçbiri ayarlanmadan uygulama çalışır. Örnekler için
`.env.example` dosyasına bakın.

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `VITE_CALLSIGN_PREFIX` | `PGT` | Takip edilecek çağrı işareti öneki |
| `VITE_POLL_INTERVAL_MS` | `30000` | Arayüzün yenileme aralığı (ms) |
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
