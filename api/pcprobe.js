// TEMPORARY PROBE — delete after measuring.
//
// Question: is there a key-less source that maps a lettered PGT callsign
// (PGT30GF) to the flight number a passenger holds (PC904)? The sandbox this
// was written in cannot reach any of the candidates, so the measurement has to
// run from the deployment. See CLAUDE.md, "Doğrulama".
//
// Fetches one allow-listed URL and returns a slice of it, or the neighbourhood
// of every match for a pattern — a Pegasus page is hundreds of kilobytes and
// the interesting part is a handful of endpoint strings inside its bundle.
//
// The host allow-list is what keeps this from being an open proxy while it is
// live. The user agent is the project's own: a site that does not want to be
// read this way should be able to say so, and a 403 is an answer, not an
// obstacle to work around.

const ALLOWED = new Set([
  'api.adsbdb.com',
  'hexdb.io',
  'www.flypgs.com',
  'flypgs.com',
  'www.pegasusairlines.com',
  'web.flypgs.com',
  // The sandbox reaches raw.githubusercontent.com but not github.com or the
  // API, and listing a repository's tree needs the API.
  'api.github.com',
  'raw.githubusercontent.com',
]);

const USER_AGENT = 'pgsradar (+https://pgsradar.vercel.app)';
const TIMEOUT_MS = 12000;

export default async function handler(req, res) {
  const raw = String(req.query?.u ?? '');
  let url;
  try {
    url = new URL(raw);
  } catch {
    res.status(400).json({ error: 'u= geçerli bir URL değil' });
    return;
  }
  if (url.protocol !== 'https:' || !ALLOWED.has(url.hostname)) {
    res.status(403).json({ error: 'host izinli değil', allowed: [...ALLOWED] });
    return;
  }

  const from = Math.max(0, Number(req.query?.from) || 0);
  const len = Math.min(Math.max(1, Number(req.query?.len) || 3000), 20000);
  const grep = String(req.query?.grep ?? '');
  const accept = String(req.query?.accept ?? 'text/html,application/json,*/*');

  try {
    const r = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept, 'accept-language': 'tr,en' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await r.text();

    const out = {
      url: url.href,
      status: r.status,
      type: r.headers.get('content-type'),
      server: r.headers.get('server'),
      length: text.length,
    };

    if (grep) {
      const re = new RegExp(grep, 'gi');
      const hits = [];
      let m;
      while ((m = re.exec(text)) !== null && hits.length < 40) {
        hits.push(text.slice(Math.max(0, m.index - 100), m.index + 180));
        if (m.index === re.lastIndex) re.lastIndex++; // empty match guard
      }
      out.hitCount = hits.length;
      out.hits = hits;
    } else {
      out.body = text.slice(from, from + len);
    }

    res.setHeader('cache-control', 'no-store');
    res.status(200).json(out);
  } catch (err) {
    res.setHeader('cache-control', 'no-store');
    res.status(200).json({ url: url.href, error: String(err?.message || err) });
  }
}
