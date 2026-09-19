// TEMPORARY: fetch one candidate basemap tile so it can be eyeballed for
// watermarks. Hardcoded URLs; ?p= only picks an index. Remove after choosing.

// z6/x37/y24 — the tile covering Istanbul, so the result is easy to recognise.
const CANDIDATES = [
  ['carto-light', 'https://a.basemaps.cartocdn.com/light_all/6/37/24.png'],
  ['esri-light-gray', 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/6/24/37'],
  ['osm', 'https://tile.openstreetmap.org/6/37/24.png'],
  ['esri-topo', 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/6/24/37'],
];

export default async function handler(req, res) {
  const i = Number(req.query?.p ?? 0);
  const [name, url] = CANDIDATES[Number.isInteger(i) && CANDIDATES[i] ? i : 0];

  try {
    const upstream = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'user-agent': 'pgsradar (+https://pgsradar.vercel.app)' },
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('cache-control', 'no-store');
    res.status(200).json({
      name,
      url,
      status: upstream.status,
      contentType: upstream.headers.get('content-type'),
      bytes: buf.length,
      base64: buf.toString('base64'),
    });
  } catch (err) {
    res.status(200).json({ name, url, error: String(err?.cause ?? err) });
  }
}
