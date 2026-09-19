// TEMPORARY: verify aviationstack is reachable from our region before anyone
// pays for it. OpenSky was unreachable from Vercel, so reachability is not a
// safe assumption. No key needed: a 401/error JSON still proves TCP+TLS work.
export default async function handler(req, res) {
  const targets = [
    ['https', 'https://api.aviationstack.com/v1/flights?airline_icao=PGT&limit=1'],
    ['http', 'http://api.aviationstack.com/v1/flights?airline_icao=PGT&limit=1'],
  ];

  const results = [];
  for (const [name, url] of targets) {
    const started = Date.now();
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: { 'user-agent': 'pgsradar (+https://pgsradar.vercel.app)' },
      });
      const body = await r.text();
      results.push({
        name,
        status: r.status,
        ms: Date.now() - started,
        body: body.slice(0, 260),
      });
    } catch (err) {
      results.push({
        name,
        ms: Date.now() - started,
        code: err?.cause?.code ?? err?.name,
        error: String(err?.cause ?? err).slice(0, 160),
      });
    }
  }

  res.setHeader('cache-control', 'no-store');
  res.status(200).json({ region: process.env.VERCEL_REGION, results });
}
