// TEMPORARY: measure how well the free callsign->route databases actually do
// for Pegasus specifically. Published accuracy studies cover the US and
// northern Europe; there is no Turkey/Middle East data, and the known failure
// mode is a confidently wrong answer rather than a blank one. So the useful
// question is not "does it answer" but "does the answer touch a Turkish
// airport", which for a PGT flight it almost always should.
//
// Remove once the route question is settled.

const ADSBDB = 'https://api.adsbdb.com/v0/callsign/';
const HEXDB = 'https://hexdb.io/callsign-route?callsign=';
const ADSBLOL_ROUTESET = 'https://api.adsb.lol/api/0/routeset';

const TIMEOUT_MS = 8000;
const UA = 'pgsradar (+https://pgsradar.vercel.app)';

// Pegasus bases. A genuine PGT route should have one end here.
const TURKISH_PREFIX = 'LT';

async function adsbdb(callsign) {
  const res = await fetch(ADSBDB + encodeURIComponent(callsign), {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': UA },
  });
  if (!res.ok) return { status: res.status };
  const body = await res.json();
  const route = body?.response?.flightroute;
  return {
    status: 200,
    origin: route?.origin?.icao_code,
    destination: route?.destination?.icao_code,
    airline: route?.airline?.name,
  };
}

async function hexdb(callsign) {
  const res = await fetch(HEXDB + encodeURIComponent(callsign), {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': UA, accept: 'application/json' },
  });
  if (!res.ok) return { status: res.status };
  const text = await res.text();
  // Answers either as JSON or as a bare "LTFJ-EDDB" string.
  let route = text.trim();
  try {
    const parsed = JSON.parse(text);
    route = parsed.route ?? parsed;
  } catch {}
  const [origin, destination] = String(route).split('-');
  return { status: 200, origin, destination, raw: String(route).slice(0, 40) };
}

async function routeset(flights) {
  const res = await fetch(ADSBLOL_ROUTESET, {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'user-agent': UA,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      planes: flights.map((f) => ({
        callsign: f.callsign,
        lat: f.lat,
        lng: f.lon,
      })),
    }),
  });
  // Dump the raw text: a previous run got a 2xx with an empty body, which
  // JSON.parse turns into a misleading syntax error.
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch {}
  return {
    status: res.status,
    rawLength: text.length,
    raw: text.slice(0, 300),
    // One request covers every aircraft, which matters: these services rate
    // limit hard and we have ~25 flights up at a time.
    batched: Array.isArray(parsed) ? parsed.length : null,
    sample: Array.isArray(parsed) ? parsed.slice(0, 3) : parsed,
  };
}

/** Pull the routeset request schema out of the published OpenAPI document. */
async function routesetSchema() {
  const res = await fetch('https://api.adsb.lol/openapi.json', {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': UA },
  });
  if (!res.ok) return { status: res.status };
  const spec = await res.json();
  const path = spec.paths?.['/api/0/routeset'];
  const ref = path?.post?.requestBody?.content?.['application/json']?.schema?.$ref;
  const name = ref?.split('/').pop();
  const schema = name ? spec.components?.schemas?.[name] : undefined;

  // Resolve one level of nesting so the plane item fields are visible too.
  const itemRef = schema?.properties?.planes?.items?.$ref;
  const itemName = itemRef?.split('/').pop();

  return {
    methods: path ? Object.keys(path) : null,
    requestSchemaName: name,
    requestSchema: schema,
    planeItem: itemName ? spec.components?.schemas?.[itemName] : undefined,
  };
}

function scoreOf(results) {
  const answered = results.filter((r) => r.origin && r.destination);
  const turkish = answered.filter(
    (r) =>
      String(r.origin).startsWith(TURKISH_PREFIX) ||
      String(r.destination).startsWith(TURKISH_PREFIX)
  );
  return {
    asked: results.length,
    answered: answered.length,
    touchesTurkey: turkish.length,
  };
}

// Fetch live PGT callsigns straight from the aggregator rather than from our
// own /api/states: deployment protection answers that with an HTML login page,
// so the probe would be parsing a web page instead of JSON.
async function liveCallsigns() {
  const res = await fetch(
    'https://api.adsb.lol/v2/lat/39.5/lon/32.0/dist/250',
    { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': UA } }
  );
  const body = await res.json();
  return (body.ac || [])
    .filter((a) => (a.flight || '').trim().toUpperCase().startsWith('PGT'))
    .map((a) => ({
      callsign: (a.flight || '').trim(),
      lat: a.lat,
      lon: a.lon,
    }));
}

export default async function handler(req, res) {
  const flights = await liveCallsigns();
  const sample = flights.slice(0, 8);

  const rows = [];
  for (const f of sample) {
    const [a, h] = await Promise.all([
      adsbdb(f.callsign).catch((e) => ({ error: String(e).slice(0, 80) })),
      hexdb(f.callsign).catch((e) => ({ error: String(e).slice(0, 80) })),
    ]);
    rows.push({ callsign: f.callsign, adsbdb: a, hexdb: h });
  }

  let lol;
  try {
    lol = await routeset(sample);
  } catch (err) {
    lol = { error: String(err?.cause ?? err).slice(0, 160) };
  }

  let schema;
  try {
    schema = await routesetSchema();
  } catch (err) {
    schema = { error: String(err?.cause ?? err).slice(0, 160) };
  }

  res.setHeader('cache-control', 'no-store');
  res.status(200).json({
    flightsSeen: flights.length,
    sampled: sample.length,
    score: {
      adsbdb: scoreOf(rows.map((r) => r.adsbdb)),
      hexdb: scoreOf(rows.map((r) => r.hexdb)),
    },
    rows,
    adsblolRouteset: lol,
    adsblolSchema: schema,
  });
}
