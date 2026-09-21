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

let grepFor = null;
let offset = 0;

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
      // Stoplight Elements renders an OpenAPI document client-side; the URL of
      // that document is an attribute on its custom element, which strip()
      // throws away. Pull it out of the raw HTML instead.
      elements: [...html.matchAll(/<elements-api[\s\S]{0,600}?>/gi)].map((m) => m[0]),
      specs: [...new Set([
        ...[...html.matchAll(/apiDescriptionUrl=["']([^"']+)["']/gi)].map((m) => m[1]),
        ...[...html.matchAll(/["'`]([^"'`\s]+\.(?:json|yaml|yml))["'`]/gi)].map((m) => m[1]),
      ])].slice(0, 40),
      // ?grep= returns only the matching lines with context, so a long
      // document can be read in slices without redeploying.
      grep: grepFor
        ? text.split('\n').flatMap((line, i, all) =>
            new RegExp(grepFor, 'i').test(line)
              ? [all.slice(Math.max(0, i - 2), i + 3).join(' | ')]
              : []
          ).slice(0, 60)
        : undefined,
      text: grepFor ? undefined : text.slice(offset, offset + 14000),
    };
  } catch (err) {
    return { url, error: String(err?.name || err) };
  }
}

export default async function handler(req, res) {
  const one = (v) => (Array.isArray(v) ? v[0] : v);
  grepFor = one(req.query?.grep) || null;
  offset = Number(one(req.query?.offset)) || 0;

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
