// Server-side fallback for the OpenSky call.
//
// The browser talks to OpenSky directly in the normal case, so each visitor
// spends their own IP's anonymous credit budget. This endpoint only comes
// into play when that direct call fails (CORS, throttling) — see
// src/opensky.js. Because every visitor then shares this one egress IP, the
// response is cached at the edge so the upstream call rate stays flat no
// matter how many people are watching.
//
// Optional: set OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET in the Vercel
// project to use OpenSky's OAuth2 client-credentials flow, which carries a
// much larger quota. They stay server-side and are never shipped to the
// browser.

const STATES_URL = 'https://opensky-network.org/api/states/all';
const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

const BBOX_KEYS = ['lamin', 'lomin', 'lamax', 'lomax'];
const CACHE_SECONDS = 20;

let cachedToken = null; // { value, expiresAt }

async function getAccessToken() {
  const id = process.env.OPENSKY_CLIENT_ID;
  const secret = process.env.OPENSKY_CLIENT_SECRET;
  if (!id || !secret) return null;

  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value;
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: id,
      client_secret: secret,
    }),
  });
  if (!res.ok) {
    // Fall back to anonymous rather than failing the whole request.
    console.error('OpenSky token request failed:', res.status);
    return null;
  }

  const body = await res.json();
  cachedToken = {
    value: body.access_token,
    // Renew a minute early so we never race the expiry.
    expiresAt: Date.now() + Math.max(0, (body.expires_in ?? 300) - 60) * 1000,
  };
  return cachedToken.value;
}

export default async function handler(req, res) {
  // Only forward the bounding-box params, and only as numbers, so this
  // cannot be used to proxy arbitrary queries.
  const params = new URLSearchParams();
  for (const key of BBOX_KEYS) {
    const raw = req.query?.[key];
    const value = Number(Array.isArray(raw) ? raw[0] : raw);
    if (Number.isFinite(value)) params.set(key, String(value));
  }

  const url = params.size ? `${STATES_URL}?${params}` : STATES_URL;

  try {
    const token = await getAccessToken();
    const upstream = await fetch(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

    if (!upstream.ok) {
      res.status(upstream.status === 429 ? 429 : 502).json({
        error: `OpenSky upstream returned ${upstream.status}`,
      });
      return;
    }

    const data = await upstream.json();
    res.setHeader(
      'cache-control',
      `s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 3}`
    );
    res.status(200).json(data);
  } catch (err) {
    console.error('OpenSky proxy failed:', err);
    res.status(502).json({ error: 'OpenSky request failed' });
  }
}
