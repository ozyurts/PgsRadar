// Turns what a passenger types into the callsign the ADS-B feed actually
// carries.
//
// The fleet view never shows IATA flight numbers, and for good reason: the
// upstream databases hand back Pegasus's long-abandoned H9 code, and they
// "convert" lettered callsigns by swapping characters (PGT6AK -> H96AK),
// naming flights that do not exist. See README.md.
//
// Entering one is a different act from being shown one. A passenger holds a
// boarding pass that says PC612 and nothing else; refusing to accept it would
// make the tracker unusable for the only people it is for. So the mapping is
// done here, in one place, and the page says out loud that it was done: the
// tracked identity on screen is always the callsign, with the typed number
// kept as a note beside it rather than presented as fact.
//
// The mapping only holds for purely numeric flights. Roughly half of Pegasus
// flights fly under a lettered callsign (PGT480Q, PGT34VX) which has no IATA
// equivalent at all, so those have to be typed as the callsign itself — which
// is why that form is accepted too.

export const ICAO_PREFIX = 'PGT';
export const IATA_PREFIX = 'PC';

// Callsign bodies seen on the feed: digits, optionally followed by letters.
const BODY = /^\d{1,4}[A-Z]{0,2}$/;

/**
 * @returns {{callsign: string, typed: string, inferred: boolean,
 *            assumedIata: boolean}|null}
 *   `inferred` is true when the callsign was built rather than typed, so the
 *   page can show what it actually searched for. `assumedIata` narrows that
 *   to the case the caveat is about: a numeric flight number read as a
 *   callsign body. null when nothing sensible can be made of the input.
 */
export function parseFlightNumber(raw) {
  // Boarding passes print "PC 612" and people paste "PC-612".
  const text = String(raw ?? '')
    .toUpperCase()
    .replace(/[\s._\-–—]/g, '');
  if (!text) return null;

  // Already a callsign: take it as given, nothing inferred.
  if (text.startsWith(ICAO_PREFIX)) {
    const body = text.slice(ICAO_PREFIX.length);
    return BODY.test(body)
      ? { callsign: ICAO_PREFIX + body, typed: text, inferred: false, assumedIata: false }
      : null;
  }

  // PC612, or the bare number off the boarding pass. H9 is accepted because
  // it is what the route databases still emit, so a link built from one of
  // their answers does not dead-end.
  const body = text.startsWith(IATA_PREFIX) ? text.slice(2)
    : text.startsWith('H9') ? text.slice(2)
    : text;

  if (!BODY.test(body)) return null;

  return {
    callsign: ICAO_PREFIX + body,
    typed: text,
    inferred: true,
    // A bare "480Q" is a callsign body someone left the prefix off, not a
    // flight number — the PC/PGT caveat would be beside the point there.
    assumedIata: /^\d+$/.test(body),
  };
}

/** The boarding-pass form of a callsign, when it has one. */
export function iataNumber(callsign) {
  const body = String(callsign ?? '').toUpperCase().startsWith(ICAO_PREFIX)
    ? callsign.slice(ICAO_PREFIX.length)
    : null;
  return body && /^\d+$/.test(body) ? IATA_PREFIX + body : null;
}
