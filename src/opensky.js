// Thin client for the OpenSky Network REST API.
//
// Anonymous access works with no credentials, on a limited daily credit
// budget (roughly 400 credits/day at time of writing). Two things keep us
// inside it:
//
//   * We poll conservatively (see VITE_POLL_INTERVAL_MS).
//   * We ask for a bounding box rather than the whole planet. A global
//     /states/all response is several megabytes and costs 4 credits; a
//     bounded one costs 1 and is a fraction of the size.
//
// The browser calls OpenSky directly, so each visitor spends their own IP's
// credit budget instead of a single shared one. If that call fails (CORS,
// rate limit), we fall back to the bundled serverless proxy in /api/states.
// See README.md.

const STATES_URL = 'https://opensky-network.org/api/states/all';
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

async function getJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`OpenSky ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

// OpenSky appears to drop connections from datacenter ranges, so the proxy
// can sit there until its own 10s connect timeout. Cap the wait so a failing
// fallback surfaces the error quickly instead of stalling the poll.
const PROXY_TIMEOUT_MS = 6000;

function withTimeout(signal, ms) {
  if (typeof AbortSignal?.timeout !== 'function') return signal;
  const timeout = AbortSignal.timeout(ms);
  if (typeof AbortSignal.any !== 'function') return signal ?? timeout;
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// Once one of the two routes works, stick with it rather than re-testing
// the direct call (and burning a credit on it) every poll.
let preferProxy = false;

async function getStates(signal) {
  if (preferProxy) {
    return getJson(`${PROXY_URL}?${query()}`, signal);
  }
  try {
    return await getJson(`${STATES_URL}?${query()}`, signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    // Direct call blocked or throttled — try the server-side proxy once.
    const data = await getJson(
      `${PROXY_URL}?${query()}`,
      withTimeout(signal, PROXY_TIMEOUT_MS)
    );
    preferProxy = true;
    return data;
  }
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
