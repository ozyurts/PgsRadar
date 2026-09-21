# PGS Radar

Pegasus Havayolları filosunun canlı ADS-B verisiyle konum takibini 3D bir küre
üzerinde gösteren, bağımsız bir web uygulaması.
Vite + CesiumJS ile yazıldı, Apple'ın ürün sayfalarındaki sade/cam-efektli
estetikten ilham alıyor.

## Belgeler

| Dosya | Neyi anlatır |
| --- | --- |
| `README.md` | **Ne çalışıyor:** veri yolu, uç noktalar, kurulum, bilinen sınırlar |
| `DESIGN.md` | **Neden böyle görünüyor:** ürün ve arayüz kararları, gerekçeleriyle |
| `CLAUDE.md` | **Nasıl çalışılır:** kurallar, doğrulama yöntemi, bilinen tuzaklar |

Üçü de kod kadar bakımlıdır; bir davranışı veya gerekçeyi değiştiren her
değişiklik ilgili dosyayı aynı commit içinde günceller.

## Nasıl çalışıyor

- **Veri**: `api/states.js` topluluk ADS-B verisini sunucu tarafında çekip
  çağrı işareti `PGT` ile başlayan (Pegasus'un ICAO kodu) uçuşları süzer;
  `src/flights.js` bunu tüketen ince bir istemcidir. Anahtar gerekmez.
- **Görselleştirme**: `src/main.js`, ion hesabı gerektirmeyen bir CesiumJS
  `Viewer` kurar (`baseLayer: false` + düz ellipsoid terrain + Esri Light Gray
  Canvas harita karoları), ve her uçuş için heading'e göre döndürülen bir
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

### İz ve rota

Her uçağın arkasında, beslemenin **gerçekten bildirdiği sabitlerden** kurulan
soluk bir iz çizilir; yalnızca izin başı (son sabitle ekrandaki anlık konumu
birleştiren parça) ölü hesapla tahmin edilir. Böylece iz, uçağın nerede
olduğunun dürüst bir kaydı olarak kalır.

Bir uçuş seçilince üç şey devreye girer: izi koyulaşır, etrafında bir halka
belirir ve mevcut rotası boyunca ileriye kesikli bir projeksiyon çizilir.
İzler diğer uçaklarda bilinçli olarak soluktur — otuz uçak havadayken hepsi
parlak olsa harita spagettiye döner.

Kesikli çizgi, kalkış/varış çifti doğrulanabildiyse **varış havalimanına**
yönelir (büyük daire boyunca). Doğrulanamadığında — kaynaklar çeliştiğinde,
ölçümde uçuşların kabaca üçte birinde — mevcut rotanın ileri projeksiyonuna
düşer; aksi halde çizgi tamamen kaybolurdu.

Çizginin irtifası uçağın ölçülen yüksekliğinden varışta sıfıra iner, böylece
havalimanı işaretinin üstünde asılı kalmaz. İki uç da bilinir (irtifa
ölçülmüştür, havalimanı yerdedir) ve aradaki yatay yol zaten bir yaklaşım
olduğu için yüksekliği de aynı şekilde yaklaştırmak yeni bir iddia katmaz.
Bu mesafelerde eğim varışa yakın yer dışında görünmez.

Çizginin ucundaki varış havalimanı, IATA koduyla haritada işaretlenir. Yakın
zumda kadrajın dışındadır — uzaklaşınca ya da çizgi boyunca kaydırınca
görünür. Yalnızca varış işaretlenir: kalkış uçağın arkasında kalır ve
"bu nereye gidiyor" sorusuna bir şey katmaz.

#### Listede rota

Havadakiler listesinde her satırın ikinci satırı tescil numarasının yanına
kalkış/varış çiftini de yazar: `TC-NCA · SAW → ESB`. Ad değil kod, çünkü
"Sabiha Gökçen → Esenboğa" telefon genişliğindeki bir satıra sığmıyor ve
noktalanarak kesilmiş adlardan oluşan bir sütun tam da kaçınılmak istenen
görüntü. Kart adları zaten açık yazıyor.

Rota doğrulanamamışsa satır yalnızca tescil numarasıyla kalır — satır
yüksekliği değişmez, boşluk açılmaz.

Bu, bir uçuş yerine yirmi küsur sorgu demek. Üç şey bunu ucuzlatıyor:
cevaplar sayfa ömrü boyunca hatırlanır, aynı anda en fazla dört istek
yolda olur (`ROUTE_CONCURRENCY`) ve uç nokta çağrı işareti başına altı saat
kenarda önbelleklenir — yani bir uçuş kalktıktan sonraki ilk ziyaretçi
bedelini öder, sonrakiler CDN'den okur. Bir çağrı işaretinin cevabı uçuş
ortasında değişmediği için çelişki ve bilinmeyen de aynı şekilde
önbelleklenir; hiçbir satır iki kez sorulmaz.

> **Not:** Yön projeksiyonuna düşüldüğünde çizgi bir **uçuş planı değildir**;
> "mevcut rotası sürerse nereye varır" demektir. Süresi `src/main.js`
> içindeki `COURSE_SECONDS` ile ayarlanır.

### Yerdeki uçaklar (ayrı katman)

Apronda ve taksi yolundaki uçaklar kendi katmanlarında çizilir: gri, izsiz
ve rota çizgisiz, ama havadakilerle aynı boyutta. Başta daha küçüktüler —
aynı haritayı uçuşlarla paylaşırken onların önüne geçmemeleri gerekiyordu;
aynı anda tek grup gösterilmeye başlayınca geri çekilecek bir şey kalmadı ve
boyut farkı yalnızca "bunlar daha önemsiz" gibi okunuyordu. **Aktif uçuşlar** panelinin başlığındaki
**Havadakiler / Yerdekiler** anahtarı hangisinin gösterileceğini seçer.
Zemin tercihinin aksine bu seçim hatırlanmaz: her ziyaret havadakilerle
başlar. Zemin bir beğenidir ve sizin kalır; bu ise eline alıp bıraktığın bir
mercek — bir kez apronu incelemiş olmak, ertesi gün sitenin uçuşlar olmadan
açılması anlamına gelmemeli.

İki liste aynı anda gösterilmiyor çünkü iki ayrı soruya cevap veriyorlar ve
karışınca ikisi de kayboluyor: günün herhangi bir saatinde filonun önemli bir
kısmı Sabiha Gökçen'de park halindedir, o kalabalık uçuşları ekrandan iter;
tersi durumda da yirmi uçuşun arasında taksi yapan tek uçak kaybolur. Harita
listeyi izler — listelenen ne ise çizilen odur, ikisinin ayrıştığı üçüncü bir
durum yok.

Anahtar harita kontrollerinde değil listede duruyor: aynı anda listeyi de
seçtiği için harita zemini seçicisinin yanında bir zemin seçeneği gibi
görünüyordu.

Bu katman eklenene kadar yerdeki uçaklar **kısmen** görünüyordu, ki hiç
görünmemelerinden kötüydü. Sebep `api/states.js` içindeki irtifa seçimiydi:
önce `alt_geom` (GPS irtifası), sonra `alt_baro` okunuyordu. Yerdeki bir
uçağın `alt_baro` alanı `"ground"` yazısıdır, ama bazı uçaklar park
halindeyken de GPS irtifası yollamaya devam eder. Böylece bir kısmı elenip
bir kısmı "8 metrede uçuyor" diye geçiyordu. Artık `"ground"` bayrağı
**önce** okunuyor ve sonuç `onGround` olarak istemciye taşınıyor.

Yerdeki uçaklara ölü hesap uygulanmaz. Ölü hesap "uçak burnunun gösterdiği
yöne devam eder" varsayar; bu havada doğrudur, yerde değildir — taksi yolunda
sürekli dönen bir uçak bir dakika içinde çimenliğe yürür. Onun yerine son
bildirilen sabit kullanılır. Aynı sebeple yön alanı `track` yoksa
`true_heading`/`mag_heading`'e düşer: duran bir uçak "gidiş yönü" bildirmez,
o alan boş gelir ve 0'a düşmek hepsini kuzeye çevirirdi.

Her yerdeki uçağın **hangi havalimanında** olduğu hem listede hem kartta
yazar. ADS-B uçağın nerede olduğunu söyler, neyin üstünde durduğunu asla;
ücretsiz hiçbir servis de "bu nokta hangi havalimanı" sorusunu yanıtlamıyor.
Bu yüzden cevap yerel bir tablodan çıkarılıyor (`lib/airports.js`): uçağın
konumuna en yakın havalimanı, 8 km'den yakınsa. Tablo
[OurAirports](https://ourairports.com/data/) verisinden türetildi (kamu malı),
filonun uçtuğu bölgedeki ICAO kodlu büyük ve orta ölçekli havalimanlarıyla
sınırlı: 1372 satır, ~98 KB.

Sefer numarasından bulunamazdı: yerdeki bir uçak ya kalkış ya varış
havalimanındadır ve hangisi olduğu dönüş süresince değişir. Tablo `api/`
dışında duruyor çünkü `api/` altındaki her dosya bir uç noktaya dönüşüyor;
tarayıcı paketine de konmadı — aynı anda yerde bir avuç uçak oluyor, üç soruya
cevap vermek için tabloyu her ziyaretçiye göndermek yanlış takas olurdu.

Yerdeki bir uçağa tıklandığında kamera 900 metreye, 55° eğimle iner ve harita
zemini geçici olarak **uyduya** geçer. Sade zeminin 16'dan sonra detayı yok ve
taksi yolu hiç çizmiyor — apronda duran bir uçağa yakından bakmak boş gri bir
zeminde bir şekil görmek olurdu. Ödünç alınan zemin `localStorage`'a
yazılmaz ve seçim kalkınca eski zemin geri gelir; zemini elle seçerseniz ödünç
biter, tercihiniz kazanır.

Kamera alt zum sınırı bu katman için 20 km'den 350 metreye indirildi; 20 km'den
bakıldığında koca bir apron birkaç düzine piksel genişliğinde kalıyor.

### Uçak tipi

Tip, toplayıcı yanıtında zaten geliyor; ek bir sorgu yok. Ama iki sağlayıcı
aynı şeyi göndermiyor: adsb.lol açıklama alanını (`desc`) da veriyor, adsb.fi
yalnızca ICAO tip kodunu (`t`). Ölçümde 32 uçuşun 7'sinde açıklama boştu.

Bu yüzden ad, önce `api/states.js` içindeki `TYPE_NAMES` tablosundan tip
koduyla üretilir; tablo tanımıyorsa açıklamaya düşülür. Tersi yapılsaydı aynı
A321neo, hangi dairenin hangi sağlayıcıdan yanıt aldığına göre bazen
"AIRBUS A-321neo" bazen hiç görünmezdi. Yeni bir tip filoya girerse tabloya
bir satır eklemek yeterli.

### Kalkış/varış (çapraz doğrulama)

Gerçek kalkış–varış çifti `api/route.js` ile ayrıca çözülür: çağrı işareti
[adsbdb](https://www.adsbdb.com/) ve [hexdb.io](https://hexdb.io/)'ya birlikte
sorulur ve **yalnızca ikisi de aynı çifti verdiğinde** gösterilir.

Kural şundan doğdu: ikisi de neredeyse her PGT çağrı işaretine cevap veriyor
ve yanıldıklarında da aynı özgüvenle cevap veriyorlar. Canlı Pegasus
uçuşlarında ölçüldüğünde 6 uçuşun 2'sinde **tamamen farklı** havaalanı çifti
verdiler. Tek kaynağa güvenmek, kullanıcıya makul görünen yanlış bir rotayı
azımsanmayacak sıklıkta göstermek demekti — kimse doğru görünen bir etiketi
sorgulamaz. Çeliştiklerinde aralarından birini seçmek yerine "doğrulanamadı"
denir ve adaylar bilinçli olarak gizlenir; "ya A ya B" demek, okuyucuyu
tahmin etmeye davet eder.

Sorgu yalnızca kullanıcının seçtiği uçuş için yapılır (filonun tamamı için
değil) ve bir çağrı işaretinin rotası uçuş sırasında değişmediği için yanıt
6 saat cache'lenir. Seçim değişmediği sürece anketler yeniden sorgu
tetiklemez.

Seçim vurgusu uçak başına değil, seçili olanı takip eden tek bir katman
olarak kuruludur; aksi halde her uçakta biri hariç hep boşta duran bir
vurgu çifti taşınırdı.

### Harita zemini

Zemin Esri'nin **Light Gray Canvas** servisinden gelir; anahtar gerektirmez.
Esri bu stili ikiye ayırır: `World_Light_Gray_Base` yer adı içermez,
`World_Light_Gray_Reference` yalnızca etiketleri taşır — ikisi de bağlanır.
Karo adresleme sırası `{z}/{y}/{x}`'tir (önce satır, sonra sütun), alışıldık
`x/y` değil.

Proje CARTO Positron ile başlamıştı; CARTO anahtarsız karolara "API KEY
REQUIRED" filigranı basmaya başlayınca bırakıldı. Bir gün Esri de aynısını
yaparsa `src/main.js` içindeki `ESRI` sabitini değiştirmek yeterli.

#### Zemin seçenekleri

Alt ortadaki seçiciden üç zemin arasında geçiş yapılır; tercih tarayıcıda
saklanır. `src/main.js` içindeki `BASEMAPS` tablosuna satır eklemek yeni bir
seçenek için yeterlidir, varsayılan ise `DEFAULT_BASEMAP` ile belirlenir.
Varsayılan rölyef: küreye üstünde durduğu bir zemin veriyor, tam coğrafi bir
haritanın etiket kalabalığını getirmeden — irtifadaki bir uçağın "bir yerin
üstünde" okunmasını sağlayan şey bu. Daha önce seçim yapmış bir ziyaretçinin
tercihi değişmez; varsayılan yalnızca ilk açılışta geçerlidir.

| Seçenek | Katman | Not |
| --- | --- | --- |
| Sade | Light Gray Canvas | Aynı karonun boyutu ~3 KB |
| Rölyef | World Shaded Relief | **Varsayılan.** Coğrafi ama sakin. ~14 KB. En fazla z13 |
| Uydu | World Imagery | ~22 KB. z19'a kadar iner |

Karo boyutu görsel yoğunluğun iyi bir göstergesi: rölyef sade zeminin ~4
katı, uydu ~7 katı detay taşır. Denenip elenenler: NatGeo (~39 KB, ~12 kat)
ve Physical/Terrain — uçak ikonları ve iz çizgileriyle yarışıyorlardı.

Uydu zemini koyu olduğu için küre ve uzay rengi, küre üstündeki yazılar ve
Cesium'un atıf şeridi `body[data-basemap]` üzerinden ayrıca ayarlanır; aksi
halde açık tema grileri koyu zeminde kayboluyordu.

### Mobil yerleşim

680px altında uçuş listesi eskiden tamamen gizleniyordu; uçuş seçmenin tek
yolu küredeki ikonu bulup dokunmaktı. Artık liste alttan açılan bir panel ve
kolu da **durum rozetinin kendisi** — zaten uçuş sayısını gösterdiği için
doğal bir eşleşme, ayrıca alt şeride (footer, zemin seçici, atıf) dördüncü
bir eleman sıkıştırmak gerekmiyor.

Panel cam efektli olduğundan açıkken altındaki yazılar içinden okunuyordu;
footer, zemin seçici ve Cesium atıf şeridi açıkken soluklaştırılır. Karartma
katmanı yalnızca mobilde etkindir: masaüstünde liste zaten ekranda olduğu
için rozetin dokunuşu görünür bir iş yapmamalı.

Üstteki "PGS Radar" marka bloğu kaldırıldı — ekranda yer kaplıyor ama bir işe
yaramıyordu; ad zaten sayfa başlığında duruyor.

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

- **Kalkış/varış kapsaması**: Çapraz doğrulama gereği, iki kaynak
  çeliştiğinde rota gösterilmez; ölçümde bu uçuşların yaklaşık üçte biriydi.
  Kapsamayı yükseltmek doğruluktan ödün vermek anlamına gelir. Kesin bilgi
  isteyen bir kullanım için ücretli bir tarife API'si (AeroDataBox,
  FlightAware AeroAPI, aviationstack) gerekir — bunlar tahmine değil uçuş
  planına dayanır.
- **Heading döndürme**: Uçak ikonu ekran-uzayında (`alignedAxis: UNIT_Z`)
  döndürülüyor; bu çoğu görünümde doğru sonucu verir ama kamera aşırı
  eğildiğinde küçük sapmalar olabilir.
- **Kapsama**: Daireler Pegasus'un tarifeli ağını kapsar; bunun dışına çıkan
  bir uçuş listede görünmez. Kapsamı genişletmek için `api/states.js`
  içindeki `CIRCLES` listesine merkez ekleyin.
- **Yer kapsaması**: ADS-B kapsaması topluluk alıcılarına dayanır; alıcı
  yoğunluğunun düşük olduğu bölgelerde uçuşlar eksik görünebilir.
- **Havalimanı eşleşmesi**: En yakın havalimanı kuralı, uçak gerçekten bir
  havalimanındayken doğru çalışır; 8 km yarıçap içinde kalan başka bir
  pist yoksa. Tabloda küçük havaalanları yok, dolayısıyla bir uçak çok
  küçük bir piste inerse "Havalimanı belirlenemedi" yazar.
- **Yerdeki uçaklar**: Yalnızca transponder'ı açık olanlar görünür. Kapıda
  bekleyen bir uçak transponder'ını kapattığında listeden düşer; bu "uçak
  orada değil" demek değildir. Ayrıca yerdeki konum apron ölçeğinde birkaç
  on metre sapabilir, yani simge kesin park pozisyonunu göstermez.
- **Sefer numarası**: Uçuşlar ICAO çağrı işaretiyle gösterilir (`PGT612`),
  yolcunun bildiği IATA sefer koduyla (`PC612`) değil. Bu bilinçli bir
  tercih, eksiklik değil:
  - adsbdb'nin `callsign_iata` alanı havayolu kodunu **H9** veriyor; bu
    Pegasus'un yıllar önce bıraktığı eski IATA kodu, güncel kod PC.
  - Aynı alan harfli çağrı işaretlerinde düz karakter değiştirme yapıyor
    (`PGT6AK` → `H96AK`). Ortada öyle bir sefer yok.
  - Pegasus uçuşlarının kabaca yarısı harfli çağrı işareti kullanıyor
    (`PGT480Q`, `PGT34VX`); bunların IATA karşılığı **yoktur**.
  Saf sayısal olanlarda `PGT612 → PC612` dönüşümü kendimiz yapılabilir ama
  bu bir çıkarımdır, doğrulanmış veri değil — sayının sefer numarasıyla
  eşleşmesi yaygın bir pratiktir, kural değil.
- **Mobil**: 680px altında uçuş listesi, durum rozetine dokununca açılan bir
  alt panele dönüşür (bkz. aşağıdaki not).
