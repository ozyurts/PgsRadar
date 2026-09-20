// Reads live aircraft positions server-side and returns only the tracked
// fleet, already normalised to SI units.
//
// Why not OpenSky, which this project started on: it answers with
// `access-control-allow-origin: https://opensky-network.org`, so a browser on
// another origin can never read it, and it refuses connections from Vercel
// entirely — measured 0/5 successful TCP handshakes from fra1, every one
// timing out after 10s. Credentials cannot fix that; you have to connect
// before you can authenticate.
//
// adsb.lol and adsb.fi are community ADS-B aggregators, need no key, and
// answer from fra1 in 50-80ms. Their API caps a query at 250 nautical miles
// around a point, so the fleet's range is covered by overlapping circles.
//
// Aircraft on the ground are included and flagged with `onGround`, and named
// with the airport they are standing on (see lib/airports.js). The client
// draws them as its own layer. They are not filtered out here because the
// filter cannot be made honest at this level — see normalise().

import { nearestAirport } from '../lib/airports.js';

const SOURCES = [
  { name: 'adsb.lol', base: 'https://api.adsb.lol/v2' },
  { name: 'adsb.fi', base: 'https://opendata.adsb.fi/api/v2' },
];

// Overlapping 250nm circles covering the Pegasus route network: Turkey and
// the Aegean, the Balkans, central and western Europe, North Africa, the
// Levant, the Gulf, the Caucasus and Central Asia.
const CIRCLES = [
  [39.5, 32.0], [41.5, 22.0], [47.0, 14.0], [50.5, 5.0],
  [54.0, -2.0], [42.0, 3.0], [36.0, 10.0], [33.0, 35.0],
  [28.0, 47.0], [40.0, 48.0], [43.0, 68.0], [55.0, 37.0],
];

const RADIUS_NM = 250;
const CACHE_SECONDS = 60;
const UPSTREAM_TIMEOUT_MS = 8000;
// These are free community services and they rate-limit by request rate, not
// by concurrency: twelve queries sent back to back cost six 429s regardless of
// whether they go out in parallel or in a tight loop. So the circles are split
// across both providers and spaced out within each sweep.
const SPACING_MS = 550;
// Retries go out after the sweeps, when the rate window is at its tightest.
// Pausing first is what turns a retry into a second chance rather than a
// third 429.
const RETRY_PAUSE_MS = 1500;
const RETRY_SPACING_MS = 900;
const USER_AGENT = 'pgsradar (+https://pgsradar.vercel.app)';

const FT_TO_M = 0.3048;
const KT_TO_MS = 0.514444;
const FTMIN_TO_MS = 0.00508;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Only adsb.lol sends a description; adsb.fi sends the ICAO type code alone.
// Naming from the code first keeps one aircraft type reading the same however
// it was fetched — otherwise the same A321neo would appear as "AIRBUS A-321neo"
// or as nothing at all depending on which provider answered that circle.
const TYPE_NAMES = {
  A19N: 'Airbus A319neo',
  A20N: 'Airbus A320neo',
  A21N: 'Airbus A321neo',
  A319: 'Airbus A319',
  A320: 'Airbus A320',
  A321: 'Airbus A321',
  B737: 'Boeing 737-700',
  B738: 'Boeing 737-800',
  B739: 'Boeing 737-900',
  B38M: 'Boeing 737 MAX 8',
  B39M: 'Boeing 737 MAX 9',
};

// Descriptions come through shouting ("AIRBUS A-321neo"). Title-case word by
// word rather than testing the whole string: one lower-case tail ("neo") must
// not excuse the rest from being fixed.
function tidyModel(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;

  return text
    .split(' ')
    .map((word) =>
      // Leave anything with a digit or any lower case already in it alone.
      /\d/.test(word) || /[a-z]/.test(word)
        ? word
        : word.charAt(0) + word.slice(1).toLowerCase()
    )
    .join(' ');
}

function modelOf(ac) {
  const type = String(ac.t ?? '').trim().toUpperCase();
  return TYPE_NAMES[type] || tidyModel(ac.desc) || null;
}

// `track` is the direction of travel, and an aircraft that is not travelling
// does not report one — parked and slow-taxiing aircraft send their heading
// instead. Falling straight through to 0 would point every one of them north.
function headingOf(ac) {
  for (const value of [ac.track, ac.true_heading, ac.mag_heading]) {
    if (typeof value === 'number') return value;
  }
  return 0;
}

function normalise(ac) {
  const callsign = (ac.flight || '').trim();
  if (!callsign) return null;
  if (ac.lat == null || ac.lon == null) return null;

  // alt_baro is the string "ground" for aircraft on the surface. This has to
  // be read before alt_geom, not after: some airframes keep sending a GPS
  // altitude while parked, so preferring alt_geom used to let a stationary
  // aircraft through as if it were airborne at 8 metres — which is how a few
  // ground aircraft appeared on the map while the rest were filtered out.
  const onGround = String(ac.alt_baro).toLowerCase() === 'ground';

  const altFt = onGround ? 0
    : typeof ac.alt_geom === 'number' ? ac.alt_geom
    : typeof ac.alt_baro === 'number' ? ac.alt_baro
    : null;
  // An airborne aircraft with no altitude at all cannot be drawn honestly.
  if (altFt == null) return null;

  const rateFtMin = typeof ac.geom_rate === 'number' ? ac.geom_rate
    : typeof ac.baro_rate === 'number' ? ac.baro_rate
    : 0;

  return {
    icao24: ac.hex,
    callsign,
    registration: ac.r || '',
    // The aggregator already carries the airframe, so the type costs nothing
    // extra: no second lookup, no second source to disagree with.
    type: String(ac.t ?? '').trim() || null,
    model: modelOf(ac),
    onGround,
    // Which field it is standing on. Only asked for ground aircraft: for an
    // airborne one the nearest airport is a coincidence, not a fact about the
    // flight.
    airport: onGround ? nearestAirport(ac.lat, ac.lon) : null,
    lat: ac.lat,
    lon: ac.lon,
    altitudeM: altFt * FT_TO_M,
    speedMs: (typeof ac.gs === 'number' ? ac.gs : 0) * KT_TO_MS,
    heading: headingOf(ac),
    // A parked aircraft's baro_rate drifts with the pressure, not with the
    // aircraft; carrying it through would make the map climb the apron.
    verticalRateMs: onGround ? 0 : rateFtMin * FTMIN_TO_MS,
  };
}

async function queryCircle(base, lat, lon) {
  const res = await fetch(`${base}/lat/${lat}/lon/${lon}/dist/${RADIUS_NM}`, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(String(res.status));
  const body = await res.json();
  return body.ac || body.aircraft || [];
}

/**
 * Query each circle against one source, spaced out, collecting aircraft into
 * `byHex`. Returns the circles this sweep could not fetch.
 */
async function sweep(source, circles, prefix, byHex) {
  const missed = [];

  for (let i = 0; i < circles.length; i++) {
    if (i > 0) await sleep(SPACING_MS);
    const [lat, lon] = circles[i];
    try {
      // The circles overlap, so the same aircraft comes back more than once.
      for (const ac of await queryCircle(source.base, lat, lon)) {
        const flight = normalise(ac);
        if (!flight) continue;
        if (!flight.callsign.toUpperCase().startsWith(prefix)) continue;
        byHex.set(flight.icao24, flight);
      }
    } catch (err) {
      missed.push({ circle: circles[i], triedSource: source.name, reason: err.message });
    }
  }

  return missed;
}

export default async function handler(req, res) {
  const raw = req.query?.prefix;
  const candidate = String(Array.isArray(raw) ? raw[0] : raw ?? 'PGT').toUpperCase();
  const prefix = /^[A-Z0-9]{1,8}$/.test(candidate) ? candidate : 'PGT';

  const byHex = new Map();

  // Split the circles between the providers so neither sees the full rate,
  // and run the two sweeps concurrently — the limits are per provider.
  const [primary, secondary] = SOURCES;
  const [missedA, missedB] = await Promise.all([
    sweep(primary, CIRCLES.filter((_, i) => i % 2 === 0), prefix, byHex),
    sweep(secondary, CIRCLES.filter((_, i) => i % 2 === 1), prefix, byHex),
  ]);

  // Anything one provider refused, give the other a chance at.
  const stillMissing = [];
  const retries = [...missedA, ...missedB];

  if (retries.length) await sleep(RETRY_PAUSE_MS);

  for (let i = 0; i < retries.length; i++) {
    const { circle, triedSource, reason } = retries[i];
    const other = SOURCES.find((s) => s.name !== triedSource);
    if (i > 0) await sleep(RETRY_SPACING_MS);
    try {
      for (const ac of await queryCircle(other.base, circle[0], circle[1])) {
        const flight = normalise(ac);
        if (!flight) continue;
        if (!flight.callsign.toUpperCase().startsWith(prefix)) continue;
        byHex.set(flight.icao24, flight);
      }
    } catch (err) {
      stillMissing.push(
        `${circle}: ${triedSource}: ${reason} / ${other.name}: ${err.message}`
      );
    }
  }

  if (stillMissing.length === CIRCLES.length) {
    console.error('Every circle failed:', stillMissing.join(' | '));
    res.status(502).json({ error: 'Veri kaynaklarına ulaşılamadı' });
    return;
  }
  if (stillMissing.length) {
    console.warn('Partial coverage:', stillMissing.join(' | '));
  }

  res.setHeader(
    'cache-control',
    `s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 3}`
  );
  res.status(200).json({
    time: Math.floor(Date.now() / 1000),
    sources: SOURCES.map((s) => s.name),
    degraded: stillMissing.length > 0,
    flights: [...byHex.values()],
  });
}
