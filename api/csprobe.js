// TEMPORARY: does adsbdb carry an IATA flight number, and does it do anything
// sensible with the alphanumeric callsigns Pegasus also uses? Hardcoded list.
const SAMPLES = ['PGT1658', 'PGT612', 'PGT6AK', 'PGT480Q', 'PGT34VX'];

export default async function handler(req, res) {
  const rows = [];
  for (const cs of SAMPLES) {
    try {
      const r = await fetch(`https://api.adsbdb.com/v0/callsign/${cs}`, {
        signal: AbortSignal.timeout(8000),
        headers: { 'user-agent': 'pgsradar (+https://pgsradar.vercel.app)' },
      });
      const body = await r.json();
      const fr = body?.response?.flightroute;
      rows.push({
        asked: cs,
        status: r.status,
        // Report the whole key set once so nothing useful stays hidden.
        keys: fr ? Object.keys(fr) : null,
        callsign: fr?.callsign,
        callsign_icao: fr?.callsign_icao,
        callsign_iata: fr?.callsign_iata,
        airlineIata: fr?.airline?.iata,
        airlineIcao: fr?.airline?.icao,
      });
    } catch (err) {
      rows.push({ asked: cs, error: String(err?.cause ?? err).slice(0, 120) });
    }
  }
  res.setHeader('cache-control', 'no-store');
  res.status(200).json({ rows });
}
