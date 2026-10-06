// Thin client for our own /api/states endpoint.
//
// All of the work — talking to the ADS-B aggregators, covering the route
// network with overlapping queries, filtering to the airline's callsign
// prefixes and converting to SI units — happens server-side. See api/states.js for why
// the browser cannot fetch any of this directly.

import { DEFAULT_AIRLINE } from '../lib/airlines.js';

const API_URL = '/api/states';

/**
 * Fetch one airline's fleet, by its key in lib/airlines.js.
 *
 * By key and never by prefix list: every distinct query string is its own
 * edge cache entry and its own sweep of the upstream providers, so the page
 * must only ever be able to ask the handful of questions the table defines.
 *
 * Returns `degraded` alongside the flights. The endpoint answers 200 even
 * when some of its region queries failed, because a partial answer beats no
 * answer — but the caller has to be told, or a short list reads as a complete
 * one.
 */
export async function fetchFleet({ airline = DEFAULT_AIRLINE, signal } = {}) {
  const res = await fetch(`${API_URL}?airline=${encodeURIComponent(airline)}`, { signal });

  if (!res.ok) {
    throw new Error(
      res.status === 502
        ? 'Veri kaynağına ulaşılamadı'
        : `Veri kaynağı ${res.status} döndü`
    );
  }

  const data = await res.json();
  return { flights: data.flights || [], degraded: Boolean(data.degraded) };
}

/**
 * Look up the departure/arrival pair for a callsign. Resolves to null when the
 * two upstream databases disagree or neither knows it — see api/route.js for
 * why a disputed route is withheld rather than guessed at.
 */
export async function fetchRoute(callsign, { signal } = {}) {
  const res = await fetch(`/api/route?callsign=${encodeURIComponent(callsign)}`, {
    signal,
  });
  if (!res.ok) return { status: 'unknown' };
  return res.json();
}
