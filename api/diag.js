// TEMPORARY diagnostic endpoint — remove once the OpenSky data path is settled.
//
// Targets are hardcoded (no user input reaches fetch) so this cannot be used
// as an open proxy.

import { lookup } from 'node:dns/promises';

const TARGETS = [
  ['control', 'https://example.com'],
  ['opensky-root', 'https://opensky-network.org/'],
  ['opensky-api', 'https://opensky-network.org/api/states/all?lamin=35&lomin=25&lamax=43&lomax=45'],
];

async function probe(name, url) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: { 'user-agent': 'pgsradar-diag' },
    });
    const body = await res.text();
    return {
      name,
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
      cors: res.headers.get('access-control-allow-origin'),
      contentType: res.headers.get('content-type'),
      bodyBytes: body.length,
      bodyHead: body.slice(0, 200),
    };
  } catch (err) {
    return {
      name,
      ms: Date.now() - started,
      error: String(err),
      cause: err?.cause ? String(err.cause) : undefined,
      code: err?.cause?.code ?? err?.code,
    };
  }
}

export default async function handler(req, res) {
  let dns;
  try {
    dns = await lookup('opensky-network.org', { all: true });
  } catch (err) {
    dns = { error: String(err) };
  }

  const probes = [];
  for (const [name, url] of TARGETS) {
    probes.push(await probe(name, url));
  }

  res.setHeader('cache-control', 'no-store');
  res.status(200).json({ region: process.env.VERCEL_REGION, dns, probes });
}
