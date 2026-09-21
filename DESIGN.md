# DESIGN.md — ürün ve arayüz kararları

Bu dosya PgsRadar'ın **neden** böyle göründüğünü ve davrandığını tutar.
Nasıl çalışıldığı `CLAUDE.md`'de, veri yolunun teknik ayrıntısı
`README.md`'de. Bir karar değiştiğinde burası da değişir ve eski gerekçe
silinmez: *neden değiştiği* yazılır.

---

## Yol gösteren ilkeler

**1. Yanlış bilgi, bilgi yokluğundan kötüdür.**
Doğru görünen yanlış bir etiketi kimse iki kez kontrol etmez. Kalkış/varış
iki bağımsız veritabanına sorulur ve yalnızca ikisi de aynı şeyi söylerse
gösterilir; çeliştiklerinde adaylar bilinçli olarak *gizlenir* — "belki A,
belki B" okuyanı birini seçmeye davet eder, ki kaçınılmak istenen tam da
budur. Ölçümde uçuşların kabaca üçte biri bu durumda.

**2. Ölçülmemiş şey çizilmez — ama iki ucu bilinen bir şey yaklaştırılabilir.**
Bu ikisinin sınırı bir kez tartışıldı ve ilk konum fazla temkinli bulundu:
rota çizgisinin irtifası varışta sıfıra iniyor. Gerekçe: uçağın irtifası
ölçülü, havalimanı yerde, aradaki yatay yol zaten bir yaklaşım — yüksekliği
de aynı şekilde yaklaştırmak yeni bir iddia katmıyor. Buna karşılık ölü
hesap yerdeki uçağa uygulanmaz, çünkü orada "burnunun yönünde devam eder"
varsayımı yanlıştır.

**3. Listelenen ne ise çizilen odur.**
Liste ile haritanın ayrıştığı bir üçüncü durum yok. Bu, "neden bu uçağı
göremiyorum" sorusunun hiç doğmamasını sağlıyor.

**4. Sakinlik, yoğunluğa tercih edilir.**
Zemin, iz, simge boyutu, etiket — hepsi uçakların okunmasına hizmet ettiği
ölçüde var. Görsel yoğunluk ölçülerek elendi (karo boyutu vekil olarak
kullanıldı; NatGeo sade zeminin ~12 katı detay taşıdığı için elendi).

**5. Bir şeyi göstermek ile kullanıcıdan istemek aynı şey değildir.**
Küre IATA sefer numarası göstermez (aşağıdaki "Söylenmeyenler"). Takip sayfası
ise numarayı **kabul eder**, çünkü yolcunun elindeki biniş kartında o yazıyor
ve kabul etmemek sayfayı hedef kitlesi için kullanılamaz kılardı. Çelişki değil:
gösterilen kimlik yine çağrı işaretidir, girilen numara yanında bir *not* olarak
durur ve eşlemenin yapıldığı, nerede tuttuğu, nerede tutmadığı açıkça yazılır.
İlke, "çıkarımı gerçek gibi sunma"dır; "çıkarım yapma" değil.

**6. Ziyaretçinin tercihi kazanır, ama her tercih kalıcı değildir.**
Zemin bir beğenidir, saklanır. Liste kipi eline alıp bıraktığın bir
mercektir, saklanmaz. Uydu zemini bir yer uçağı seçildiğinde *ödünç alınır*
ve geri verilir; elle zemin seçmek ödüncü bitirir.

---

## Görsel dil

Apple'ın ürün sayfalarındaki sade, cam yüzeyli estetik.

| | |
| --- | --- |
| Vurgu | `#ff6a13` (Pegasus turuncusu) — havadaki uçak, seçim, sayaç |
| Yerdeki uçak | `#6b7684` gri + beyaz kontur |
| Havalimanı işareti | Beyaz nokta, `#3b4a5a` kontur ve etiket |
| Yüzeyler | `backdrop-filter: blur(24px) saturate(180%)`, 22px köşe |
| Yazı | SF Pro yığını; kod/sayı alanları `--font-mono` |
| Tema | Sistem tercihine göre açık/koyu |

Küre üstünde duran yazılar (altbilgi, Cesium atfı) renk şemasını değil
**zemini** takip eder: `body[data-basemap='uydu']` altında açık tema grileri
koyu uydu görüntüsünde kaybolduğu için ayrıca ayarlanır.

---

## Harita

**Zemin (varsayılan: Rölyef).** Küreye üstünde durduğu bir zemin veriyor, tam
coğrafi bir haritanın etiket kalabalığını getirmeden — irtifadaki bir uçağın
"bir yerin üstünde" okunmasını sağlayan şey bu. Alternatifler: Sade (Light
Gray Canvas), Uydu (World Imagery). Seçici alt ortada; tercih saklanır.

> Varsayılan başlangıçta Sade'ydi. Rölyefe geçildi çünkü boş gri bir küre
> üzerinde irtifa hissi oluşmuyordu.

**Derinlik.** Küre derinlik testi yapar (`depthTestAgainstTerrain`), yani
gezegenin öbür yüzündeki uçaklar küreden geçip görünmez. Simgeler uzaklıkla
ölçeklenir. Kamera eğik yaklaşır: tepeden bakan bir kamera irtifa bacağını
tek noktaya indirger ve yükseklik sıfır okunur.

**Kamera alt sınırı 350 m.** Önce 200 km'ydi (11 km irtifa karenin %4'ü
kalıyordu, yükseklik hiç okunamıyordu), sonra 20 km, sonra yerdeki uçaklar
için 1.2 km, sonunda 350 m — bir uçağın hangi park pozisyonunda olduğunu
görmek taksi yollarının arasına inmeyi gerektiriyor.

---

## Uçaklar

**Havada:** turuncu uçak simgesi, yöne göre döner. Altında yere inen kesikli
bir **irtifa bacağı** ve yerde bir **ayak noktası** — "bu şey havada"
hissini veren asıl şey bunlar, konumun kendisi yüksekliği anlatamaz.

**Ölü hesap.** Besleme 30 saniyede bir yenilenir; her sabitte simgeyi
zıplatmak yerine uçaklar kendi rotası ve dikey hızıyla kare kare ilerletilir.
Sabit yenilenmeyi keserse 120 saniye sonra durur — çoktan bıraktığı bir
rotada süzülmeye devam etmesin diye.

**İz.** Beslemenin gerçekten bildirdiği sabitlerden kurulur; yalnızca izin
başı tahmindir. Seçili olmayan uçaklarda bilinçli olarak soluk: otuz uçak
havadayken hepsi parlak olsa harita spagettiye döner.

**Rota çizgisi.** Seçili uçağın önünde kesikli bir çizgi. Kalkış/varış
doğrulanabildiyse **varış havalimanına** yönelir (büyük daire) ve irtifası
varışta sıfıra iner, böylece havalimanı işaretinin üstünde asılı kalmaz.
Doğrulanamadığında mevcut yönün ileri projeksiyonuna düşer — o hâliyle bir
uçuş planı değil, "bu rota sürerse nereye varır" demektir.

**Varış işareti.** Çizginin ucunda, IATA koduyla. Yalnızca varış işaretlenir:
kalkış uçağın arkasında kalır ve "bu nereye gidiyor" sorusuna bir şey katmaz.
Yakın zumda kadraj dışındadır; uzaklaşınca ya da çizgi boyunca kaydırınca
bulunur.

**Yerde:** aynı boyutta ama gri simge, izsiz ve rota çizgisiz, yere
sabitlenmiş.

> Yerdekiler başta daha küçüktü — aynı haritayı uçuşlarla paylaşırken onların
> önüne geçmemeleri gerekiyordu. Aynı anda tek grup gösterilmeye başlayınca
> geri çekilecek bir şey kalmadı ve boyut farkı yalnızca "bunlar daha
> önemsiz" gibi okunuyordu. Renk farkı kaldı; o hangi listede olunduğunu
> söylüyor.

---

## Panel: iki liste, tek mercek

Başlıkta **Havadakiler / Yerdekiler** anahtarı. Aynı anda tek liste görünür,
harita da onu izler.

Gerekçe: ikisi iki ayrı soruya cevap veriyor ve karışınca ikisi de
kayboluyor — günün bir kısmında filonun önemli bölümü apronda durur, o
kalabalık uçuşları ekrandan iter; tersi durumda yirmi uçuşun arasında taksi
yapan tek uçak kaybolur.

Anahtar harita kontrollerinde değil listede: aynı anda listeyi de seçtiği
için zemin seçicisinin yanında bir *zemin seçeneği* gibi görünüyordu.

Kip saklanmaz, her ziyaret havadakilerle başlar. Bir kez apronu incelemiş
olmak, ertesi gün sitenin uçuşlar olmadan açılması anlamına gelmemeli.

### Satır düzeni

```
PGT770                    FL385
TC-AIS · SAW → ALP        493 kt
```

İkinci satır tek satırdır ve yüksekliği hiç değişmez:

- **Havada:** tescil + doğrulanmışsa kalkış/varış kodları. Ad değil kod,
  çünkü "Istanbul Sabiha Gökçen → Aleppo" telefon genişliğine sığmıyor ve
  noktalanarak kesilmiş adlardan oluşan bir sütun tam da kaçınılmak istenen
  görüntü. Doğrulanamamışsa satır yalnızca tescille kalır — boşluk açılmaz.
- **Yerde:** tescil + hangi havalimanında olduğu.

Kart, listenin kısalttığını açar: havalimanı adları tam, ICAO ve IATA
kodlarıyla.

---

## Mobil

680px altında liste, durum rozetine dokununca açılan bir **alt panele**
dönüşür; arkası karartılır. Masaüstünde liste zaten ekranda olduğu için rozet
düz bir gösterge olarak kalır ve karartma devreye girmez.

Bir uçuş seçilince panel kapanır: seçmenin amacı ona bakmak, paneli kürenin
üstünde bırakmak değil.

Panel açıkken küre üzerindeki yazılar (altbilgi, atıf, zemin seçici) soluklaşır
— cam panelin arkasından okunuyorlardı.

> Ekranın ortasındaki "PgsRadar" turuncu başlık kaldırıldı: bir işe yaramıyor
> ve dikkati dağıtıyordu.


---

## Uçuş takibi (`/takip`)

Küre "Pegasus şu anda ne uçuruyor" sorusuna cevap verir. Bu sayfa başka bir
soruya cevap verir: **"benim uçuşum nerede ve indi mi?"** Soru farklı olduğu
için sayfa da farklı — kürenin filtrelenmiş hâli değil.

**Neden küre değil.** Bu sayfa kapıda, tek elle, hücresel veriyle açılıyor.
Cesium birkaç megabayt ve burada tek bir uçağın irtifasını göstermek için
gezegen çizmesi gerekiyor. Sayfa 24 KB; küreye ihtiyaç duyan varsa "Haritada
gör" düğmesi onu uçağın üstüne götürüyor. Kararın bedeli `vite.config.js`
içinde duruyor: Cesium eklentisi kendi etiketlerini *her* HTML girişine
enjekte ettiği için takip sayfasından tek tek sökülüyorlar.

**URL uçuşun kimliğidir.** Paylaşılan bağlantı her zaman o uçuşu açar, alıcının
en son neyi izlediğini değil. `localStorage` yalnızca *ilerlemeyi* taşır — en
önemlisi uçağın bu oturumda havada görülmüş olması, ki sayfaya iniş deme
yetkisini veren şey odur.

**Bir bitişi var.** Uçuş takip uygulamalarının çoğu iniş sonrası sonsuza kadar
bir şey göstermeye devam eder. Burada iniş son duraktır: anket durur, kart
"indi" der, düğme "yeni uçuş takip et"e döner. İstenen buydu ve doğrusu da bu —
inmiş bir uçağın anlık hızını yenilemeye devam etmek, bilgi değil gürültü.

### İniş neyle ilan edilir

Yalnızca beslemenin kendi yer bayrağıyla, ve yalnızca **önce havada görülmüşse**.
Bu latch'in eşiği (300 m, 40 m/s) bilerek yüksek: park hâlindeki bazı uçaklar
barometrik irtifa yollamayı sürdürüyor ve "8 metrede uçuyor" okunuyor; latch
olmadan bir sonraki anket iniş ilan ederdi. Aynı sebeple `indi` evresinden
geri dönüş yok — uçak indiği apronda durmaya devam ettiği için her ankette
kendi iniş saatini ileri taşırdı.

**Sinyalin kesilmesi iniş değildir.** ADS-B gönüllü alıcılara dayanıyor ve uçak
yerde transponder'ını kapatıyor: kapsama boşluğu ile iniş kulağa aynı geliyor.
Burada 1. ilke uygulanır — "büyük ihtimalle indi" demek yerine ölçülen yazılır:
son verinin saati, irtifası, konumu ve rota doğrulanmışsa varış havalimanına o
anki uzaklık. 4 km'de 300 ft'teki bir sessizlikle seyir irtifasında 400 km'deki
bir sessizlik aynı şey değil; okuyucunun kalan şüpheyi kendisi ölçebilmesi için
sayı verilir, ama iniş denmez.

### Bildirim: ne verildiği ve ne verilmediği

Kalkış, iniş ve sinyal kaybı birer tarayıcı bildirimi doğurur. Kalkış bildirimi
yalnızca uçağı yerde görmüş bir oturuma gider: sayfayı uçak seyir irtifasındayken
açan birine "havalandı" demek, uçuş hakkında değil sayfa hakkında haber vermek
olurdu.

Bu bir **sunucu push'u değil** ve arayüz bunu söylüyor ("Bu sayfa açık kaldığı
sürece…"). Gerçek web push üç şey ister: VAPID anahtar çifti, abonelikleri
tutacak bir depo ve inişi fark edecek dakikalık bir cron. Üçü de projenin
kurallarına dokunuyor (anahtarsız kal, durum tutma, ücretsiz kal), dolayısıyla
sorulmadan eklenmedi. Karşılığında verilen şey küçük değil: sekme arkada ve
telefon kilitliyken de iniş bildirimi düşüyor.

iOS'ta bildirim yalnızca ana ekrana eklenmiş bir PWA'da çalıştığı için manifest
ve simgeler var; simge küredeki uçak poligonunun aynısı, iki sayfa tek ürün gibi
görünsün diye.

### Varış tahmini

Rota doğrulanmışsa kalan mesafe ve tahmini varış saati gösterilir; formül kalan
büyük daire ÷ o anki yer hızı. Bu 2. ilkenin sınırında duruyor: iki uç da ölçülü
(konum ve hız), ama araya rüzgâr, tarife ve iniş profili girmiyor. Bu yüzden
sayının yanında **nasıl hesaplandığı** yazıyor — "mevcut hıza göre". Etiketsiz
bir varış saati tarife gibi okunurdu, ki değil.

### Giriş kutusu ve öneriler

Kutu `PC612`, `612` ve `PGT480Q` kabul eder. Altında o an havadaki çağrı
işaretleri listelenir: uçuşunu karşılamaya gelen birinin elinde numara
olmayabilir, ve boş bir kutuya bakmak kötü bir başlangıç. Liste, takibin zaten
çektiği filo yanıtından gelir — ek istek yok. Rota bilgisi bilinçli olarak
sorulmuyor: satır başına bir istek, hafif olması gereken bir sayfada yanlış
takas olurdu.

---

## Söylenmeyenler

Bilinçli olarak gösterilmeyen şeyler ve nedenleri:

- **IATA sefer numarası (PC612).** Veri kaynağı Pegasus'un yıllar önce
  bıraktığı **H9** kodunu veriyor, harfli çağrı işaretlerinde ise düz karakter
  değiştirme yapıyor (`PGT6AK` → `H96AK`; öyle bir sefer yok). Sayısal
  olanlarda dönüşüm kendimiz yapılabilirdi ama bu bir çıkarım olurdu.
  > Bu karar durmaya devam ediyor: küre hâlâ IATA numarası göstermiyor.
  > Takip sayfası numarayı **girdi olarak** alıyor ve çağrı işaretine çevirdiğini
  > söylüyor (yukarıdaki 5. ilke). Gösterme ile isteme arasındaki fark burada.
- **Gecikme.** `adsbdb`'de yok. Tarife verisi ücretli API gerektiriyor.
- **Çelişkili rotanın adayları.** Yukarıdaki 1. ilke.
- **Park hâlindeki tüm uçaklar.** Transponder'ı kapalı uçak ADS-B'de yok;
  "Yerdekiler" apronun tamamını değil, yerde hareket edeni gösterir. Boş liste
  mesajı bunu söyler.
