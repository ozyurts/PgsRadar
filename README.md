# PGS Radar

Pegasus Havayolları filosunun canlı ADS-B verisiyle konum takibini 3D bir küre
üzerinde gösteren, bağımsız bir web uygulaması. İki sayfası var: küre (`/`) ve
tek bir uçuşu iniş anına kadar izleyen **uçuş takibi** (`/takip`).
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

## İki sayfa

| Adres | Ne yapar | Ağırlık |
| --- | --- | --- |
| `/` | Tüm filo, 3B küre üzerinde | Cesium dahil |
| `/takip` | Sefer numarasıyla **tek uçuş**, iniş bildirimine kadar | ~24 KB (Cesium yok) |

İkisi de aynı `/api/states` yanıtını tüketir, yani aynı edge cache'ini paylaşır:
takip sayfasının ziyaretçisi üst kaynağa ek yük bindirmez. Ayrıntı için
[Uçuş takibi](#uçuş-takibi-takip) bölümüne bakın.

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

### Üçüncü bir kaynak denendi, bulunamadı

Şu an iki kaynak var ve biri kapanırsa diğeri devralıyor. Üçüncü bir anahtarsız
toplayıcı eklemek için adaylar **21 Eylül 2026'da fra1'den ölçüldü**; hiçbiri
kullanılabilir değil:

| Aday | Sonuç |
| --- | --- |
| `api.airplanes.live` | Her yol **403**: "Please contact us at contact@airplanes.live…" — onay kapısı. Ana site erişilebilir, yani IP engeli değil |
| ↳ resmî belge | `airplanes.live/api-docs/` istemcide çizilen bir Stoplight sayfası; tanım `airplanes.live/openapi.yaml` |
| `api.adsb.one` | **403**, Cloudflare "Attention Required" sayfası |
| `adsb.one/api/v2/...` | 200 ama HTML — sitenin kendi arayüzü, API değil |
| `api.theairtraffic.com` | Ad çözülmüyor |
| `api.planes.live` | Ad çözülmüyor |
| `api.adsb.lol` (kontrol) | **200**, 84 uçak — ölçümün kendisi çalışıyor |

**airplanes.live'ın belgesi ayrıca okundu** (`openapi.yaml`, OpenAPI 3.1):
sunucu `https://api.airplanes.live`, canlı sorgu uç noktası
`/v2/point/{lat}/{lon}/{radius}`, yarıçap en fazla 250 nm — yani yukarıda
denenen adres **doğru adres**. Belgede `security`, `securitySchemes`, API
anahtarı veya token diye bir şey yok; belgelenen API açık görünüyor.

**Sonra doğrudan soruldu ve cevaplandı** (21 Eylül 2026). İşletmecinin cevabı:
API artık **yalnızca katkıcılara** açık. Erişim otomatik veriliyor ama
**besleyicinin IP adresine** bağlı: bir alıcı kurarsan aynı IP'den API'ye
erişebiliyorsun. Gerekçe olarak barındırma maliyetinin iki yılda ~%300 artması
ve haftada 2 milyarı aşan istek hacmi gösteriliyor. Uygulama/web sitesi
işletenler için ayrıca aylık sponsorluk isteniyor ($25 / $50).

Bu proje için bu kapı **yapısal olarak kapalı**, sponsorluktan bağımsız
olarak: istekler Vercel'in `fra1` bölgesinden çıkıyor, ev alıcısının IP'sinden
değil. Serverless fonksiyonların sabit çıkış IP'si de yok. IP eşleşmesine
dayanan bir erişim modeli bu mimariyle uyuşmuyor; token/başlık tabanlı bir
erişim verilmediği sürece alıcı kurmak da sorunu çözmez.

Sonuç: anahtarsız üçüncü kaynak yok, ve airplanes.live ücretli/katkı koşuluyla
bile bu mimariye uymuyor.

Aynı ölçümde hız limiti de yeniden doğrulandı: `api.adsb.lol`'a aralıksız 6
sorgu → **2'si 429**. Yani tek kaynak 12 dairenin tamamını taşıyamaz; bir
sağlayıcı düştüğünde kapsama eksilir (`degraded: true`).

Üçüncü kaynak ihtimali tükendiği için bu durumun **arayüzde söylenmesi**
tercih edildi: `/api/states` yanıtındaki `degraded` bayrağı istemciye taşınır,
durum rozetindeki nokta kehribara döner ve uçuş listesinin üstünde bir uyarı
şeridi çıkar. Ayrıntı ve gerekçe: `DESIGN.md`.

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

## Uçuş takibi (`/takip`)

Küre "Pegasus şu anda ne uçuruyor" sorusuna cevap verir. Takip sayfası başka
bir soruya cevap verir: **"benim uçuşum nerede ve indi mi?"** Bu yüzden kürenin
filtrelenmiş hâli değil; ayrı bir giriş sayfası, tek bir kart ve bir bitiş.

Bağlantı paylaşılabilir: `https://pgsradar.vercel.app/takip?ucus=PGT612`
adresini açan herkes aynı uçuşu görür. Sayfa takip başlayınca URL'yi kendisi
çağrı işaretine göre yazar, yani adres çubuğundaki şey her zaman paylaşılabilir
olandır.

### Sefer numarası → çağrı işareti

Kutuya `PC612`, `612` ya da çağrı işaretinin kendisi (`PGT480Q`) yazılabilir.
Dönüşüm `src/callsign.js` içinde tek bir yerde yapılır.

Küre **hiçbir zaman IATA sefer numarası göstermez** ve bunun gerekçesi hâlâ
geçerli (aşağıdaki "Sefer numarası" maddesi). Ama numarayı *göstermek* ile
kullanıcıdan *almak* aynı şey değil: yolcunun elinde PC612 yazan bir biniş
kartı var, onu kabul etmemek sayfayı tam da hedef kitlesi için kullanılamaz
kılardı. Bu yüzden eşleme yapılır ve **yapıldığı söylenir**: karttaki kimlik
her zaman çağrı işaretidir, girilen numara yanında bir not olarak durur —
"PC612 için PGT612 çağrı işareti arandı. Sayısal seferlerde bu eşleşme tutar;
harfli seferlerin IATA karşılığı yoktur."

### Uçuşun evreleri

`src/track.js` bir durum makinesi işletir:

| Evre | Ne demek |
| --- | --- |
| `bekleniyor` | Çağrı işareti ADS-B verisinde yok. Kalkmamış, transponder kapalı ya da kapsama dışı olabilir |
| `yerde` | Yerde, ve **bu takip boyunca havada görülmedi** |
| `havada` | Havada |
| `indi` | Havada görüldükten sonra yere indi. **Son durak** |
| `kayip` | Havada görüldü, sonra 6 dakikadır sinyal yok |

İniş yalnızca `yerde → havada → yerde` sırası gözlendiğinde ilan edilir. "Havada
görüldü" bayrağı için irtifanın 300 m'yi, hızın 40 m/s'yi geçmesi aranır: park
hâlindeki bazı uçaklar barometrik irtifa yollamaya devam ediyor ve o hâliyle
"8 metrede uçuyor" okunuyor; bu latch olmadan bir sonraki anket iniş ilan
ederdi. Bayrak `localStorage`'da tutulur, yani sayfa yenilense de uçuş
ortasında dönülse de kaybolmaz.

**Sinyalin kesilmesi iniş sayılmaz.** ADS-B gönüllü alıcılara dayanır ve uçaklar
yerde transponder'ını kapatır: kapsama boşluğu ile iniş aynı şekilde sessizleşir.
Bu durumda kart "Sinyal kesildi, iniş teyit edilemedi" der ve **ölçülmüş** olanı
yazar: son verinin saati, irtifası, konumu, ve rota doğrulanmışsa varış
havalimanına o anki uzaklık. 4 km'de 300 ft'teki bir sessizlik ile seyir
irtifasında 400 km'deki bir sessizlik aynı şey değil; okuyucunun kalan şüpheyi
ölçebilmesi için sayı verilir, ama iniş denmez.

### Bildirim

Kalkışta, inişte ve sinyal kesildiğinde tarayıcı bildirimi gönderilir; her biri
takip başına bir kez. Kalkış bildirimi yalnızca uçağı **yerde görmüş** bir
oturuma gider — sayfayı uçak seyir irtifasındayken açan birine "havalandı"
demek uçuş hakkında değil sayfa hakkında haber vermek olurdu.

Bu bir **tarayıcı bildirimi**, sunucu push'u değil: sayfa açık olduğu sürece
çalışır (sekme arkada, telefon kilitli olabilir), kapalıyken çalışmaz. Gerçek
web push için VAPID anahtar çifti, abonelikleri tutacak bir depo ve inişi fark
edecek dakikalık bir cron gerekir — üçü de bu projenin bilinçli olarak
kaçındığı şeyler (anahtar, veritabanı, ücretli zamanlayıcı). Ekleme kararı
sorulmadan alınmadı; `DESIGN.md`'de gerekçesi var.

Android sayfadan `new Notification()` çağrılmasına izin vermez, bildirimin bir
service worker'dan çıkması gerekir: `public/sw.js` bunun için var ve **hiçbir
şey cache'lemez** (her deploy sonrası bayat bir kabuk servis etmemek için).
iOS'ta bildirim yalnızca ana ekrana eklenmiş bir PWA'da çalışır; bu yüzden
`public/manifest.webmanifest` ve `public/icon-*.png` var. Simgeler
`tools/make-icons.mjs` ile üretilir — küredeki uçak simgesinin aynı poligonu.

### Varış tahmini

Rota doğrulanmışsa (yani `api/route.js` iki kaynağın hemfikir olduğunu
söylüyorsa) kartta ilerleme çubuğu, kalan mesafe ve tahmini varış saati
görünür. Tahmin, kalan büyük daire mesafesinin **o anki yer hızına** bölümüdür
ve ekranda böyle etiketlenir ("mevcut hıza göre"). Tarife, rüzgâr ve iniş
profili yok; onlar ücretli bir uçuş planı API'si ister.

**Ters bacak koruması.** Doğrulanmış bir rota, uçağın o anda uçtuğu bacak
olmak zorunda değil: aynı sefer numarası dönüşte de kullanılabiliyor. Canlı
veride ölçüldü (21 Eylül 2026): `PGT1883` için iki kaynak da **ESB → ECN**
diyordu, ama uçak 37.16/33.23 noktasında **354°** ile kuzeye, yani Kıbrıs'tan
*uzağa* uçuyordu — ECN'e olan kerteriz 174°, aradaki fark 180°. Bu yüzden
uçağın gidiş yönü ile varışa olan kerteriz arasındaki açı 100°'yi geçerse
ilerleme çubuğu ve varış tahmini gizlenir ve sebebi yazılır. Kalkış/varış
çifti gösterilmeye devam eder — gizlenen, o çifte dayanan *tahmin*. Küredeki
kesikli çizgi aynı durumu yaşıyor ama orada iddia daha zayıf; çubuk ve saat
çok daha güçlü bir iddia.

### Küreyle bağ

Karttaki "Haritada gör" düğmesi küreyi `/?ucus=PGT612` ile açar; küre o uçağı
beslemede görür görmez seçer, gerekiyorsa liste kipini de değiştirir. Küredeki
"Uçuş takibi" düğmesi ters yönde çalışır.

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

Sayfa simgeleri değişirse `node tools/make-icons.mjs` ile yeniden üretilir.

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
5. `vercel.json` içindeki tek rewrite `/takip` adresini `takip.html`e
   bağlar (`cleanUrls` açılmadı: o, `/diag.html` gibi mevcut adresleri de
   yönlendirirdi).

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

  **Harfli olanlar için eşleme aranıp bulunamadı** (21 Eylül 2026, fra1'den
  ölçüldü). Örnek: `PGT30GF` yolcunun elinde **PC904**. "30GF" ile "904"
  arasında hiçbir karakter ilişkisi yok; bu bir çevirme değil, arama.

  | Aday | Sonuç |
  | --- | --- |
  | adsbdb ham yanıtı | `callsign_iata: "H930GF"` — eski IATA kodu + gövdenin düz kopyası |
  | **Kaynağın kaynağı**: [VRS standing-data](https://github.com/vradarserver/standing-data) | Kolonlar `Callsign,Code,Number,AirlineCode,AirportCodes`; `PGT30GF,PGT,30GF,PGT,LOWW-LTFJ`. **"Number" sefer numarası değil, çağrı işaretinin gövdesi** |
  | www.flypgs.com | `fra1`'den okunabiliyor, robots.txt izin veriyor (`Allow: /`, `Content-Signal: ai-input=yes`) — ama uçuş durumu aracı orada değil: `/en/flight-status` ve `/ucus-durumu` 200 ile "Sayfa Bulunamadı" |
  | web.flypgs.com ve `www.flypgs.com/` | **403**, AkamaiGHost. Kurum politikası reddi; aşılmadı |

  İkinci satır belirleyici: iki rota kaynağımızın beslendiği açık veri
  setinde IATA sefer numarası diye bir **alan yok**. Dolayısıyla bu yoldan
  hiç gelmeyecek; adsbdb'yi tekrar denemenin anlamı yok. Eşlemeyi veren
  anahtarsız bir kaynak bulunamadı; kalan yol ücretli bir tarife API'si.

  > Aynı veri seti 7.939 PGT çağrı işareti için kalkış/varış çifti tutuyor.
  > İki kaynağımızın da bunun üzerine kurulmuş olması mümkün — öyleyse
  > "iki bağımsız kaynak" çapraz doğrulaması sanıldığından zayıf demektir.
  > Ölçülmedi, not edildi.
- **Mobil**: 680px altında uçuş listesi, durum rozetine dokununca açılan bir
  alt panele dönüşür (bkz. aşağıdaki not).
- **Bildirim sayfa kapalıyken gelmez.** `/takip` tarayıcı bildirimi kullanır;
  sunucu push'u anahtar + depo + dakikalık cron ister. iOS'ta ayrıca sayfanın
  ana ekrana eklenmiş olması gerekir.
- **İniş tespiti beslemeye bağlıdır.** Uçak inişten hemen sonra transponder'ını
  kapatırsa iniş "teyit edilemedi" olarak kalır; sayfa tahmin yürütmez.
- **Takip tek uçuş içindir.** Aynı anda birden fazla uçuş izlenemez; ikinci bir
  uçuş takibe alındığında birincisinin ilerlemesi (havada görülmüş olması
  dahil) silinir.
