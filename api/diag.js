// TEMPORARY diagnostic — remove once the data source is settled.
// Targets are hardcoded; no user input reaches fetch.

const OPENSKY = 'https://opensky-network.org/api/states/all?lamin=35&lomin=25&lamax=43&lomax=45';

// Community ADS-B aggregators, as candidate replacements. Centred on Turkey.
const ALTERNATIVES = [
  ['adsb.lol', 'https://api.adsb.lol/v2/lat/39.0/lon/35.0/dist/250'],
  ['airplanes.live', 'https://api.airplanes.live/v2/point/39.0/35.0/250'],
  ['adsb.fi', 'https://opendata.adsb.fi/api/v2/lat/39.0/lon/35.0/dist/250'],
];

async function probe(name, url, timeoutMs = 12000) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'pgsradar-diag' },
    });
    const body = await res.text();
    let aircraft;
    try {
      const j = JSON.parse(body);
      aircraft = (j.ac || j.aircraft || j.states || []).length;
    } catch {}
    return {
      name,
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
      cors: res.headers.get('access-control-allow-origin'),
      bytes: body.length,
      aircraft,
      head: res.ok ? undefined : body.slice(0, 120),
    };
  } catch (err) {
    return {
      name,
      ms: Date.now() - started,
      code: err?.cause?.code ?? err?.name ?? 'ERR',
      error: String(err?.cause ?? err).slice(0, 160),
    };
  }
}

export default async function handler(req, res) {
  // Five sequential OpenSky attempts, to measure how often it actually works.
  const opensky = [];
  for (let i = 0; i < 5; i++) {
    opensky.push(await probe(`opensky#${i + 1}`, OPENSKY));
  }

  const alternatives = [];
  for (const [name, url] of ALTERNATIVES) {
    alternatives.push(await probe(name, url));
  }

  const okCount = opensky.filter((p) => p.ok).length;

  res.setHeader('cache-control', 'no-store');
  res.status(200).json({
    region: process.env.VERCEL_REGION,
    openskySuccessRate: `${okCount}/5`,
    opensky,
    alternatives,
  });
}
