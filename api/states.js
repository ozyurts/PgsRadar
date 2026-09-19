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
// around a point, so the fleet's range is covered by a set of overlapping
// circles that are swept one after another and merged.

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
const USER_AGENT = 'pgsradar (+https://pgsradar.vercel.app)';

const FT_TO_M = 0.3048;
const KT_TO_MS = 0.514444;
const FTMIN_TO_MS = 0.00508;

function normalise(ac) {
  const callsign = (ac.flight || '').trim();
  if (!callsign) return null;
  if (ac.lat == null || ac.lon == null) return null;

  // alt_baro is the string "ground" for aircraft that have not taken off.
  const altFt = typeof ac.alt_geom === 'number' ? ac.alt_geom
    : typeof ac.alt_baro === 'number' ? ac.alt_baro
    : null;
  if (altFt == null) return null;

  const rateFtMin = typeof ac.geom_rate === 'number' ? ac.geom_rate
    : typeof ac.baro_rate === 'number' ? ac.baro_rate
    : 0;

  return {
    icao24: ac.hex,
    callsign,
    originCountry: ac.r || '',
    lat: ac.lat,
    lon: ac.lon,
    altitudeM: altFt * FT_TO_M,
    speedMs: (typeof ac.gs === 'number' ? ac.gs : 0) * KT_TO_MS,
    heading: typeof ac.track === 'number' ? ac.track : 0,
    verticalRateMs: rateFtMin * FTMIN_TO_MS,
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

async function collect(source, prefix) {
  // Sequential, not Promise.all: firing all twelve at once made the upstream
  // drop several of them, and a dropped circle is a hole in the map. At ~60ms
  // each the whole sweep still costs well under a second, and the edge cache
  // means we only pay it once per CACHE_SECONDS.
  const byHex = new Map();
  const failures = [];

  for (const [lat, lon] of CIRCLES) {
    try {
      // The circles overlap, so the same aircraft comes back more than once.
      for (const ac of await queryCircle(source.base, lat, lon)) {
        const flight = normalise(ac);
        if (!flight) continue;
        if (!flight.callsign.toUpperCase().startsWith(prefix)) continue;
        byHex.set(flight.icao24, flight);
      }
    } catch (err) {
      failures.push(`${lat},${lon}: ${err.message}`);
    }
  }

  if (failures.length === CIRCLES.length) {
    throw new Error(`every circle failed (${failures[0]})`);
  }
  if (failures.length) {
    console.warn(`${source.name} partial coverage:`, failures.join(' | '));
  }

  return { flights: [...byHex.values()], degraded: failures.length > 0 };
}

export default async function handler(req, res) {
  const raw = req.query?.prefix;
  const candidate = String(Array.isArray(raw) ? raw[0] : raw ?? 'PGT').toUpperCase();
  const prefix = /^[A-Z0-9]{1,8}$/.test(candidate) ? candidate : 'PGT';

  const problems = [];
  for (const source of SOURCES) {
    try {
      const { flights, degraded } = await collect(source, prefix);
      res.setHeader(
        'cache-control',
        `s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 3}`
      );
      res.status(200).json({
        time: Math.floor(Date.now() / 1000),
        source: source.name,
        degraded,
        flights,
      });
      return;
    } catch (err) {
      problems.push(`${source.name}: ${err.message}`);
    }
  }

  console.error('All upstream sources failed:', problems.join(' | '));
  res.status(502).json({ error: 'Veri kaynaklarına ulaşılamadı' });
}
