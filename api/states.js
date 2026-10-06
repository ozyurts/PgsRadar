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
import { AIRLINES, DEFAULT_AIRLINE } from '../lib/airlines.js';

const SOURCES = [
  { name: 'adsb.lol', base: 'https://api.adsb.lol/v2' },
  { name: 'adsb.fi', base: 'https://opendata.adsb.fi/api/v2' },
];

// Overlapping 250nm circles covering the Pegasus route network: Turkey and
// the Aegean, the Balkans, central and western Europe, North Africa, the
// Levant, the Gulf, the Caucasus and Central Asia.
//
// The last one, eastern Anatolia, was added after the coverage was actually
// measured against the airport table rather than eyeballed on a map: the
// original twelve left 18 Turkish airports outside every circle — the whole
// south-east and Black Sea coast, Diyarbakır, Trabzon, Gaziantep, Şanlıurfa,
// Erzurum, Malatya among them — all of which Pegasus serves daily. A flight
// to any of them simply vanished from the map partway there. One circle at
// [38.75, 39.75] closes all 18 with 177km to spare, and picks up Batumi and
// Kutaisi on the way. Check it with the same arithmetic before moving any
// centre: distance from an airport to the nearest centre must stay under
// RADIUS_NM, and a map drawn in a browser lies about that at this latitude.
const CIRCLES = [
  [39.5, 32.0], [41.5, 22.0], [47.0, 14.0], [50.5, 5.0],
  [54.0, -2.0], [42.0, 3.0], [36.0, 10.0], [33.0, 35.0],
  [28.0, 47.0], [40.0, 48.0], [43.0, 68.0], [55.0, 37.0],
  [38.75, 39.75],
];

// The circles above follow Pegasus's network, and they were never meant to
// cover Smartwings's: measured against the same arithmetic, they left out the
// Canary Islands, Madeira, the Red Sea resorts, Crete and Rhodes, Andalusia
// and the Algarve, and the Polish bases — most of what a Prague charter
// carrier flies. Each airline therefore adds its own circles on top
// (`extraCircles` in lib/airlines.js), swept only when that airline is asked
// for. Pegasus's sweep stays exactly what it was; Smartwings's costs five
// more queries, under its own cache entry.
//
// Which circle covers the fleet's base is per airline too (`hubCircle`).
// Both providers are asked for that one (see handler), so moving a centre
// means checking that index with it.

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

// Stands in for a missing `seen_pos`: a record that does not say how old it
// is loses to any record that does.
const STALE_SECONDS = 1e9;

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
    // How many seconds ago the feed last heard this position. Used only to
    // settle duplicates (see remember) and stripped before the response goes
    // out — the client has no use for it and it would just be one more field
    // to keep honest.
    seenPos: typeof ac.seen_pos === 'number' ? ac.seen_pos : STALE_SECONDS,
  };
}

/**
 * Record an aircraft, keeping the fresher of two sightings.
 *
 * The hub circle is asked of both providers (see handler), so the same
 * airframe arrives twice, from two different receiver networks. Last write
 * wins would mean the map shows whichever request happened to finish last —
 * which is a race, not a choice. The feed states how old each position is, so
 * use that.
 */
function remember(byHex, flight) {
  const previous = byHex.get(flight.icao24);
  if (previous && previous.seenPos <= flight.seenPos) return;
  byHex.set(flight.icao24, flight);
}

function matches(flight, prefixes) {
  const callsign = flight.callsign.toUpperCase();
  return prefixes.some((prefix) => callsign.startsWith(prefix));
}

/**
 * Which callsigns to keep, and where to look for them.
 *
 * `?airline=` is what the page sends. `?prefix=` predates it and is kept so an
 * old link still answers; it gets Pegasus's circles, which is what it always
 * had. An unknown airline falls back to the default rather than erroring —
 * the same leniency the prefix check always had.
 */
function scopeOf(query) {
  const first = (value) => (Array.isArray(value) ? value[0] : value);

  const rawPrefix = first(query?.prefix);
  if (rawPrefix != null && query?.airline == null) {
    const candidate = String(rawPrefix).toUpperCase();
    const prefix = /^[A-Z0-9]{1,8}$/.test(candidate) ? candidate : 'PGT';
    return { prefixes: [prefix], ...circlesFor(AIRLINES[DEFAULT_AIRLINE]) };
  }

  const key = String(first(query?.airline) ?? DEFAULT_AIRLINE).toLowerCase();
  const airline = AIRLINES[key] ?? AIRLINES[DEFAULT_AIRLINE];
  return { prefixes: airline.prefixes, ...circlesFor(airline) };
}

function circlesFor(airline) {
  return {
    circles: [...CIRCLES, ...airline.extraCircles],
    hub: CIRCLES[airline.hubCircle],
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
async function sweep(source, circles, prefixes, byHex) {
  const missed = [];

  for (let i = 0; i < circles.length; i++) {
    if (i > 0) await sleep(SPACING_MS);
    const [lat, lon] = circles[i];
    try {
      // The circles overlap, so the same aircraft comes back more than once.
      for (const ac of await queryCircle(source.base, lat, lon)) {
        const flight = normalise(ac);
        if (!flight) continue;
        if (!matches(flight, prefixes)) continue;
        remember(byHex, flight);
      }
    } catch (err) {
      missed.push({ circle: circles[i], triedSource: source.name, reason: err.message });
    }
  }

  return missed;
}

export default async function handler(req, res) {
  const { prefixes, circles, hub } = scopeOf(req.query);

  const byHex = new Map();

  // Split the circles between the providers so neither sees the full rate,
  // and run the two sweeps concurrently — the limits are per provider.
  //
  // The hub circle is the exception: it goes to both. The two providers are
  // separate receiver networks and they do not see the same aircraft. Measured
  // at one instant on 4 October 2026 over this very circle: adsb.lol reported
  // 8 PGT flights, adsb.fi reported 12; within 30nm of the hub itself, 10
  // aircraft against 13. Asking only one of them throws away whatever the
  // other hears, and nowhere does that cost more than over the airport the
  // fleet departs from. One extra request buys the union.
  //
  // Written so the hub lands on each list exactly once wherever its index
  // falls; for Pegasus (hub at 0) this is the same split as before airlines
  // existed.
  const [primary, secondary] = SOURCES;
  const [missedA, missedB] = await Promise.all([
    sweep(primary, circles.filter((c, i) => i % 2 === 0 || c === hub), prefixes, byHex),
    sweep(secondary, [hub, ...circles.filter((c, i) => i % 2 === 1 && c !== hub)], prefixes, byHex),
  ]);

  // Anything one provider refused, give the other a chance at.
  //
  // The hub is the exception again: it went to both, so one failure there is
  // already covered by the other sweep and retrying would spend a request on
  // data we hold. Only a double failure earns a third attempt, and only one.
  const stillMissing = [];
  const all = [...missedA, ...missedB];
  const hubMisses = all.filter((m) => m.circle === hub);
  const retries = [
    ...all.filter((m) => m.circle !== hub),
    ...(hubMisses.length === 2 ? [hubMisses[0]] : []),
  ];

  if (retries.length) await sleep(RETRY_PAUSE_MS);

  for (let i = 0; i < retries.length; i++) {
    const { circle, triedSource, reason } = retries[i];
    const other = SOURCES.find((s) => s.name !== triedSource);
    if (i > 0) await sleep(RETRY_SPACING_MS);
    try {
      for (const ac of await queryCircle(other.base, circle[0], circle[1])) {
        const flight = normalise(ac);
        if (!flight) continue;
        if (!matches(flight, prefixes)) continue;
        remember(byHex, flight);
      }
    } catch (err) {
      stillMissing.push(
        `${circle}: ${triedSource}: ${reason} / ${other.name}: ${err.message}`
      );
    }
  }

  // One more query than there are circles now goes out, so the "everything
  // failed" test counts queries, not circles.
  if (stillMissing.length >= circles.length + 1) {
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
    // seenPos settles duplicates on the way in and has no meaning on the way
    // out; carrying it would invite the client to read it as "data age", which
    // it is not — it is the age of one provider's last hearing.
    flights: [...byHex.values()].map(({ seenPos, ...flight }) => flight),
  });
}
