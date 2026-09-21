# CLAUDE.md — bu depoda nasıl çalışılır

Bu dosya, PgsRadar üzerinde çalışan bir Claude oturumunun ilk okuması gereken
şeydir. Ürünün **neden** böyle göründüğü ve davrandığı `DESIGN.md`'de, veri
yolunun teknik ayrıntıları `README.md`'dedir.

> **Bu üç dosya kod kadar bakımlıdır.** Bir davranışı, gerekçeyi veya kuralı
> değiştiren her değişiklikte ilgili dosya aynı commit içinde güncellenir.
> Kural aşağıda ayrıca yazılıdır ("Belgeleri güncel tutmak").

---

## Ürün tek cümlede

Pegasus filosunun (çağrı işareti `PGT`) canlı ADS-B konumlarını 3B bir küre
üzerinde gösteren, anahtarsız ve ücretsiz kaynaklarla çalışan bağımsız bir web
uygulaması. Yayın: <https://pgsradar.vercel.app>

İki sayfa: küre (`/`, `src/main.js`) ve tek uçuş takibi
(`/takip`, `src/track.js` — sefer numarası girilir, iniş bildirimiyle biter).
İkisi de aynı `/api/states` yanıtını tüketir.

## Yığın

| Katman | Ne |
| --- | --- |
| İstemci | Vite 5 (çok sayfalı) + CesiumJS (`vite-plugin-cesium`), çerçevesiz, düz JS |
| Sunucu | Vercel serverless fonksiyonları, `api/*.js`, ESM (`"type": "module"`) |
| Paylaşılan | `lib/` — `api/` dışında, çünkü `api/` altındaki her dosya bir uç nokta olur |
| İki sayfa ortak | `src/tokens.css` (palet), `src/ports.js` (havalimanı etiketleri), `src/callsign.js`, `src/flights.js` |
| Bölge | `fra1` (veri kaynaklarına yakın) |

Cesium ion hesabı **yok**: `baseLayer: false` + `EllipsoidTerrainProvider`.
Harita karoları Esri'nin anahtarsız servislerinden gelir.

---

## Değişmez kurallar

1. **Ücretsiz ve anahtarsız kal.** Ücretli bir API veya ion token'ı gerektiren
   bir çözüm önerilebilir, ama sorulmadan eklenmez. Bir anahtar gerekiyorsa
   Vercel ortam değişkeni olur; sohbete yapıştırılmaz.
2. **Yanlış veri, veri yokluğundan kötüdür.** Doğru görünen yanlış bir etiketi
   kimse iki kez kontrol etmez. İki kaynak çeliştiğinde birini seçme; "bilmiyoruz"
   de. (Bkz. `api/route.js`.)
3. **Hafızadan iddia etme, ölç.** Bir üst kaynağın davranışı, bir karo
   servisinin filigranı, bir alanın gerçekten dolu gelip gelmediği — hepsi
   ölçülür. Yöntem aşağıda.
4. **Geliştirme dalı oturum başında verilir.** Şu an:
   `claude/pegasus-flight-tracking-x6p4yl`. (Önceki dal:
   `claude/vercel-site-setup-cra8xt`.) İzin alınmadan başka dala push edilmez.
   Açıkça istenmedikçe PR açılmaz.
5. **Commit mesajları Türkçe**, kod yorumları İngilizce. Mesaj ne yapıldığını
   değil **neden** yapıldığını anlatır; değiştirilen bir kararın eski gerekçesi
   de yazılır.
6. Commit sonuna şu iki satır eklenir (ikincisi **o oturumun** adresidir):
   ```
   Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_<bu oturum>
   ```
   Model adı commit/PR/kod yorumu gibi depoya giren hiçbir yere yazılmaz
   (yukarıdaki trailer bunun tek istisnasıdır).
7. **Arayüz dili Türkçe.** Hata mesajları dahil.
8. TLS doğrulaması kapatılmaz, `HTTPS_PROXY` kaldırılmaz. Kurum politikası
   reddi (403/407) tekrar denenmez, bildirilir.
9. **`/api/states`e uçuşa özel parametre eklenmez.** Edge cache anahtarı sorgu
   dizesidir: `?callsign=PGT612` demek, o uçuş için ayrı bir cache girdisi ve
   ayrı bir 12 daire taraması demektir. Tek uçuş isteyen istemci tüm filoyu
   alıp kendi süzer (`src/track.js`). Bunu bozmak, tek bir bağlantıyı yüz
   kişinin paylaştığı anda üst kaynağı yüz kat daha fazla yorar.

---

## Doğrulama: sandbox dışarıya çıkamaz

Bu oturumun ağı bir izin listesinin arkasında. **Ulaşılamayanlar:** adsb.lol,
adsb.fi, adsbdb, hexdb, services.arcgisonline.com, `*.vercel.app`.
**Ulaşılabilenler:** `raw.githubusercontent.com`, `api.github.com`.

Bunun iki sonucu var:

### 1. Canlı doğrulama dağıtım üzerinden yapılır

Yayındaki uç noktalar `mcp__Vercel__web_fetch_vercel_url` ile okunur. Deploy
durumu `mcp__Vercel__list_deployments` / `get_deployment` ile izlenir; READY
görülmeden "yayında" denmez.

Bir şeyi kanıtlamak için geçici uç nokta açmak bu depoda kabul görmüş yöntem:

1. `api/<ad>.js` yaz, ölçmek istediğin tek şeyi döndür,
2. commit → push → READY → `web_fetch_vercel_url` ile oku,
3. **dosyayı sil, commit et, 404 döndüğünü teyit et.**

Üçüncü adım atlanmaz. Bugüne kadar açılıp kapatılanlar: `/api/diag`,
`/api/tile`, `/api/routeprobe`, `/api/csprobe`, `/api/asprobe`, `/api/aprobe`.

### 2. Arayüz yerel bir sahte sunucuyla, ekran görüntüsüyle doğrulanır

Karolar yüklenmez (zemin gri/koyu kalır) ama yerleşim, liste, kart, anahtarlar
ve giriş olayları doğrulanabilir.

```bash
# Chromium hazır kurulu; "playwright install" ÇALIŞTIRMA.
# Playwright global: NODE_PATH yerine tam yol ile import et:
#   import pw from '/opt/node22/lib/node_modules/playwright/index.js';
# Chromium: /opt/pw-browsers/chromium-1194/chrome-linux/chrome
# Bayraklar: --use-gl=swiftshader --enable-unsafe-swiftshader --no-sandbox
```

Sahte sunucu `dist/`i servis eder ve `/api/states` ile `/api/route`u taklit
eder (çalışma dizini dışında, scratchpad'de tutulur). Ekran görüntüsü almadan
"yaptım" denmez.

**Zamana bağlı davranışlar sahne dosyası değiştirilerek doğrulanır.** Sahte
sunucu her istekte `scenario.json`'u yeniden okur, sürücü betiği de iki anket
arasında dosyayı değiştirir: uçak havadayken yazılan bir "yerde" kaydı inişi
tetikler. Beklemeyi kısaltmak için doğrulama derlemesi
`VITE_POLL_INTERVAL_MS=3000 npm run build` ile yapılır — **sonra varsayılanla
yeniden derlenir.** Aylarca sürecek durumlar (6 dakikalık sinyal boşluğu gibi)
sahnelenemiyorsa `localStorage` doğrudan tohumlanır
(`context.addInitScript`).

Bildirimlerin gerçekten atıldığı da ölçüldü: `context.grantPermissions`,
ardından `Notification` ile `ServiceWorkerRegistration.prototype.showNotification`
bir init script'te kaydediciyle değiştirilir. Ölçülen: yerde → havada (kalkış
bildirimi) → yerde (iniş bildirimi) → yenileme (yeni bildirim yok, kart
"indi"de kalıyor).

> **Tuzak:** `pkill -f "verify/server.mjs"` komutu **kendi kabuğunu da**
> öldürür, çünkü kabuk komut satırında o metin geçer. Aynı komutta pkill ile
> başka iş yapma; port için `fuser -k 4173/tcp` kullan.

---

## Bilinen tuzaklar

- **Vercel boş ortam değişkenlerini string olarak enjekte eder.** `Number("")`
  sıfırdır ve `??` boş string'i yakalamaz. Bir zamanlar tüm bbox'ı `{0,0,0,0}`
  yapan buydu. Sayısal env okunurken `envNumber()` benzeri bir süzgeç şart.
- **Yerel ve yayındaki JS hash'leri farklıdır**, çünkü `VITE_*` değişkenleri
  derleme anında gömülür ve Vercel'de tanımlıdırlar. CSS hash'i eşleşir. Hash
  farkı tek başına "deploy olmamış" demek değildir.
- **`api/` altındaki her dosya bir uç noktadır.** Paylaşılan modül `lib/`e
  konur.
- **Cesium 1.145'te `imageryProvider: false` diye bir seçenek yok**; sessizce
  ion'a düşer. Doğrusu `baseLayer: false`.
- **Esri karo sırası `{z}/{y}/{x}`** — önce satır, sonra sütun.
- **`alt_baro` yerdeki uçakta `"ground"` metnidir**, ve bazı uçaklar park
  halindeyken de `alt_geom` yollar. Yer bayrağı irtifadan **önce** okunur.
- Cesium'un kendi stil dosyası özgüllükte kazanabilir; atıf şeridi gibi
  şeyleri ezmek için `.cesium-viewer` öneki gerekebilir.
- **`vite-plugin-cesium` etiketlerini *her* HTML girişine enjekte eder**:
  `widgets.css` her zaman, üretim derlemesinde ayrıca bloklayıcı bir
  `<script src="/cesium/Cesium.js">`. Sayfa başına seçeneği yok. `takip.html`
  bunları `vite.config.js` içindeki `cesiumOnlyOnGlobe` eklentisiyle söküyor;
  yeni bir sayfa eklenirse aynı şey gerekir, yoksa sayfa birkaç MB'lik bir 3B
  motoru boşuna indirir. Kontrol: `head -8 dist/<sayfa>.html`.
- **Durum sınıfı ile yerleşim sınıfı aynı adı taşıyabilir.** `.status-dot.live`
  (nokta yeşil yanar) ile kapsayıcıya verilen `.live` çakıştı: kapsayıcının
  `margin-top: 18px`'i 7 piksellik noktaya da uygulandı ve nokta satırın
  altına kaydı. Kapsayıcı `.live-line` oldu. Nokta bir yerde satırından
  kayıyorsa önce sınıf adı çakışmasına bakılır.
- **Android'de `new Notification()` çalışmaz**; bildirim bir service
  worker'dan (`registration.showNotification`) çıkmak zorundadır. iOS'ta ise
  bildirim yalnızca ana ekrana eklenmiş PWA'da çalışır (manifest + ikon şart).
- **`navigator.serviceWorker.ready` hiç kayıt yoksa asla resolve etmez.**
  Kayıt sonucu bir değişkende tutulur (`swRegistration`), `ready` beklenmez.
- **Doğrulanmış rota, uçağın o anda uçtuğu bacak değildir.** `api/route.js`
  çağrı işaretinin rotasını verir; aynı numara dönüşte de kullanılabiliyor.
  Ölçüm (21 Eylül 2026, canlı veri): `PGT1883` iki kaynağa göre ESB → ECN,
  uçak ise 354° ile kuzeye — varışa kerteriz 174°, fark 180°. Bu çifte
  dayanarak ilerleme/varış hesaplayan her şey yön kontrolü yapmalı
  (`OFF_COURSE_DEGREES`, `src/track.js`).
- **Açı farkı formülünü test etmeden bırakma.** `Math.abs(((a-b+540)%360)-180)`
  zaten en küçük açıdır; başına `180 - …` eklemek işareti ters çevirir ve
  "uçak rotasında" ile "tam ters yönde" yer değiştirir. Bir kez oldu; üç
  satırlık bir node kontrolüyle (`0/350 → 10`, `90/270 → 180`) yakalandı.

---

## Çalışma düzeni

1. Değişikliği yap, `npm run build` ile derle.
2. Yerel sahte sunucu + ekran görüntüsüyle doğrula (arayüzse).
3. `README.md` / `DESIGN.md` / `CLAUDE.md`'den etkileneni aynı commit'te
   güncelle.
4. Commit → push → deploy READY → yayındaki davranışı oku.
5. Kullanıcıya **ölçülen** sonucu bildir. Bir şey atlandıysa veya
   doğrulanamadıysa bu da söylenir.

## Belgeleri güncel tutmak

Her değişiklikten sonra şu üçü gözden geçirilir ve gerekiyorsa **aynı commit
içinde** güncellenir:

| Dosya | Neyi tutar |
| --- | --- |
| `CLAUDE.md` | Nasıl çalışılır: kurallar, doğrulama yöntemi, tuzaklar |
| `DESIGN.md` | Neden böyle görünür/davranır: ürün ve arayüz kararları |
| `README.md` | Ne çalışıyor: veri yolu, uç noktalar, kurulum, sınırlar |

Tetikleyiciler:

- **Görünen bir davranış değişti** → `DESIGN.md` (ve varsa `README.md`).
- **Yeni bir uç nokta, kaynak veya ortam değişkeni** → `README.md`.
- **Yeni bir tuzak, kural ya da doğrulama yöntemi öğrenildi** → `CLAUDE.md`.
- **Bir karar geri alındı** → eski gerekçe silinmez, *neden değiştiği* yazılır.
  Bu depodaki belgelerin değeri kararların kendisinde değil, gerekçelerinde.
