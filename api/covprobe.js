// TEMPORARY PROBE — delete after measuring.
//
// Question: does a 250nm query actually return everything inside it, or does
// the upstream truncate? The fleet's hub (SAW) sits 149nm from the centre of
// the circle that is supposed to cover it, so a truncated answer would drop
// the hub first and look exactly like "no flights around SAW".
//
// Reports, per provider: how many aircraft came back, how many carry the
// tracked prefix, and how far out the farthest one is. A farthest-aircraft
// distance well under the radius asked for is the signature of truncation.

const SOURCES = [
  { name: 'adsb.lol', base: 'https://api.adsb.lol/v2' },
  { name: 'adsb.fi', base: 'https://opendata.adsb.fi/api/v2' },
];

const USER_AGENT = 'pgsradar (+https://pgsradar.vercel.app)';
const rad = Math.PI / 180;

function distNm(aLat, aLon, bLat, bLon) {
  const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return (2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))) / 1.852;
}

export default async function handler(req, res) {
  const lat = Number(req.query?.lat ?? 39.5);
  const lon = Number(req.query?.lon ?? 32.0);
  const dist = Math.min(Number(req.query?.dist ?? 250), 250);
  const prefix = String(req.query?.prefix ?? 'PGT').toUpperCase();

  const out = { centre: [lat, lon], radiusNm: dist, sources: {} };

  for (const source of SOURCES) {
    try {
      const r = await fetch(`${source.base}/lat/${lat}/lon/${lon}/dist/${dist}`, {
        signal: AbortSignal.timeout(10000),
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      });
      if (!r.ok) {
        out.sources[source.name] = { status: r.status };
        continue;
      }
      const body = await r.json();
      const ac = body.ac || body.aircraft || [];
      const withDist = ac
        .filter((a) => a.lat != null && a.lon != null)
        .map((a) => ({ a, d: distNm(lat, lon, a.lat, a.lon) }));
      const mine = withDist.filter(
        (x) => (x.a.flight || '').trim().toUpperCase().startsWith(prefix)
      );

      out.sources[source.name] = {
        status: r.status,
        // Fields the upstream itself volunteers about the size of the answer.
        meta: Object.fromEntries(
          Object.entries(body).filter(([k]) => k !== 'ac' && k !== 'aircraft')
        ),
        total: ac.length,
        farthestNm: withDist.length
          ? Math.max(...withDist.map((x) => x.d)).toFixed(0)
          : null,
        prefixCount: mine.length,
        prefixFlights: mine
          .sort((x, y) => x.d - y.d)
          .map((x) => `${(x.a.flight || '').trim()}@${x.d.toFixed(0)}nm`),
      };
    } catch (err) {
      out.sources[source.name] = { error: String(err?.message || err) };
    }
  }

  res.setHeader('cache-control', 'no-store');
  res.status(200).json(out);
}
