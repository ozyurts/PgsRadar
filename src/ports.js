// How an airport is written on screen.
//
// Split out of main.js when the tracker page arrived: both pages name the
// same airports, and two copies would drift — the globe saying "Sabiha
// Gökçen" where the tracker said "Istanbul Sabiha Gökçen International".

/** IATA where there is one — it is the code on the boarding pass. */
export function portCode(port) {
  return port?.iata || port?.icao || '?';
}

/**
 * Label an airport the way people actually refer to it. Some names already
 * carry the city ("Istanbul Sabiha Gökçen"); others do not ("Manas"), and on
 * its own that is unrecognisable — it is the airport in Bishkek.
 */
export function portLabel(port) {
  const name = port?.name;
  const city = port?.city;
  if (!name) return city || port?.icao || '—';
  if (!city) return name;

  // "Pendik, Istanbul" — the trailing part is the city people would name.
  const parts = city.split(',').map((p) => p.trim()).filter(Boolean);
  const label = parts[parts.length - 1];
  if (!label) return name;

  const mentioned = parts.some((part) =>
    name.toLocaleLowerCase('tr').includes(part.toLocaleLowerCase('tr'))
  );
  return mentioned ? name : `${label} ${name}`;
}

/** The long form, for a tooltip: everything the shortened label dropped. */
export function portTitle(port) {
  return [port?.name, port?.city, port?.country]
    .filter((part, i, all) => part && all.indexOf(part) === i)
    .join(', ') || port?.icao || '—';
}

/** The airport a grounded aircraft is standing on, as one line. */
export function airportLabel(airport) {
  if (!airport) return 'Havalimanı belirlenemedi';
  const code = airport.iata || airport.icao;
  return `${portLabel(airport)} (${code})`;
}
