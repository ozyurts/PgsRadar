// TEMPORARY probe: is airplanes.live usable as a third ADS-B source? Remove.
//
// Measures, in order: which URL shape answers, what the payload looks like,
// whether it carries the fields normalise() needs, how it rate-limits a burst,
// and how its coverage of one circle compares with adsb.lol's.

const UA = 'pgsradar (+https://pgsradar.vercel.app)';
const SAW = [40.9, 29.31];
const NM = 250;

async function probe(url, timeout = 5000) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeout),
      headers: { 'user-agent': UA, accept: 'application/json' },
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return {
      url,
      status: res.status,
      ms: Date.now() - t0,
      type: res.headers.get('content-type'),
      bytes: text.length,
      keys: json && !Array.isArray(json) ? Object.keys(json).slice(0, 12) : null,
      count: Array.isArray(json?.ac) ? json.ac.length
           : Array.isArray(json?.aircraft) ? json.aircraft.length : null,
      sample: (json?.ac || json?.aircraft || [])[0] ?? null,
      // Keep the body whenever the call did not succeed: a refusal's message
      // is the whole point of asking.
      body: res.ok && json ? undefined : text.slice(0, 400),
    };
  } catch (err) {
    return { url, error: String(err?.name || err), ms: Date.now() - t0 };
  }
}

export default async function handler(req, res) {
  const out = {};

  // --- 1. Which URL shape answers? -----------------------------------------
  const candidates = [
    // airplanes.live: measured, every path 403s behind an "email us first"
    // gate. Kept as one line so the next run re-confirms rather than assumes.
    `https://api.airplanes.live/v2/point/${SAW[0]}/${SAW[1]}/${NM}`,
    // Other aggregators that publish the same readsb/tar1090 shape. The host
    // names are guesses; that is what this probe is for.
    `https://api.adsb.one/v2/lat/${SAW[0]}/lon/${SAW[1]}/dist/${NM}`,
    `https://api.adsb.one/v2/point/${SAW[0]}/${SAW[1]}/${NM}`,
    `https://api.theairtraffic.com/v2/lat/${SAW[0]}/lon/${SAW[1]}/dist/${NM}`,
    `https://adsb.one/api/v2/lat/${SAW[0]}/lon/${SAW[1]}/dist/${NM}`,
    `https://api.planes.live/v2/lat/${SAW[0]}/lon/${SAW[1]}/dist/${NM}`,
    // Control: a source we already use, to prove the probe itself works.
    `https://api.adsb.lol/v2/lat/${SAW[0]}/lon/${SAW[1]}/dist/${NM}`,
  ];

  out.discovery = await Promise.all(candidates.map((u) => probe(u, 5000)));

  const winner = out.discovery.find((r) => r.status === 200 && r.count != null);
  if (!winner) {
    res.status(200).json(out);
    return;
  }
  out.winner = winner.url;

  // --- 2. Does it carry what normalise() needs? ----------------------------
  const NEEDED = ['hex', 'flight', 'r', 't', 'desc', 'lat', 'lon',
                  'alt_baro', 'alt_geom', 'gs', 'track', 'geom_rate', 'baro_rate',
                  'true_heading', 'mag_heading'];
  const s = winner.sample || {};
  out.fields = Object.fromEntries(NEEDED.map((k) => [k, k in s ? typeof s[k] : 'MISSING']));

  // --- 3. Burst: six back-to-back circles, no spacing ----------------------
  // adsb.lol/adsb.fi answer exactly this with 429 on half of them.
  const CIRCLES = [[39.5, 32], [41.5, 22], [47, 14], [36, 10], [33, 35], [40, 48]];
  out.burst = [];
  for (const [lat, lon] of CIRCLES) {
    const r = await probe(winner.url.replace(/[\d.]+\/[\d.-]+\/\d+$/, `${lat}/${lon}/${NM}`), 6000);
    out.burst.push({ circle: [lat, lon], status: r.status ?? r.error, ms: r.ms, count: r.count });
  }

  // --- 4. Same circle, both sources: how does coverage compare? ------------
  const mine = await probe(`https://api.adsb.lol/v2/lat/${SAW[0]}/lon/${SAW[1]}/dist/${NM}`, 6000);
  const pgt = (list) => (list || []).filter(
    (a) => String(a.flight || '').trim().toUpperCase().startsWith('PGT')
  ).map((a) => String(a.flight).trim());

  const theirsFull = await probe(winner.url, 6000);
  out.coverage = {
    'airplanes.live': { status: theirsFull.status, total: theirsFull.count,
      pgt: pgt(theirsFull.sample ? undefined : null) },
  };
  // Re-fetch properly for the aircraft lists (probe() only keeps one sample).
  for (const [name, url] of [
    ['airplanes.live', winner.url],
    ['adsb.lol', `https://api.adsb.lol/v2/lat/${SAW[0]}/lon/${SAW[1]}/dist/${NM}`],
  ]) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(6000),
        headers: { 'user-agent': UA, accept: 'application/json' } });
      const j = await r.json();
      const list = j.ac || j.aircraft || [];
      out.coverage[name] = { status: r.status, total: list.length, pgt: pgt(list).sort() };
    } catch (err) {
      out.coverage[name] = { error: String(err?.name || err) };
    }
  }
  out.adsbLolStatus = mine.status;

  res.status(200).json(out);
}
