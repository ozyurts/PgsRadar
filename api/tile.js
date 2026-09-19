// TEMPORARY: compare candidate basemaps before changing the look.
// z6/x37/y24 covers Istanbul and the Aegean — enough area to judge busyness.
const ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services';
const CANDIDATES = [
  ['light-gray (mevcut)', `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/6/24/37`],
  ['imagery (uydu)',      `${ESRI}/World_Imagery/MapServer/tile/6/24/37`],
  ['physical',            `${ESRI}/World_Physical_Map/MapServer/tile/6/24/37`],
  ['shaded-relief',       `${ESRI}/World_Shaded_Relief/MapServer/tile/6/24/37`],
  ['terrain-base',        `${ESRI}/World_Terrain_Base/MapServer/tile/6/24/37`],
  ['natgeo',              `${ESRI}/NatGeo_World_Map/MapServer/tile/6/24/37`],
];

export default async function handler(req, res) {
  const i = Number(req.query?.p ?? 0);
  const [name, url] = CANDIDATES[Number.isInteger(i) && CANDIDATES[i] ? i : 0];
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'user-agent': 'pgsradar (+https://pgsradar.vercel.app)' },
    });
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('cache-control', 'no-store');
    res.status(200).json({
      name, status: r.status, contentType: r.headers.get('content-type'),
      bytes: buf.length, base64: buf.toString('base64'),
    });
  } catch (err) {
    res.status(200).json({ name, error: String(err?.cause ?? err).slice(0, 160) });
  }
}
