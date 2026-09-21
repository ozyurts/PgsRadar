// PGS Radar — one flight, from the stand to the gate at the other end.
//
// The globe answers "what is Pegasus flying right now". This page answers a
// different question — "where is *my* flight, and has it landed yet" — for
// someone who was handed a boarding pass and a link. So it is deliberately
// not the globe with a filter on it: no Cesium, no fleet list, no basemap
// picker. It is a card, a poll loop and an ending.
//
// It shares the fleet endpoint rather than getting one of its own. /api/states
// is cached at the edge per query string, so every visitor of every page inside
// one cache window is served from the CDN and the ADS-B aggregators see a
// single sweep. A per-flight endpoint would have turned each tracked flight
// into its own cache key and its own twelve upstream queries — the opposite of
// what sharing the link is for. Filtering to one callsign is done here.

import './track.css';
import { fetchFleet, fetchRoute } from './flights.js';
import { parseFlightNumber, iataNumber } from './callsign.js';
import { portCode, portLabel, portTitle, airportLabel } from './ports.js';

const CALLSIGN_PREFIX = import.meta.env.VITE_CALLSIGN_PREFIX?.trim() || 'PGT';
const POLL_INTERVAL_MS = Number(import.meta.env.VITE_POLL_INTERVAL_MS) || 30000;

const PARAM = 'ucus';
const STORAGE_KEY = 'pgsradar.takip.v1';

// What counts as "this aircraft is really flying". The ground flag alone is
// not enough to latch on: a parked airframe that keeps sending a barometric
// altitude reads as airborne at a few dozen metres, and latching on that would
// let the very next poll — the one where alt_baro says "ground" again —
// announce a landing that never happened.
const AIRBORNE_MIN_ALT_M = 300;
const AIRBORNE_MIN_SPEED_MS = 40;

// ADS-B coverage rests on volunteer receivers, and aircraft switch their
// transponder off on stand. A gap is therefore normal and says nothing on its
// own; only a long one is worth reporting, and even then it is reported as a
// gap, never as an arrival.
const LOST_AFTER_MS = 6 * 60 * 1000;
const GIVE_UP_AFTER_MS = 45 * 60 * 1000;

// A tracking session outlives a reload — the phone locks, the tab is
// backgrounded, the page comes back. It does not outlive the flight.
const RESUME_MAX_AGE_MS = 16 * 60 * 60 * 1000;
const LANDED_KEEP_MS = 3 * 60 * 60 * 1000;

const M_TO_FT = 3.28084;
const MS_TO_KT = 1.94384;
const MS_TO_FPM = 196.85;
const EARTH_RADIUS_M = 6371000;

// ---------- Geometry ----------
// Great-circle distance, for the progress bar and the estimate. Cesium has
// this, but importing Cesium to subtract two coordinates would cost this page
// several megabytes it otherwise never loads.
function distanceM(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing from `a` to `b`, in degrees. */
function bearingTo(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const rad = Math.PI / 180;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const dLon = (b.lon - a.lon) * rad;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/** Smallest angle between two headings, 0-180. */
function angleBetween(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

// How far off the bearing to the destination the aircraft may be pointed
// before the progress bar stops being a claim anyone should believe. Generous
// on purpose: a departure turning onto its SID, a hold or a vector is not a
// contradiction, a reciprocal course is.
const OFF_COURSE_DEGREES = 100;

// ---------- Elements ----------
const el = (id) => document.getElementById(id);
const els = {
  entry: el('entry'),
  form: el('lookupForm'),
  input: el('flightInput'),
  error: el('lookupError'),
  suggest: el('suggest'),
  suggestTitle: el('suggestTitle'),
  suggestList: el('suggestList'),

  tracker: el('tracker'),
  callsign: el('tCallsign'),
  sub: el('tSub'),
  badge: el('tBadge'),
  note: el('tNote'),
  banner: el('tBanner'),
  route: el('tRoute'),
  routeKnown: el('tRouteKnown'),
  routeUnknown: el('tRouteUnknown'),
  fromCode: el('tFromCode'),
  fromName: el('tFromName'),
  toCode: el('tToCode'),
  toName: el('tToName'),
  bar: el('tBar'),
  barFill: el('tBarFill'),
  routeMeta: el('tRouteMeta'),
  alt: el('tAlt'),
  speed: el('tSpeed'),
  vs: el('tVs'),
  pos: el('tPos'),
  grid: el('tGrid'),
  dot: el('tDot'),
  updated: el('tUpdated'),
  notifyBtn: el('notifyBtn'),
  notifyState: el('notifyState'),
  shareBtn: el('shareBtn'),
  mapLink: el('mapLink'),
  stopBtn: el('stopBtn'),
  retryBtn: el('retryBtn'),
};

// ---------- Tracking state ----------
/**
 * phase:
 *   'bekleniyor' — asked for, not in the feed (yet)
 *   'yerde'      — on the surface, and not seen airborne since tracking began
 *   'havada'     — airborne
 *   'indi'       — was airborne, now on the surface. Terminal.
 *   'kayip'      — was airborne, then nothing for a long while. Terminal-ish.
 */
let track = null;
let timer = null;
let routeResult = null;

function save() {
  if (!track) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(track));
  } catch {
    // Private browsing refuses writes. Tracking still works for as long as
    // the page stays open; only resuming after a reload is lost.
  }
}

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

function forget() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

// ---------- Notifications ----------
// A browser notification, not a server push. Real push would need VAPID keys,
// somewhere to keep the subscriptions and a job that runs every minute to
// notice the landing — a key, a database and a paid cron, all three of which
// this project does without on purpose. What is free and honest is this: while
// the page is open, the tab may be buried and the phone locked, and the
// landing still arrives as a system notification.
//
// Android requires it to come from a service worker — `new Notification()`
// throws there — so one is registered and used when it is ready, with the
// constructor kept as the desktop fallback.
let swRegistration = null;

if ('serviceWorker' in navigator && 'Notification' in window) {
  navigator.serviceWorker
    .register('/sw.js')
    .then((reg) => {
      swRegistration = reg;
    })
    .catch(() => {
      // Served without a service worker (or blocked): desktop notifications
      // still work through the constructor.
    });
}

function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

async function notify(title, body) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;

  const options = {
    body,
    lang: 'tr',
    tag: 'pgsradar-' + (track?.callsign || 'ucus'),
    icon: '/icon-180.png',
    badge: '/icon-180.png',
    requireInteraction: true,
    data: { url: location.href },
  };

  try {
    if (swRegistration) {
      await swRegistration.showNotification(title, options);
      return;
    }
  } catch {
    // Fall through to the constructor.
  }
  try {
    new Notification(title, options);
  } catch {
    // Android without a service worker. The card on screen already says it.
  }
}

/** Each milestone is announced once per tracking session, reload or not. */
function notifyOnce(key, title, body) {
  if (!track) return;
  track.notified = track.notified || {};
  if (track.notified[key]) return;
  track.notified[key] = true;
  save();
  notify(title, body);
}

function renderNotifyState() {
  const supported = notificationsSupported();
  const permission = supported ? Notification.permission : 'unsupported';
  // A landed flight has nothing left to announce.
  const over = track?.phase === 'indi';

  els.notifyBtn.hidden = over || !supported || permission !== 'default';
  els.notifyState.hidden = over || permission === 'default';

  if (permission === 'granted') {
    els.notifyState.className = 'notify-state on';
    els.notifyState.textContent =
      'Bildirimler açık. Bu sayfa açık kaldığı sürece kalkış ve iniş bildirimi gelir.';
  } else if (permission === 'denied') {
    els.notifyState.className = 'notify-state';
    els.notifyState.textContent =
      'Bildirim izni reddedilmiş. Tarayıcı ayarlarından bu site için açabilirsiniz.';
  } else if (!supported) {
    els.notifyState.className = 'notify-state';
    els.notifyState.textContent =
      'Bu tarayıcı bildirim desteklemiyor. Durum yine de bu kartta görünür.';
  }
}

els.notifyBtn.addEventListener('click', async () => {
  if (!notificationsSupported()) return renderNotifyState();
  try {
    await Notification.requestPermission();
  } catch {}
  renderNotifyState();
});

// ---------- Formatting ----------
function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtKm(m) {
  return Math.round(m / 1000).toLocaleString('tr-TR') + ' km';
}

function fmtDuration(minutes) {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} sa ${m} dk` : `${m} dk`;
}

/** "Sabiha Gökçen (SAW)" — the same phrasing the globe's card uses. */
function airportSentence(port) {
  return port ? airportLabel(port) : null;
}

// ---------- Rendering ----------
const BADGES = {
  bekleniyor: ['Bekleniyor', ''],
  yerde: ['Yerde', ''],
  havada: ['Havada', 'live'],
  indi: ['İndi', 'done'],
  kayip: ['Sinyal yok', 'warn'],
};

function render() {
  if (!track) return;

  const f = track.last;
  const [badgeText, badgeClass] = BADGES[track.phase] || BADGES.bekleniyor;
  els.badge.textContent = badgeText;
  els.badge.className = 'badge ' + badgeClass;

  els.callsign.textContent = track.callsign;

  // The identity on screen is the callsign the feed carries. The flight
  // number is kept beside it as what was typed, not as a second name for the
  // aircraft — see callsign.js for why that distinction is load-bearing.
  const iata = iataNumber(track.callsign);
  els.sub.textContent =
    [iata, f?.registration, f?.model || f?.type].filter(Boolean).join(' · ') || '—';

  if (track.assumedIata && iata) {
    els.note.hidden = false;
    els.note.textContent =
      `${track.typed} için ${track.callsign} çağrı işareti arandı. Sayısal seferlerde bu eşleşme tutar; ` +
      `harfli seferlerin (${CALLSIGN_PREFIX}480Q gibi) IATA karşılığı yoktur, onlar çağrı işaretiyle aranır.`;
  } else {
    els.note.hidden = true;
  }

  renderBanner();
  renderRoute();
  renderMetrics();
  renderNotifyState();

  // "Takibi bırak" is an interruption; once the flight is over the same button
  // is the way on to the next one.
  els.stopBtn.textContent =
    track.phase === 'indi' ? 'Yeni uçuş takip et' : 'Takibi bırak';

  els.mapLink.href = '/?' + PARAM + '=' + encodeURIComponent(track.callsign);
  // Offered only once the loop has given up, which is the only state the
  // visitor cannot get out of by waiting.
  els.retryBtn.hidden = !(track.phase === 'kayip' && !timer);
}

function renderBanner() {
  const b = els.banner;
  b.className = 'banner';

  if (track.phase === 'indi') {
    b.hidden = false;
    b.classList.add('done');

    const where = airportSentence(track.landedAirport);
    const lines = [];
    lines.push(
      where
        ? `Uçak ${where} havalimanına indi.`
        : 'Uçak indi — hangi havalimanına olduğu belirlenemedi.'
    );
    lines.push(`İniş ${fmtTime(track.landedAt)} itibarıyla tespit edildi. Takip sonlandırıldı.`);

    // A landing somewhere other than the confirmed destination is the one
    // thing about this flight nobody would guess, so it is said outright
    // rather than left for the reader to spot in the codes.
    const dest = routeResult?.status === 'confirmed' ? routeResult.destination : null;
    if (dest && track.landedAirport && track.landedAirport.icao !== dest.icao) {
      lines.push(`Beklenen varış ${portLabel(dest)} (${portCode(dest)}) idi.`);
    }
    if (!track.landedAirport && track.lastFix) {
      lines.push(
        `Son konum: ${track.lastFix.lat.toFixed(3)}, ${track.lastFix.lon.toFixed(3)}. ` +
          'Havalimanı tablosunda bu noktaya 8 km’den yakın bir pist yok.'
      );
    }

    b.replaceChildren(...lines.map((text) => {
      const p = document.createElement('p');
      p.textContent = text;
      return p;
    }));
    return;
  }

  if (track.phase === 'kayip') {
    b.hidden = false;
    b.classList.add('warn');

    const lines = ['Sinyal kesildi. İniş teyit edilemedi.'];
    if (track.lastSeenAt) {
      const fix = track.lastFix;
      lines.push(
        `Son veri ${fmtTime(track.lastSeenAt)} — ` +
          (fix
            ? `${Math.round(fix.altitudeM * M_TO_FT).toLocaleString('tr-TR')} ft, ` +
              `${fix.lat.toFixed(2)}, ${fix.lon.toFixed(2)}.`
            : 'konum yok.')
      );
    }

    // Distance to the confirmed destination at the last fix is measured, not
    // guessed, and it is the one number that tells the reader how much doubt
    // is left: 4 km out at 300 ft is a different silence from 400 km out at
    // cruise. It still is not an arrival, and is not called one.
    const dest = routeResult?.status === 'confirmed' ? routeResult.destination : null;
    const gap = dest && track.lastFix ? distanceM(track.lastFix, dest) : null;
    if (gap != null) {
      lines.push(
        `O anda ${portLabel(dest)} (${portCode(dest)}) havalimanına ${fmtKm(gap)} uzaklıktaydı.`
      );
    }
    lines.push(
      'ADS-B gönüllü alıcılara dayanır ve uçaklar yerde transponder’ını kapatır; ' +
        'kapsama boşluğu da iniş de aynı şekilde sessizleşir.'
    );

    b.replaceChildren(...lines.map((text) => {
      const p = document.createElement('p');
      p.textContent = text;
      return p;
    }));
    return;
  }

  if (track.phase === 'bekleniyor') {
    b.hidden = false;
    b.replaceChildren(...[
      `${track.callsign} şu anda ADS-B verisinde görünmüyor.`,
      'Uçuş henüz kalkmamış, transponder’ı kapalı ya da kapsama alanının ' +
        'dışında olabilir. Takip açık — uçak göründüğü anda bu kart dolacak.',
    ].map((text) => {
      const p = document.createElement('p');
      p.textContent = text;
      return p;
    }));
    return;
  }

  if (track.phase === 'yerde') {
    b.hidden = false;
    const p = document.createElement('p');
    const where = airportSentence(track.last?.airport);
    p.textContent = where
      ? `Uçak ${where} havalimanında, yerde. Kalkış ve iniş bildirimleri açık.`
      : 'Uçak yerde. Hangi havalimanında olduğu belirlenemedi.';
    b.replaceChildren(p);
    return;
  }

  b.hidden = true;
}

function renderRoute() {
  const confirmed = routeResult?.status === 'confirmed' ? routeResult : null;

  if (!confirmed) {
    // Nothing is invented here: when the two route databases disagree the
    // globe hides the candidates, and so does this page.
    els.route.hidden = !routeResult;
    els.routeKnown.hidden = true;
    els.routeUnknown.hidden = !routeResult;
    if (routeResult) {
      els.routeUnknown.textContent =
        routeResult.status === 'conflict'
          ? 'Rota doğrulanamadı — iki kaynak çelişiyor, bu yüzden gösterilmiyor.'
          : 'Bu sefer için rota bilgisi yok.';
    }
    return;
  }

  els.route.hidden = false;
  els.routeUnknown.hidden = true;
  els.routeKnown.hidden = false;

  els.fromCode.textContent = portCode(confirmed.origin);
  els.fromName.textContent = portLabel(confirmed.origin);
  els.fromName.title = portTitle(confirmed.origin);
  els.toCode.textContent = portCode(confirmed.destination);
  els.toName.textContent = portLabel(confirmed.destination);
  els.toName.title = portTitle(confirmed.destination);

  if (track.phase === 'indi') {
    els.bar.hidden = false;
    els.barFill.style.width = '100%';
    els.routeMeta.hidden = false;
    els.routeMeta.textContent = 'Uçuş tamamlandı.';
    return;
  }

  const f = track.last;
  const total = distanceM(confirmed.origin, confirmed.destination);
  const remaining =
    f && track.phase === 'havada' ? distanceM(f, confirmed.destination) : null;

  // Measured on live data: a callsign's confirmed pair belongs to one leg, and
  // the return leg is often flown under the same one — PGT1883 was confirmed
  // ESB → ECN while tracking 354°, i.e. away from Cyprus. The globe's dashed
  // line already lives with that, but a progress bar and an arrival time are a
  // much stronger claim, and here they would both have been nonsense. So they
  // are withheld whenever the aircraft is not actually pointed at the airport.
  const offCourse =
    f && remaining != null
      ? angleBetween(f.heading, bearingTo(f, confirmed.destination)) >
        OFF_COURSE_DEGREES
      : false;

  if (offCourse) {
    els.bar.hidden = true;
    els.routeMeta.hidden = false;
    els.routeMeta.textContent =
      'Uçak şu anda bu varışa doğru ilerlemiyor, bu yüzden ilerleme ve varış ' +
      'tahmini gösterilmiyor. Aynı sefer numarası dönüş bacağında da ' +
      'kullanılıyor olabilir.';
    return;
  }

  if (total && remaining != null) {
    const done = Math.min(1, Math.max(0, 1 - remaining / total));
    els.bar.hidden = false;
    els.barFill.style.width = (done * 100).toFixed(1) + '%';

    // An estimate, and labelled as one: the remaining great circle divided by
    // the ground speed of this moment. No schedule, no wind, no descent
    // profile — those need a paid flight-plan API.
    const parts = [`Kalan ${fmtKm(remaining)}`];
    if (f.speedMs > 50) {
      const minutes = remaining / f.speedMs / 60;
      parts.push(
        `~${fmtDuration(minutes)} (mevcut hıza göre, ${fmtTime(Date.now() + minutes * 60000)})`
      );
    }
    els.routeMeta.hidden = false;
    els.routeMeta.textContent = parts.join(' · ');
  } else {
    els.bar.hidden = true;
    els.routeMeta.hidden = true;
  }
}

function renderMetrics() {
  const f = track.last;

  // Nothing has been measured yet: four dashes look like an answer, so the
  // grid stays out of the way until there is a fix to put in it.
  els.grid.hidden = !f;
  if (!f) return;

  els.alt.textContent = f.onGround
    ? 'Yerde'
    : Math.round(f.altitudeM * M_TO_FT).toLocaleString('tr-TR') + ' ft';
  els.speed.textContent = Math.round(f.speedMs * MS_TO_KT) + ' kt';

  const fpm = Math.round(f.verticalRateMs * MS_TO_FPM);
  els.vs.textContent = f.onGround
    ? '—'
    : (fpm > 100 ? '↑ ' : fpm < -100 ? '↓ ' : '') +
      Math.abs(fpm).toLocaleString('tr-TR') + ' ft/dk';
  els.pos.textContent = f.lat.toFixed(2) + ', ' + f.lon.toFixed(2);
}

function setLive(state, text) {
  els.dot.className = 'status-dot' + (state ? ' ' + state : '');
  els.updated.textContent = text;
}

// ---------- The loop ----------
function stopPolling() {
  if (timer) clearInterval(timer);
  timer = null;
}

function apply(flights) {
  // A finished flight stays finished. Without this the aircraft still sitting
  // on the stand where it landed would re-trigger the landing on every poll
  // and keep moving its own arrival time forward.
  if (track.phase === 'indi') return;

  const now = Date.now();
  const f = flights.find(
    (x) => x.callsign.trim().toUpperCase() === track.callsign
  );

  if (f) {
    const was = track.phase;
    track.last = f;
    track.lastSeenAt = now;
    if (!f.onGround) track.lastFix = { lat: f.lat, lon: f.lon, altitudeM: f.altitudeM };

    if (f.onGround) {
      if (track.sawAirborne) {
        land(f, now);
        return;
      }
      track.phase = 'yerde';
    } else {
      track.phase = 'havada';
      if (
        !track.sawAirborne &&
        f.altitudeM >= AIRBORNE_MIN_ALT_M &&
        f.speedMs >= AIRBORNE_MIN_SPEED_MS
      ) {
        track.sawAirborne = true;
        // Only announced to someone who was watching it sit on the stand.
        // Opening the page with the flight already at cruise and being told
        // it "has taken off" would be news about the page, not the flight.
        if (was === 'yerde') {
          notifyOnce(
            'kalkis',
            track.callsign + ' havalandı',
            (airportSentence(track.departure) || 'Havalimanı belirlenemedi') +
              ' — takip sürüyor.'
          );
        }
      }
    }
    if (f.onGround && f.airport) track.departure = f.airport;
  } else if (track.lastSeenAt) {
    const gap = now - track.lastSeenAt;
    if (track.sawAirborne && gap > LOST_AFTER_MS) {
      track.phase = 'kayip';
      notifyOnce(
        'kayip',
        track.callsign + ' sinyali kesildi',
        'Son veri ' + fmtTime(track.lastSeenAt) + '. İniş teyit edilemedi.'
      );
      if (gap > GIVE_UP_AFTER_MS) stopPolling();
    } else if (!track.sawAirborne && gap > LOST_AFTER_MS) {
      // Never seen flying: it was parked and switched its transponder off,
      // which is the normal state of a stand, not an event.
      track.phase = 'bekleniyor';
    }
  }

  save();
}

function land(f, now) {
  track.phase = 'indi';
  track.landedAt = now;
  track.landedAirport = f.airport || null;
  save();
  stopPolling();

  const where = airportSentence(track.landedAirport);
  notifyOnce(
    'inis',
    track.callsign + ' indi',
    where ? where + ' havalimanına indi.' : 'Uçak indi — havalimanı belirlenemedi.'
  );
}

async function poll() {
  try {
    const flights = await fetchFleet({ prefix: CALLSIGN_PREFIX });
    apply(flights);
    render();

    if (track.phase === 'indi') {
      setLive('done', 'Takip ' + fmtTime(track.landedAt) + ' itibarıyla kapandı.');
    } else if (track.phase === 'kayip') {
      setLive(
        'warn',
        timer
          ? 'Son veri: ' + fmtTime(track.lastSeenAt) + ' — aranmaya devam ediliyor.'
          : 'Son veri: ' + fmtTime(track.lastSeenAt) + ' — takip durduruldu.'
      );
    } else {
      setLive('live', 'Son güncelleme: ' + fmtTime(Date.now()));
    }
  } catch (err) {
    // The card keeps the last good values rather than blanking: stale numbers
    // with a visible timestamp beat an empty card that looks like an answer.
    setLive('error', 'Veri alınamadı: ' + (err?.message || String(err)));
  }
}

// ---------- Route ----------
function loadRoute() {
  routeResult = null;
  fetchRoute(track.callsign)
    .then((result) => {
      // A late answer for a flight that is no longer the tracked one must not
      // land in the card.
      if (!track || (result?.callsign && result.callsign !== track.callsign)) return;
      routeResult = result;
      render();
    })
    .catch(() => {});
}

// ---------- Starting and stopping ----------
function startTracking(parsed, { resumed = null } = {}) {
  track = resumed || {
    callsign: parsed.callsign,
    typed: parsed.typed,
    assumedIata: Boolean(parsed.assumedIata),
    startedAt: Date.now(),
    phase: 'bekleniyor',
    sawAirborne: false,
    last: null,
    lastFix: null,
    lastSeenAt: null,
    departure: null,
    landedAt: null,
    landedAirport: null,
    notified: {},
  };
  save();

  const url = new URL(location.href);
  url.searchParams.set(PARAM, track.callsign);
  history.replaceState(null, '', url);

  els.entry.hidden = true;
  els.tracker.hidden = false;
  renderNotifyState();
  render();
  setLive('', 'Bağlanıyor…');

  loadRoute();
  stopPolling();

  // A finished flight needs no loop; the card is the result.
  if (track.phase === 'indi') {
    setLive('done', 'Takip ' + fmtTime(track.landedAt) + ' itibarıyla kapandı.');
    render();
    return;
  }

  poll();
  timer = setInterval(poll, POLL_INTERVAL_MS);
}

function stopTracking() {
  stopPolling();
  track = null;
  routeResult = null;
  forget();

  const url = new URL(location.href);
  url.searchParams.delete(PARAM);
  history.replaceState(null, '', url);

  els.tracker.hidden = true;
  els.entry.hidden = false;
  els.input.value = '';
  loadSuggestions();
  els.input.focus();
}

els.stopBtn.addEventListener('click', stopTracking);

els.retryBtn.addEventListener('click', () => {
  if (!track || timer) return;
  poll();
  timer = setInterval(poll, POLL_INTERVAL_MS);
  render();
});

// ---------- Sharing ----------
els.shareBtn.addEventListener('click', async () => {
  const url = location.href;
  const title = track ? `${track.callsign} uçuş takibi` : 'PGS Radar uçuş takibi';

  if (navigator.share) {
    try {
      await navigator.share({ title, text: title, url });
      return;
    } catch {
      // Cancelled, or refused outside a user gesture; fall through to copy.
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    els.shareBtn.textContent = 'Bağlantı kopyalandı';
    setTimeout(() => {
      els.shareBtn.textContent = 'Bağlantıyı paylaş';
    }, 2500);
  } catch {
    els.shareBtn.textContent = url;
  }
});

// ---------- Entry form ----------
els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const parsed = parseFlightNumber(els.input.value);

  if (!parsed) {
    els.error.hidden = false;
    els.error.textContent =
      'Sefer numarası anlaşılamadı. PC612, 612 ya da PGT480Q gibi yazın.';
    return;
  }

  els.error.hidden = true;
  startTracking(parsed);
});

// ---------- Suggestions ----------
// Someone who mistyped, or who does not know the callsign of the flight they
// are meeting, should not be left staring at an empty box. These come from the
// same cached fleet response the tracker polls, so the list costs nothing
// extra. Routes are deliberately not looked up here: that would be one request
// per row on a page whose whole point is to be light.
async function loadSuggestions() {
  try {
    const flights = await fetchFleet({ prefix: CALLSIGN_PREFIX });
    const airborne = flights
      .filter((f) => !f.onGround)
      .sort((a, b) => a.callsign.localeCompare(b.callsign));

    if (!airborne.length) {
      els.suggest.hidden = true;
      return;
    }

    els.suggestTitle.textContent = `Şu anda havada (${airborne.length})`;
    els.suggestList.replaceChildren(
      ...airborne.map((f) => {
        // textContent throughout: the callsign comes from a third-party feed.
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'chip';

        const cs = document.createElement('strong');
        cs.textContent = f.callsign;
        const meta = document.createElement('span');
        meta.textContent =
          [iataNumber(f.callsign), 'FL' + Math.round((f.altitudeM * M_TO_FT) / 100)]
            .filter(Boolean)
            .join(' · ');

        button.append(cs, meta);
        button.addEventListener('click', () =>
          startTracking(parseFlightNumber(f.callsign))
        );
        return button;
      })
    );
    els.suggest.hidden = false;
  } catch {
    // The list is a convenience; its absence needs no explanation.
    els.suggest.hidden = true;
  }
}

// ---------- Boot ----------
// The URL decides which flight, so a shared link always opens on that flight
// and never on whatever the recipient happened to track last. Storage only
// carries the progress of the session — above all whether this flight has
// been seen airborne, which is what licences the page to call a landing.
(function boot() {
  const asked = parseFlightNumber(new URLSearchParams(location.search).get(PARAM));
  const stored = load();
  const fresh = stored && Date.now() - (stored.startedAt || 0) < RESUME_MAX_AGE_MS;

  if (asked) {
    // The page rewrites its own URL to the callsign, so a reload arrives
    // without the flight number that was typed. Keep the explanation the
    // first visit earned rather than dropping it on every refresh.
    const resumed =
      fresh && stored.callsign === asked.callsign
        ? {
            ...stored,
            assumedIata: asked.assumedIata || Boolean(stored.assumedIata),
            typed: asked.assumedIata ? asked.typed : stored.typed || asked.typed,
          }
        : null;
    startTracking(asked, { resumed });
    return;
  }

  // No link, but a session that is still running — or one that ended within
  // the last few hours, whose result is still what the visitor came back for.
  if (
    fresh &&
    stored.callsign &&
    (stored.phase !== 'indi' || Date.now() - stored.landedAt < LANDED_KEEP_MS)
  ) {
    startTracking(parseFlightNumber(stored.callsign), { resumed: stored });
    return;
  }

  if (stored) forget();
  loadSuggestions();
  els.input.focus();
})();
