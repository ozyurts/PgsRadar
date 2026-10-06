// The airlines the globe can show, and which callsigns belong to each.
//
// Shared by the endpoint and the page: the page needs the keys and names for
// its switch, the endpoint needs the prefixes. One table means the switch can
// never offer an airline the endpoint does not know.
//
// The client asks for an airline by key, never for a list of prefixes. The
// edge cache is keyed on the query string, so every distinct string a browser
// can send is one more full sweep of the upstream providers. A fixed table
// keeps that to one entry per airline. (The older `?prefix=` form still works
// for anyone who bookmarked it; nothing here sends it any more.)
//
// Prefixes were measured on the live feed, not taken from memory (6 October
// 2026, through the deployed /api/states):
//
//   Smartwings flies under three ICAO designators, one per operating
//   certificate — TVS (Czech), TVQ (Slovak), TVP (Polish). All three came
//   back with OK- registrations: same fleet, different paperwork. `TV` alone
//   is NOT Smartwings: the same query returned 35 TVF flights, all F-
//   registered — that is Transavia France. Hence the explicit list. No other
//   TV* designator was on the feed at the time; one that turns up later is
//   added here only after it has been seen with a Smartwings airframe.
//
// `hubCircle` is an index into CIRCLES in api/states.js: the circle over the
// airline's base, which is asked of both providers (see the handler there).
// `extraCircles` are swept only for that airline — see the same file for why
// Smartwings needs them.

export const AIRLINES = {
  pegasus: {
    label: 'Pegasus',
    prefixes: ['PGT'],
    hubCircle: 0,
    extraCircles: [],
  },
  smartwings: {
    label: 'Smartwings',
    prefixes: ['TVS', 'TVQ', 'TVP'],
    // Prague, 186 nm from the centre of [47.0, 14.0].
    hubCircle: 2,
    extraCircles: [
      [52.0, 19.5],   // Poland: Warsaw, Katowice, Gdańsk, Poznań, Wrocław
      [29.5, -15.5],  // Canary Islands and Madeira
      [26.5, 34.0],   // Red Sea: Hurghada, Sharm el-Sheikh, Marsa Alam
      [35.9, 26.0],   // Crete, Rhodes, Kos
      [37.3, -6.0],   // Andalusia and the Algarve: Málaga, Seville, Faro
    ],
  },
};

export const DEFAULT_AIRLINE = 'pegasus';
