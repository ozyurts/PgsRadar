// TEMPORARY probe: proves the airport lookup answers in production. Remove.
import { nearestAirport } from '../lib/airports.js';

export default async function handler(req, res) {
  const points = [
    ['SAW apron', 40.8986, 29.3092],
    ['AYT taxiway', 36.8831, 30.8051],
    ['FRA', 50.0267, 8.5583],
    ['Bosphorus', 41.0, 29.0],
  ];
  res.status(200).json(
    points.map(([label, lat, lon]) => ({ label, result: nearestAirport(lat, lon) }))
  );
}
