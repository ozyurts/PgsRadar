// Resolves a callsign to a departure/arrival pair, but only when two
// independent databases agree.
//
// Why the agreement rule: adsbdb and hexdb both answer essentially every PGT
// callsign, and both answer confidently when wrong. Measured on live Pegasus
// flights they disagreed on 2 of 6, giving completely different airport pairs
// — so a single source would have shown a plausible-looking wrong route a
// good fraction of the time. A wrong route is worse than none: nobody
// double-checks a label that looks right. When they disagree we say so
// instead of picking a winner.
//
// This endpoint is called only for the flight the user selected, not for the
// whole fleet, and a callsign's route does not change mid-flight, so it is
// cached hard.

const ADSBDB = 'https://api.adsbdb.com/v0/callsign/';
const HEXDB = 'https://hexdb.io/callsign-route?callsign=';

const TIMEOUT_MS = 6000;
const CACHE_SECONDS = 6 * 60 * 60;
// A disagreement is a property of the databases, not a transient glitch, but
// keep it shorter so a corrected database shows up the same day.
const CACHE_SECONDS_UNRESOLVED = 30 * 60;
const USER_AGENT = 'pgsradar (+https://pgsradar.vercel.app)';

const ICAO = /^[A-Z]{4}$/;

function normaliseCode(value) {
  const code = String(value ?? '').trim().toUpperCase();
  return ICAO.test(code) ? code : null;
}

async function fromAdsbdb(callsign) {
  const res = await fetch(ADSBDB + encodeURIComponent(callsign), {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  });
  if (!res.ok) return null;

  const route = (await res.json())?.response?.flightroute;
  const origin = describe(route?.origin);
  const destination = describe(route?.destination);
  if (!origin || !destination) return null;

  return { origin, destination };
}

// Airport names arrive with boilerplate ("Manas International Airport") that
// eats the width of a phone-sized card without adding meaning.
const NAME_NOISE = /\s*(international|intl\.?|regional|airport|airbase|air base)\b/gi;

function shortenName(value) {
  const name = String(value ?? '').trim();
  if (!name) return null;
  const trimmed = name.replace(NAME_NOISE, '').replace(/\s{2,}/g, ' ').trim();
  // Never shorten a name into nothing — some airports are literally "Airport".
  return trimmed.length >= 3 ? trimmed : name;
}

/** Only adsbdb carries airport detail; hexdb answers with codes alone. */
function describe(port) {
  const icao = normaliseCode(port?.icao_code);
  if (!icao) return null;

  const name = shortenName(port?.name);
  const city = String(port?.municipality ?? '').trim() || null;

  // adsbdb carries coordinates too, so plotting the pair on the globe costs
  // no extra request.
  const lat = Number(port?.latitude);
  const lon = Number(port?.longitude);

  return {
    icao,
    iata: String(port?.iata_code ?? '').trim().toUpperCase() || null,
    name,
    city,
    country: String(port?.country_name ?? '').trim() || null,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
  };
}

async function fromHexdb(callsign) {
  const res = await fetch(HEXDB + encodeURIComponent(callsign), {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  });
  if (!res.ok) return null;

  // Answers either as JSON or as a bare "LTFJ-EDDB" string.
  const text = (await res.text()).trim();
  let route = text;
  try {
    const parsed = JSON.parse(text);
    route = parsed?.route ?? parsed;
  } catch {}

  const [origin, destination] = String(route).split('-');
  const from = normaliseCode(origin);
  const to = normaliseCode(destination);
  return from && to ? { origin: from, destination: to } : null;
}

export default async function handler(req, res) {
  const raw = req.query?.callsign;
  const callsign = String(Array.isArray(raw) ? raw[0] : raw ?? '')
    .trim()
    .toUpperCase();

  if (!/^[A-Z0-9]{3,10}$/.test(callsign)) {
    res.status(400).json({ error: 'Geçersiz çağrı işareti' });
    return;
  }

  const [a, h] = await Promise.all([
    fromAdsbdb(callsign).catch(() => null),
    fromHexdb(callsign).catch(() => null),
  ]);

  let payload;
  if (
    a && h &&
    a.origin.icao === h.origin &&
    a.destination.icao === h.destination
  ) {
    payload = {
      callsign,
      status: 'confirmed',
      origin: a.origin,
      destination: a.destination,
      sources: ['adsbdb', 'hexdb'],
    };
  } else if (a || h) {
    // Deliberately withholding the candidates: showing "maybe A, maybe B"
    // invites the reader to pick one, which is the mistake this guards against.
    payload = { callsign, status: 'conflict' };
  } else {
    payload = { callsign, status: 'unknown' };
  }

  const ttl =
    payload.status === 'confirmed' ? CACHE_SECONDS : CACHE_SECONDS_UNRESOLVED;
  res.setHeader('cache-control', `s-maxage=${ttl}, stale-while-revalidate=${ttl}`);
  res.status(200).json(payload);
}
