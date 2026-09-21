// TEMPORARY probe: read airplanes.live's API documentation from fra1, since
// neither the sandbox nor WebFetch can reach that host. Remove after reading.

const UA = 'pgsradar (+https://pgsradar.vercel.app)';

function strip(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

async function grab(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'user-agent': UA, accept: 'text/html,application/json,*/*' },
    });
    const html = await res.text();
    const text = strip(html);
    return {
      url,
      status: res.status,
      type: res.headers.get('content-type'),
      bytes: html.length,
      textBytes: text.length,
      // A client-rendered page strips down to almost nothing; then the
      // scripts are what has to be read instead.
      scripts: [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]),
      links: [...new Set([...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]))]
        .filter((h) => /api|doc/i.test(h)).slice(0, 40),
      text: text.slice(0, 14000),
    };
  } catch (err) {
    return { url, error: String(err?.name || err) };
  }
}

export default async function handler(req, res) {
  const extra = req.query?.url;
  const targets = extra
    ? [String(Array.isArray(extra) ? extra[0] : extra)]
    : [
        'https://airplanes.live/api-docs/',
        'https://airplanes.live/rest-api/',
      ];

  res.setHeader('cache-control', 'no-store');
  res.status(200).json(await Promise.all(targets.map(grab)));
}
