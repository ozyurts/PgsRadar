// Thin client for our own /api/states endpoint.
//
// All of the work — talking to the ADS-B aggregators, covering the route
// network with overlapping queries, filtering to the tracked callsign prefix
// and converting to SI units — happens server-side. See api/states.js for why
// the browser cannot fetch any of this directly.

const API_URL = '/api/states';

/**
 * Fetch the currently airborne fleet for the given callsign prefix
 * (default: Pegasus's ICAO callsign "PGT").
 */
export async function fetchFleet({ prefix = 'PGT', signal } = {}) {
  const res = await fetch(`${API_URL}?prefix=${encodeURIComponent(prefix)}`, { signal });

  if (!res.ok) {
    throw new Error(
      res.status === 502
        ? 'Veri kaynağına ulaşılamadı'
        : `Veri kaynağı ${res.status} döndü`
    );
  }

  const data = await res.json();
  return data.flights || [];
}
