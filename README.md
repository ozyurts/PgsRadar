# PGS Radar

Pegasus Havayolları filosunun canlı ADS-B verisiyle konum takibini 3D bir küre
üzerinde gösteren, bağımsız bir web uygulaması.
Vite + CesiumJS ile yazıldı, Apple'ın ürün sayfalarındaki sade/cam-efektli
estetikten ilham alıyor.

## Nasıl çalışıyor

- **Veri**: `api/states.js` topluluk ADS-B verisini sunucu tarafında çekip
  çağrı işareti `PGT` ile başlayan (Pegasus'un ICAO kodu) uçuşları süzer;
  `src/flights.js` bunu tüketen ince bir istemcidir. Anahtar gerekmez.
- **Görselleştirme**: `src/main.js`, ion hesabı gerektirmeyen bir CesiumJS
  `Viewer` kurar (`baseLayer: false` + düz ellipsoid terrain + CARTO Positron
  açık tema harita karoları), ve her uçuş için heading'e göre döndürülen bir
  uçak ikonu (billboard) yerleştirir.
- **Arayüz**: `src/style.css`, cam-efektli (backdrop-blur) paneller, SF Pro
  yazı tipi yığını ve minimal turuncu (Pegasus) vurgu rengiyle Apple tarzı
  bir görünüm hedefler. Açık/koyu tema sistem tercihine göre otomatik geçer.

## Veri yolu

Veri **sunucu tarafından** çekilir (`api/states.js`), tarayıcıdan değil.

Kaynak [adsb.lol](https://adsb.lol), yedeği [adsb.fi](https://adsb.fi) — ikisi de
topluluk ADS-B toplayıcısı, anahtar gerektirmiyor ve Vercel'in `fra1` bölgesinden
50-80 ms'de yanıt veriyor. API tek sorguda bir nokta etrafında en fazla 250 deniz
mili veriyor, bu yüzden Pegasus ağı örtüşen 12 daireyle taranıp sonuçlar `hex`
üzerinden tekilleştiriliyor. Çağrı işareti filtresi ve SI birimine çevirme de
sunucuda yapılır; istemciye yalnızca ilgili uçuşlar iner.

Daireler arka arkaya sorgulanır. Hepsini aynı anda göndermek üst kaynağın bir
kısmını düşürüyordu ve düşen her daire haritada delik demekti. Bir kısmı yine de
başarısız olursa yanıt `degraded: true` ile işaretlenir ve başarısız koordinatlar
loglanır.

### Neden OpenSky değil

Proje OpenSky ile başlamıştı; iki bağımsız engel yüzünden bırakıldı:

1. **CORS.** OpenSky yanıtı `access-control-allow-origin: https://opensky-network.org`
   başlığıyla döner — başlık vardır ama yalnızca kendi sitesine izin verir, başka
   bir origin'deki tarayıcı yanıtı okuyamaz.
2. **Erişim.** Vercel'den OpenSky'a TCP bağlantısı kurulamıyor. `fra1`'den yapılan
   5 denemenin 5'i de 10 saniyede connect timeout verdi. Kimlik bilgisi eklemek
   bunu çözmez: yetkilenmek için önce bağlanabilmek gerekir.

### Bölge kilidi

Fonksiyon `vercel.json` içinde `fra1`'e sabitlenmiştir. Bu, OpenSky döneminden
kalan ve hâlâ isabetli bir tercih: veri kaynakları Avrupa'da, gecikme düşük kalıyor.

### Üst kaynağa saygı

Tüm ziyaretçiler tek bir çıkış IP'sini paylaşır. Bunu ayakta tutan şey edge
cache'idir: üst kaynağa giden istek sayısı ziyaretçi sayısıyla değil, **izlenen
farklı `CACHE_SECONDS` penceresi sayısıyla** orantılıdır. 60 saniyelik cache ile
10 kişi de 1 kişi de izlese dakikada tek bir tarama yapılır; kimse izlemiyorken
hiç istek gitmez. Trafik artarsa `api/states.js` içindeki `CACHE_SECONDS`
değerini büyütün.

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

- **Uçuş rotası bilgisi**: ADS-B yayını kalkış/varış havaalanı bilgisi
  içermez — sadece anlık konum/irtifa/hız/heading verir. Rota bilgisi
  göstermek isterseniz ayrı bir tarife kaynağı gerekir.
- **Heading döndürme**: Uçak ikonu ekran-uzayında (`alignedAxis: UNIT_Z`)
  döndürülüyor; bu çoğu görünümde doğru sonucu verir ama kamera aşırı
  eğildiğinde küçük sapmalar olabilir.
- **Kapsama**: Daireler Pegasus'un tarifeli ağını kapsar; bunun dışına çıkan
  bir uçuş listede görünmez. Kapsamı genişletmek için `api/states.js`
  içindeki `CIRCLES` listesine merkez ekleyin.
- **Yer kapsaması**: ADS-B kapsaması topluluk alıcılarına dayanır; alıcı
  yoğunluğunun düşük olduğu bölgelerde uçuşlar eksik görünebilir.
- **Mobil**: 680px altında uçuş listesi paneli gizlenir; küre üzerinden
  uçağa dokunarak detay kartına ulaşılır.
