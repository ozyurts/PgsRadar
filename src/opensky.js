// Client for our own /api/states endpoint, which reads OpenSky server-side.
//
// The browser cannot call OpenSky directly: the API answers with
// `access-control-allow-origin: https://opensky-network.org`, i.e. it allows
// only OpenSky's own site, so a cross-origin read is always blocked. OpenSky
// also refuses connections from some cloud regions — from Vercel's iad1 the
// TCP handshake times out, while fra1 answers in ~75ms — so the serverless
// function is pinned to fra1 in vercel.json.
//
// Because every visitor now shares one egress IP, the response is cached at
// the edge; see api/states.js for the credit-budget reasoning.

const PROXY_URL = '/api/states';

// An env var that exists but is blank (Vercel adds the keys from .env.example
// this way on import) must fall back to the default, not to Number('') === 0 —
// a zero-area box silently returns no flights at all.
function envNumber(raw, fallback) {
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

// Generous box around Pegasus' route network: Europe, North Africa, the
// Middle East and Central Asia. Override via env if you retarget the app.
const BBOX = {
  lamin: envNumber(import.meta.env.VITE_BBOX_LAMIN, 15),
  lomin: envNumber(import.meta.env.VITE_BBOX_LOMIN, -15),
  lamax: envNumber(import.meta.env.VITE_BBOX_LAMAX, 65),
  lomax: envNumber(import.meta.env.VITE_BBOX_LOMAX, 80),
};

// State vector field order, per OpenSky's documented schema.
const FIELDS = [
  'icao24', 'callsign', 'origin_country', 'time_position', 'last_contact',
  'longitude', 'latitude', 'baro_altitude', 'on_ground', 'velocity',
  'true_track', 'vertical_rate', 'sensors', 'geo_altitude', 'squawk',
  'spi', 'position_source', 'category',
];

function rowToFlight(row) {
  const f = {};
  FIELDS.forEach((key, i) => { f[key] = row[i]; });
  return f;
}

function query() {
  return new URLSearchParams(
    Object.entries(BBOX).map(([k, v]) => [k, String(v)])
  ).toString();
}

async function getStates(signal) {
  const res = await fetch(`${PROXY_URL}?${query()}`, { signal });
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error('OpenSky kredi limiti doldu, sonra tekrar denenecek');
    }
    throw new Error(`Veri kaynağı ${res.status} döndü`);
  }
  return res.json();
}

/**
 * Fetch current state vectors and return only flights whose callsign starts
 * with the given prefix (default: Pegasus's ICAO callsign "PGT").
 */
export async function fetchFleet({ prefix = 'PGT', signal } = {}) {
  const data = await getStates(signal);
  const rows = data.states || [];

  return rows
    .map(rowToFlight)
    .filter((f) => {
      if (!f.callsign) return false;
      if (f.longitude == null || f.latitude == null) return false;
      if (f.on_ground) return false;
      return f.callsign.trim().toUpperCase().startsWith(prefix);
    })
    .map((f) => ({
      icao24: f.icao24,
      callsign: f.callsign.trim(),
      originCountry: f.origin_country,
      lon: f.longitude,
      lat: f.latitude,
      altitudeM: f.geo_altitude ?? f.baro_altitude ?? 0,
      speedMs: f.velocity ?? 0,
      heading: f.true_track ?? 0,
      verticalRateMs: f.vertical_rate ?? 0,
      lastContact: f.last_contact,
    }));
}
