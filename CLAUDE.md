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

## Yığın

| Katman | Ne |
| --- | --- |
| İstemci | Vite 5 + CesiumJS (`vite-plugin-cesium`), çerçevesiz, düz JS |
| Sunucu | Vercel serverless fonksiyonları, `api/*.js`, ESM (`"type": "module"`) |
| Paylaşılan | `lib/` — `api/` dışında, çünkü `api/` altındaki her dosya bir uç nokta olur |
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
4. **Geliştirme dalı:** `claude/vercel-site-setup-cra8xt`. İzin alınmadan başka
   dala push edilmez. Açıkça istenmedikçe PR açılmaz.
5. **Commit mesajları Türkçe**, kod yorumları İngilizce. Mesaj ne yapıldığını
   değil **neden** yapıldığını anlatır; değiştirilen bir kararın eski gerekçesi
   de yazılır.
6. Commit sonuna şu iki satır eklenir:
   ```
   Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01QgPMhCtrCXSw4wEN5d3sHX
   ```
   Model adı commit/PR/kod yorumu gibi depoya giren hiçbir yere yazılmaz
   (yukarıdaki trailer bunun tek istisnasıdır).
7. **Arayüz dili Türkçe.** Hata mesajları dahil.
8. TLS doğrulaması kapatılmaz, `HTTPS_PROXY` kaldırılmaz. Kurum politikası
   reddi (403/407) tekrar denenmez, bildirilir.

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
