// TEMPORARY probe: which colours does smartwings.com's own stylesheet use?
// Fixed host, no parameters, returns only colour counts. Delete after reading.

const HOST = 'https://www.smartwings.com';
const UA = 'pgsradar (+https://pgsradar.vercel.app)';

async function get(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { 'user-agent': UA },
  });
  return { status: res.status, text: res.ok ? await res.text() : '' };
}

function colours(text, into) {
  for (const m of text.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)/g)) {
    const key = m[0].toLowerCase();
    into[key] = (into[key] || 0) + 1;
  }
}

export default async function handler(req, res) {
  const out = { pages: [], counts: {} };
  try {
    const home = await get(HOST + '/');
    out.pages.push({ url: '/', status: home.status, bytes: home.text.length });
    colours(home.text, out.counts);

    const sheets = [...home.text.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"/g)]
      .map((m) => new URL(m[1], HOST))
      .filter((u) => u.origin === HOST)
      .slice(0, 6);

    for (const u of sheets) {
      const r = await get(u.href);
      out.pages.push({ url: u.pathname, status: r.status, bytes: r.text.length });
      colours(r.text, out.counts);
    }
  } catch (err) {
    out.error = err.message;
  }
  out.top = Object.entries(out.counts).sort((a, b) => b[1] - a[1]).slice(0, 40);
  delete out.counts;
  res.status(200).json(out);
}
