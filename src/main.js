import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';
import { fetchFleet, fetchRoute } from './flights.js';
import { portCode, portLabel, portTitle, airportLabel } from './ports.js';
import { parseFlightNumber } from './callsign.js';

// No Cesium ion account required: we skip ion imagery/terrain entirely
// and use a free, token-less basemap + a flat ellipsoid terrain model.
Cesium.Ion.defaultAccessToken = undefined;

// `||` here is deliberate: a blank env var falls back to the default.
const CALLSIGN_PREFIX = import.meta.env.VITE_CALLSIGN_PREFIX?.trim() || 'PGT';
const POLL_INTERVAL_MS = Number(import.meta.env.VITE_POLL_INTERVAL_MS) || 30000;

// ---------- Viewer ----------
const viewer = new Cesium.Viewer('cesiumContainer', {
  baseLayer: false,
  terrainProvider: new Cesium.EllipsoidTerrainProvider(),
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  animation: false,
  timeline: false,
  fullscreenButton: false,
  selectionIndicator: false,
  infoBox: false,
  shouldAnimate: true,
});

// Esri basemaps, none of which need an API key. (CARTO's key-less tiles were
// used here first, but they now come back stamped "API KEY REQUIRED".)
//
// Esri splits these into a base and a reference layer carrying the labels, so
// each option lists both. Note the {z}/{y}/{x} order — Esri addresses tiles by
// row then column, not the usual x/y. The maximum level differs per service:
// shaded relief stops at 13, imagery goes far deeper.
const ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services';
const ESRI_CREDIT = 'Esri, HERE, Garmin, © OpenStreetMap contributors';

const BASEMAPS = {
  sade: {
    label: 'Sade',
    layers: [
      ['Canvas/World_Light_Gray_Base', 16],
      ['Canvas/World_Light_Gray_Reference', 16],
    ],
    globe: '#eef0f3',
    space: '#dfe3e8',
  },
  relief: {
    label: 'Rölyef',
    layers: [
      ['World_Shaded_Relief', 13],
      ['Canvas/World_Light_Gray_Reference', 16],
    ],
    globe: '#e7e3dc',
    space: '#dfe3e8',
  },
  uydu: {
    label: 'Uydu',
    layers: [
      ['World_Imagery', 19],
      ['Reference/World_Boundaries_and_Places', 19],
    ],
    globe: '#0d1b2a',
    space: '#070d14',
  },
};

const BASEMAP_STORAGE_KEY = 'pgsradar.basemap';
// Shaded relief by default: it gives the globe terrain to sit on without the
// label clutter of a full geographic map, which is what makes an aircraft at
// altitude read as being above somewhere rather than over a blank sheet.
const DEFAULT_BASEMAP = 'relief';

function applyBasemap(key, { persist = true } = {}) {
  const map = BASEMAPS[key] ? key : DEFAULT_BASEMAP;
  const config = BASEMAPS[map];

  viewer.imageryLayers.removeAll();
  for (const [path, maximumLevel] of config.layers) {
    viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: `${ESRI}/${path}/MapServer/tile/{z}/{y}/{x}`,
        credit: ESRI_CREDIT,
        maximumLevel,
      })
    );
  }

  // The globe colour shows through until tiles land, and behind the globe.
  // Leaving it light under the satellite basemap makes the planet flash white
  // on every pan.
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(config.globe);
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString(config.space);
  document.body.dataset.basemap = map;

  if (!persist) return;
  try {
    localStorage.setItem(BASEMAP_STORAGE_KEY, map);
  } catch {
    // Private browsing refuses writes; the choice just will not persist.
  }
}

// ---------- Borrowed basemap ----------
// Looking at an aircraft on an apron over the plain canvas basemap shows a
// shape on an empty grey field: that basemap has no detail past zoom 16 and
// draws no taxiways at all. So selecting a ground aircraft borrows the
// satellite imagery for as long as it stays selected, and hands the chosen
// basemap back afterwards. The borrowed one is never written to storage — it
// is not a choice the visitor made.
let borrowedFrom = null;

function borrowSatellite() {
  if (document.body.dataset.basemap === 'uydu') return;
  borrowedFrom = document.body.dataset.basemap;
  applyBasemap('uydu', { persist: false });
  syncBasemapSwitch();
}

function returnBasemap() {
  if (!borrowedFrom) return;
  applyBasemap(borrowedFrom, { persist: false });
  borrowedFrom = null;
  syncBasemapSwitch();
}

let storedBasemap = null;
try {
  storedBasemap = localStorage.getItem(BASEMAP_STORAGE_KEY);
} catch {}

let syncBasemapSwitch = () => {};

function buildBasemapSwitch() {
  const host = document.getElementById('basemapSwitch');
  if (!host) return;

  const buttons = Object.entries(BASEMAPS).map(([key, config]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = config.label;
    button.addEventListener('click', () => {
      // Picking a basemap by hand ends the loan: the visitor's choice wins,
      // and the old one must not come back when the selection is cleared.
      borrowedFrom = null;
      applyBasemap(key);
      syncBasemapSwitch();
    });
    host.append(button);
    return [key, button];
  });

  syncBasemapSwitch = () => {
    const active = document.body.dataset.basemap;
    for (const [key, button] of buttons) {
      button.setAttribute('aria-pressed', String(key === active));
    }
  };

  syncBasemapSwitch();
}

applyBasemap(storedBasemap || DEFAULT_BASEMAP);
buildBasemapSwitch();

viewer.scene.globe.enableLighting = false;
viewer.scene.globe.showGroundAtmosphere = false;
viewer.scene.skyAtmosphere.show = false;
viewer.scene.skyBox.show = false;
viewer.scene.sun.show = false;
viewer.scene.moon.show = false;
viewer.scene.fog.enabled = false;
// Without this the globe never hides anything, so aircraft on the far side of
// the planet draw straight through it and the scene reads as a flat sticker
// sheet rather than a sphere with things flying above it.
viewer.scene.globe.depthTestAgainstTerrain = true;
// 200km was the old floor, which put the camera so far out that 11km of
// altitude was ~4% of the frame — height could never read. 20km made the
// altitude legs legible; ground traffic then needed closer still, since at
// 20km an entire apron of parked aircraft is a few dozen pixels wide, and
// seeing which stand one is on means getting down among the taxiways.
viewer.scene.screenSpaceCameraController.minimumZoomDistance = 350;
viewer.scene.screenSpaceCameraController.maximumZoomDistance = 25000000;

viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(28, 36, 5000000),
});

// ---------- Aircraft icon ----------
function buildPlaneIcon({ fill, outline } = { fill: '#ff6a13' }) {
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.translate(size / 2, size / 2);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(0, -16);
  ctx.lineTo(5, -4);
  ctx.lineTo(18, 3);
  ctx.lineTo(18, 8);
  ctx.lineTo(5, 4);
  ctx.lineTo(4, 15);
  ctx.lineTo(9, 19);
  ctx.lineTo(9, 23);
  ctx.lineTo(0, 20);
  ctx.lineTo(-9, 23);
  ctx.lineTo(-9, 19);
  ctx.lineTo(-4, 15);
  ctx.lineTo(-5, 4);
  ctx.lineTo(-18, 8);
  ctx.lineTo(-18, 3);
  ctx.lineTo(-5, -4);
  ctx.closePath();
  ctx.fill();
  if (outline) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  return canvas.toDataURL('image/png');
}
const PLANE_ICON = buildPlaneIcon({ fill: '#ff6a13' });
// Ground traffic is a backdrop, not the subject, so it gives up the accent
// colour. The pale outline is what keeps a grey shape legible over dark
// satellite imagery as well as over the light canvas basemap.
const PLANE_ICON_GROUND = buildPlaneIcon({
  fill: '#6b7684',
  outline: 'rgba(255, 255, 255, 0.85)',
});

// ---------- State ----------
const entities = new Map(); // icao24 -> { kind, plane, parts }
const fleet = new Map();    // icao24 -> { flight, receivedAt, history }
let flights = [];
let activeIcao = null;

// ---------- Air / ground mode ----------
// "What is flying" and "what is on the ground" are two different questions,
// and mixing their answers served neither: the parked aircraft pushed the
// flights off the screen, and the flights buried the single taxiing one. So
// the list shows one group at a time, and the map follows it — what is listed
// is what is drawn, with no third state where the two disagree.
//
// The mode is deliberately not remembered between visits, unlike the basemap.
// The basemap is a taste and stays yours; this is a lens you reach for and put
// down — having looked at a stand once should not mean the site opens on the
// apron a day later, with the flights missing and no obvious reason why.
// Every visit starts on the flights.
let listMode = 'air';
try {
  // Left behind by the version that did remember it.
  localStorage.removeItem('pgsradar.list');
} catch {
  // Private browsing refuses writes; the stale key is harmless either way.
}

function visibleFlights() {
  const wantGround = listMode === 'ground';
  return flights.filter((f) => Boolean(f.onGround) === wantGround);
}

// ---------- Dead reckoning ----------
// The feed refreshes every POLL_INTERVAL_MS. Snapping icons to each new fix
// makes aircraft teleport; between fixes we advance them along their own
// track and vertical rate instead, so they actually fly.
const EARTH_RADIUS_M = 6371000;
// If a fix stops being refreshed, stop extrapolating rather than let the
// aircraft sail off on a heading it may have long since left.
const MAX_COAST_S = 120;

/** Move a point `distanceM` along a great circle leaving on `headingDeg`. */
function advance(latDeg, lonDeg, headingDeg, distanceM) {
  const angular = distanceM / EARTH_RADIUS_M;
  const bearing = Cesium.Math.toRadians(headingDeg);
  const lat1 = Cesium.Math.toRadians(latDeg);
  const lon1 = Cesium.Math.toRadians(lonDeg);
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinAng = Math.sin(angular);
  const cosAng = Math.cos(angular);

  const lat2 = Math.asin(sinLat1 * cosAng + cosLat1 * sinAng * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * sinAng * cosLat1,
    cosAng - sinLat1 * Math.sin(lat2)
  );

  return { lat: Cesium.Math.toDegrees(lat2), lon: Cesium.Math.toDegrees(lon2) };
}

function project(icao24) {
  const rec = fleet.get(icao24);
  if (!rec) return undefined;

  const f = rec.flight;

  // Dead reckoning assumes the aircraft keeps going the way it is pointed.
  // That holds in the air and fails on the ground, where it follows taxiways
  // and turns constantly: extrapolated, a taxiing aircraft walks onto the
  // grass within a minute. The last reported fix is the honest answer.
  if (f.onGround) return { lon: f.lon, lat: f.lat, alt: 0 };

  const dt = Math.min((Date.now() - rec.receivedAt) / 1000, MAX_COAST_S);
  const { lat, lon } = advance(f.lat, f.lon, f.heading, f.speedMs * dt);

  return {
    lon,
    lat,
    alt: Math.max(0, f.altitudeM + f.verticalRateMs * dt),
  };
}

// ---------- Track ----------
// The trail is built from the fixes the feed actually reported, not from the
// dead-reckoned estimate, so it stays an honest record of where the aircraft
// has been. Only its head — the segment joining the last fix to the position
// on screen right now — is extrapolated.
const TRAIL_MAX_POINTS = 40;
const TRAIL_MAX_AGE_MS = 25 * 60 * 1000;

// How far ahead the selected aircraft's course is projected. ADS-B carries no
// flight plan, so this is what its present track leads to, not a filed route.
const COURSE_SECONDS = 900;
const COURSE_STEPS = 24;
const COURSE_MIN_SPEED_MS = 25;

function trailPositions(icao24) {
  const rec = icao24 && fleet.get(icao24);
  if (!rec || rec.flight.onGround) return undefined;

  const points = rec.history.map((h) =>
    Cesium.Cartesian3.fromDegrees(h.lon, h.lat, h.alt)
  );
  const head = airPosition(icao24);
  if (head) points.push(head);

  return points.length >= 2 ? points : undefined;
}

// The confirmed route for the selected flight, when there is one. The course
// line aims at the destination rather than at wherever the nose currently
// points, which is what anyone reads the line as meaning anyway.
let activeRoute = null;

function coursePositions(icao24) {
  const rec = icao24 && fleet.get(icao24);
  if (!rec) return undefined;

  const f = rec.flight;
  if (f.onGround || f.speedMs < COURSE_MIN_SPEED_MS) return undefined;

  const from = project(icao24);
  if (!from) return undefined;

  const destination =
    activeRoute?.status === 'confirmed' ? activeRoute.destination : null;

  if (destination?.lat != null && destination?.lon != null) {
    // Great circle all the way to the airport: at close zoom it leaves the
    // frame pointing the right way, and zoomed out it lands on the field.
    const geodesic = new Cesium.EllipsoidGeodesic(
      Cesium.Cartographic.fromDegrees(from.lon, from.lat),
      Cesium.Cartographic.fromDegrees(destination.lon, destination.lat)
    );

    const points = [];
    for (let i = 0; i <= COURSE_STEPS; i++) {
      const fraction = i / COURSE_STEPS;
      const at = geodesic.interpolateUsingFraction(fraction);
      // Eased down to the ground so the line meets the airport marker instead
      // of floating over it. Both ends are known — the aircraft's altitude is
      // measured, the airport is at ground — and the path between them was
      // already an approximation, so interpolating height adds no new claim.
      // At these distances the slope is invisible except near the airport.
      points.push(
        Cesium.Cartesian3.fromRadians(
          at.longitude,
          at.latitude,
          from.alt * (1 - fraction)
        )
      );
    }
    return points;
  }

  // No agreed destination — fall back to projecting the current track, so a
  // flight whose route the databases dispute still shows where it is headed.
  const points = [];
  for (let i = 0; i <= COURSE_STEPS; i++) {
    const distance = f.speedMs * COURSE_SECONDS * (i / COURSE_STEPS);
    const { lat, lon } = advance(from.lat, from.lon, f.heading, distance);
    points.push(Cesium.Cartesian3.fromDegrees(lon, lat, from.alt));
  }
  return points;
}

function airPosition(icao24) {
  const p = project(icao24);
  return p && Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt);
}

function groundPosition(icao24) {
  const p = project(icao24);
  return p && Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0);
}

const els = {
  list: document.getElementById('flightList'),
  count: document.getElementById('flightCount'),
  updated: document.getElementById('updatedText'),
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  detail: document.getElementById('detailCard'),
  dCallsign: document.getElementById('dCallsign'),
  dOrigin: document.getElementById('dOrigin'),
  dAlt: document.getElementById('dAlt'),
  dSpeed: document.getElementById('dSpeed'),
  dHeading: document.getElementById('dHeading'),
  dPos: document.getElementById('dPos'),
  closeDetail: document.getElementById('closeDetail'),
  dRoute: document.getElementById('dRoute'),
  statusPill: document.getElementById('statusPill'),
  panel: document.getElementById('panel'),
  scrim: document.getElementById('scrim'),
  modeSwitch: document.getElementById('modeSwitch'),
};

const modeButtons = [...(els.modeSwitch?.querySelectorAll('button') ?? [])];

function syncModeSwitch() {
  for (const button of modeButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === listMode));
  }
}

function setListMode(mode) {
  if (mode !== 'air' && mode !== 'ground') return;
  listMode = mode;
  syncModeSwitch();
  updateEntities();
  renderList();
  dropSelectionIfHidden();
}

for (const button of modeButtons) {
  button.addEventListener('click', () => setListMode(button.dataset.mode));
}
syncModeSwitch();

// ---------- Flight list sheet (phones) ----------
// On a narrow screen the list is a sheet rather than a fixed column. Desktop
// CSS ignores the class, so the same handlers are harmless there.
function setPanelOpen(open) {
  document.body.classList.toggle('panel-open', open);
  els.statusPill?.setAttribute('aria-expanded', String(open));
}

els.statusPill?.addEventListener('click', () => {
  setPanelOpen(!document.body.classList.contains('panel-open'));
});
els.scrim?.addEventListener('click', () => setPanelOpen(false));

function clearSelection() {
  returnBasemap();
  activeIcao = null;
  activeRoute = null;
  routeRequest?.abort();
  clearDestination();
  els.dRoute.hidden = true;
  els.detail.classList.remove('visible');
  renderList();
}

/** Switching the ground layer off can take the selected aircraft with it. */
function dropSelectionIfHidden() {
  if (activeIcao && !visibleFlights().some((f) => f.icao24 === activeIcao)) {
    clearSelection();
  }
}

els.closeDetail.addEventListener('click', clearSelection);

function setStatus(state, text) {
  els.statusDot.className = 'status-dot' + (state ? ' ' + state : '');
  els.statusText.textContent = text;
}

function fmtTime(d = new Date()) {
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const ACCENT = Cesium.Color.fromCssColorString('#ff6a13');

// One size for both layers. Ground traffic used to be drawn smaller, back
// when it shared the map with the flights and had to stay out of their way;
// now that only one group is shown at a time there is nothing to defer to,
// and the difference only read as the aircraft being a lesser thing.
const ICON_SIZE = 26;
// Nearer aircraft sit larger in frame, which is most of what sells depth once
// the camera is tilted. A fresh instance per billboard: nothing should be
// able to change one layer's scaling by touching the other's.
const iconScale = () => new Cesium.NearFarScalar(3.0e5, 1.3, 1.2e7, 0.6);

function createAirEntities(icao24) {
  // Positions are callbacks rather than fixed values so every frame re-reads
  // the dead-reckoned estimate and the aircraft glides instead of stepping.
  const plane = viewer.entities.add({
    id: icao24,
    position: new Cesium.CallbackProperty(() => airPosition(icao24), false),
    billboard: {
      image: PLANE_ICON,
      width: ICON_SIZE,
      height: ICON_SIZE,
      rotation: 0,
      alignedAxis: Cesium.Cartesian3.UNIT_Z,
      scaleByDistance: iconScale(),
    },
  });

  // The altitude leg: a dashed line straight down to the surface. This is the
  // cue that actually says "this thing is up in the air" — the aircraft's own
  // position cannot convey height on its own.
  const leg = viewer.entities.add({
    polyline: {
      positions: new Cesium.CallbackProperty(() => {
        const air = airPosition(icao24);
        const ground = groundPosition(icao24);
        return air && ground ? [air, ground] : undefined;
      }, false),
      width: 1,
      material: new Cesium.PolylineDashMaterialProperty({
        color: ACCENT.withAlpha(0.45),
        dashLength: 8,
      }),
    },
  });

  // Where it has been. Kept faint: with thirty aircraft up, bright trails
  // turn the map into spaghetti — the selected one gets highlighted instead.
  const trail = viewer.entities.add({
    polyline: {
      positions: new Cesium.CallbackProperty(() => trailPositions(icao24), false),
      width: 1.5,
      material: ACCENT.withAlpha(0.22),
    },
  });

  // Where the aircraft sits over the map, so the leg has a visible foot.
  const shadow = viewer.entities.add({
    position: new Cesium.CallbackProperty(() => groundPosition(icao24), false),
    point: {
      pixelSize: 4,
      // Accent rather than grey: this dot has to read against a pale canvas
      // and against dark satellite imagery alike.
      color: ACCENT.withAlpha(0.5),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
  });

  return { kind: 'air', plane, parts: [plane, leg, trail, shadow] };
}

/**
 * A parked or taxiing aircraft: the shape and its heading, nothing else. No
 * altitude leg (there is no altitude), no shadow (it is its own shadow) and
 * no trail — a stand keeps reporting the same fix, so a trail would just be a
 * dot drawn over itself.
 */
function createGroundEntity(icao24) {
  const plane = viewer.entities.add({
    id: icao24,
    position: new Cesium.CallbackProperty(() => groundPosition(icao24), false),
    billboard: {
      image: PLANE_ICON_GROUND,
      width: ICON_SIZE,
      height: ICON_SIZE,
      rotation: 0,
      alignedAxis: Cesium.Cartesian3.UNIT_Z,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      scaleByDistance: iconScale(),
    },
  });

  return { kind: 'ground', plane, parts: [plane] };
}

function removeGroup(group) {
  for (const part of group.parts) viewer.entities.remove(part);
}

// ---------- Selection layer ----------
// One set of entities that follows whichever aircraft is selected, rather
// than a highlight pair per aircraft that would sit unused on all but one.
const selectedTrail = viewer.entities.add({
  polyline: {
    positions: new Cesium.CallbackProperty(() => trailPositions(activeIcao), false),
    width: 2.5,
    material: ACCENT.withAlpha(0.9),
  },
});

const selectedCourse = viewer.entities.add({
  polyline: {
    positions: new Cesium.CallbackProperty(() => coursePositions(activeIcao), false),
    width: 1.5,
    material: new Cesium.PolylineDashMaterialProperty({
      color: ACCENT.withAlpha(0.65),
      dashLength: 12,
    }),
  },
});

// A ring around the selected aircraft: a transparent point with an outline.
const selectedHalo = viewer.entities.add({
  position: new Cesium.CallbackProperty(
    () => (activeIcao ? airPosition(activeIcao) : undefined),
    false
  ),
  point: {
    pixelSize: 30,
    color: Cesium.Color.TRANSPARENT,
    outlineColor: ACCENT.withAlpha(0.8),
    outlineWidth: 2,
    // A ring around an aircraft sitting at zero altitude is half-buried in
    // the globe, which left the selected ground aircraft wearing an arc.
    // Ignoring depth within 5000km covers everything the camera can be
    // looking at, while an aircraft on the far side of the planet — always
    // further than that — still gets hidden by it.
    disableDepthTestDistance: 5.0e6,
    show: new Cesium.CallbackProperty(
      () => Boolean(activeIcao && fleet.has(activeIcao)),
      false
    ),
  },
});

function updateEntities() {
  const seen = new Set();

  const now = Date.now();

  visibleFlights().forEach((f) => {
    seen.add(f.icao24);

    const previous = fleet.get(f.icao24);
    const history = previous ? previous.history : [];
    // A stand reports the same position every poll, so recording it would
    // fill the trail with forty identical points and leave nothing of the
    // flight that got there once it takes off again.
    if (!f.onGround) {
      history.push({ lon: f.lon, lat: f.lat, alt: f.altitudeM, t: now });
      while (
        history.length > TRAIL_MAX_POINTS ||
        (history.length > 1 && now - history[0].t > TRAIL_MAX_AGE_MS)
      ) {
        history.shift();
      }
    }
    fleet.set(f.icao24, { flight: f, receivedAt: now, history });

    const kind = f.onGround ? 'ground' : 'air';
    let group = entities.get(f.icao24);
    // A landing or a departure changes which layer the aircraft belongs to,
    // and the two are built from different entities, so it is rebuilt rather
    // than restyled.
    if (group && group.kind !== kind) {
      removeGroup(group);
      entities.delete(f.icao24);
      group = null;
    }
    if (!group) {
      group = kind === 'ground' ? createGroundEntity(f.icao24) : createAirEntities(f.icao24);
      entities.set(f.icao24, group);
    }
    group.plane.billboard.rotation = Cesium.Math.toRadians(-f.heading);
  });

  // Remove aircraft that dropped out of the feed — or out of a layer that has
  // just been switched off.
  for (const [icao, group] of entities) {
    if (!seen.has(icao)) {
      removeGroup(group);
      entities.delete(icao);
      fleet.delete(icao);
    }
  }
}

function renderList() {
  const rows = visibleFlights();
  els.count.textContent = rows.length;

  if (rows.length === 0) {
    els.list.replaceChildren(Object.assign(document.createElement('div'), {
      className: 'empty-state',
      textContent:
        listMode === 'ground'
          ? `Şu anda yerde ${CALLSIGN_PREFIX} çağrı işaretli uçak görünmüyor. Park eden uçaklar çoğunlukla transponder'ını kapatır.`
          : `Şu anda havada ${CALLSIGN_PREFIX} çağrı işaretli uçuş görünmüyor, ya da veri henüz gelmedi.`,
    }));
    return;
  }

  els.list.replaceChildren();
  rows
    .slice()
    .sort((a, b) => a.callsign.localeCompare(b.callsign))
    .forEach((f) => {
      const row = document.createElement('div');
      row.className =
        'flight-row' +
        (f.icao24 === activeIcao ? ' active' : '') +
        (f.onGround ? ' ground' : '');
      row.dataset.callsign = f.callsign;

      // Built with textContent rather than innerHTML: callsign and country come
      // straight from a third-party feed and must not be parsed as markup.
      const dot = document.createElement('span');
      dot.className = 'dot';

      const info = document.createElement('div');
      info.className = 'info';
      const cs = document.createElement('div');
      cs.className = 'cs';
      cs.textContent = f.callsign;
      const origin = document.createElement('div');
      origin.className = 'origin';
      origin.textContent = rowSubtitle(f);
      if (f.onGround && f.airport) origin.title = portTitle(f.airport);
      info.append(cs, origin);

      // Asked for once per callsign, then read from the cache on every
      // re-render — including the one every poll triggers.
      if (!f.onGround) queueRoute(f.callsign);

      const metrics = document.createElement('div');
      metrics.className = 'metrics';
      metrics.append(
        f.onGround ? 'YERDE' : 'FL' + Math.round((f.altitudeM * 3.281) / 100),
        document.createElement('br'),
        Math.round(f.speedMs * 1.944) + ' kt'
      );

      row.append(dot, info, metrics);
      row.addEventListener('click', () => {
        selectFlight(f.icao24, true);
        // The point of picking one is to look at it, so get the sheet out of
        // the way instead of leaving it covering the globe.
        setPanelOpen(false);
      });
      els.list.appendChild(row);
    });
}

// Route lookups are per selection and can outlive it. Keeping the request
// that is in flight lets a late answer for a deselected aircraft be dropped
// rather than written into the card of whatever is selected by then.
let routeRequest = null;

// ---------- Route prefetch ----------
// The list wants a route for every flight, not just the selected one, which
// turns one lookup into twenty-odd. Three things keep that affordable:
// answers are remembered for the life of the page, only a few requests are
// allowed out at a time, and the endpoint is cached at the edge for six hours
// per callsign — so the first visitor after a flight departs pays for it and
// everyone after reads it from the CDN.
//
// A callsign's answer does not change mid-flight: a conflict or an unknown is
// a property of the two databases, not of the moment. So they are cached the
// same as a confirmed route, and no row is asked for twice.
const routeCache = new Map();
const routePending = new Map();
const routeQueue = [];
const ROUTE_CONCURRENCY = 4;
let routeWorkers = 0;

function fetchRouteOnce(callsign) {
  if (routeCache.has(callsign)) return Promise.resolve(routeCache.get(callsign));
  if (routePending.has(callsign)) return routePending.get(callsign);

  const request = fetchRoute(callsign)
    .then((result) => {
      routeCache.set(callsign, result);
      return result;
    })
    .finally(() => routePending.delete(callsign));

  routePending.set(callsign, request);
  return request;
}

function pumpRoutes() {
  while (routeWorkers < ROUTE_CONCURRENCY && routeQueue.length) {
    const callsign = routeQueue.shift();
    routeWorkers++;
    fetchRouteOnce(callsign)
      .then(() => applyRouteToRows(callsign))
      // A failed lookup leaves the row on its registration, which is what it
      // showed before the answer was asked for. Nothing to report.
      .catch(() => {})
      .finally(() => {
        routeWorkers--;
        pumpRoutes();
      });
  }
}

function queueRoute(callsign) {
  if (routeCache.has(callsign) || routePending.has(callsign)) return;
  if (routeQueue.includes(callsign)) return;
  routeQueue.push(callsign);
  pumpRoutes();
}

/** Patch the rows for one callsign in place — re-rendering the whole list on
 *  each of twenty answers would flicker and fight the scroll position. */
function applyRouteToRows(callsign) {
  const flight = flights.find((f) => f.callsign === callsign);
  if (!flight) return;

  for (const row of els.list.querySelectorAll(
    `[data-callsign="${CSS.escape(callsign)}"]`
  )) {
    const subtitle = row.querySelector('.origin');
    if (subtitle) subtitle.textContent = rowSubtitle(flight);
  }
}

/**
 * The second line of a list row. One line, always: an airborne aircraft adds
 * its route once that is known and keeps the registration alone until then,
 * so rows never change height and a flight whose route the databases dispute
 * does not leave a hole where the others have text.
 *
 * Codes rather than names here. "Sabiha Gökçen → Esenboğa" is better reading
 * but it does not fit a phone-width row, and a column of ellipsised names is
 * exactly the mess this is meant to avoid. The card still spells them out.
 */
function rowSubtitle(f) {
  if (f.onGround) {
    return [f.registration, f.airport ? airportLabel(f.airport) : null]
      .filter(Boolean)
      .join(' · ');
  }

  const route = routeCache.get(f.callsign);
  const pair =
    route?.status === 'confirmed'
      ? `${portCode(route.origin)} → ${portCode(route.destination)}`
      : null;

  return [f.registration, pair].filter(Boolean).join(' · ');
}

// ---------- Destination marker ----------
// Only the destination is marked, and only for the selected flight. The
// origin is behind the aircraft and adds nothing to "where is this going";
// the course line already runs to this point, so the marker is its endpoint.
// At close zoom it sits off screen, which is fine — it is what you find when
// you zoom out or pan along the line.
const AIRPORT_COLOR = Cesium.Color.fromCssColorString('#3b4a5a');
let destinationEntity = null;

function clearDestination() {
  if (destinationEntity) viewer.entities.remove(destinationEntity);
  destinationEntity = null;
}

function showDestination(result) {
  clearDestination();

  const port = result?.status === 'confirmed' ? result.destination : null;
  if (port?.lat == null || port?.lon == null) return;

  destinationEntity = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(port.lon, port.lat, 0),
    point: {
      pixelSize: 8,
      color: Cesium.Color.WHITE,
      outlineColor: AIRPORT_COLOR,
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
    label: {
      text: port.iata || port.icao,
      font: '600 12px -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
      fillColor: AIRPORT_COLOR,
      // A white halo keeps the code readable over the pale canvas and over
      // satellite imagery alike, without restyling per basemap.
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -15),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
  });
}

function showRoute(callsign, result) {
  // The selection moved on while this was in flight.
  if (!activeIcao || fleet.get(activeIcao)?.flight.callsign !== callsign) return;

  const el = els.dRoute;
  el.replaceChildren();

  if (result?.status === 'confirmed') {
    el.className = 'route';

    // Name first, code second: "Sabiha Gökçen" tells you more at a glance
    // than "LTFJ", but the code is what anyone would cross-check against, so
    // it stays on the card rather than being replaced.
    const ports = document.createElement('span');
    ports.className = 'ports';
    ports.textContent = `${portLabel(result.origin)} → ${portLabel(result.destination)}`;
    ports.title = `${portTitle(result.origin)} → ${portTitle(result.destination)}`;

    const codes = document.createElement('span');
    codes.className = 'codes';
    codes.textContent = `${result.origin.icao} → ${result.destination.icao}`;

    el.append(ports, codes);
  } else {
    el.className = 'route muted';
    el.textContent =
      result?.status === 'conflict'
        ? 'Rota doğrulanamadı — kaynaklar çelişiyor'
        : 'Rota bilgisi yok';
  }
  activeRoute = result;
  el.hidden = false;
  showDestination(result);
}

/**
 * A grounded aircraft has no route to show — it is between two of them, and
 * which one the callsign names changes through the turnaround. Where it is
 * standing is the fact we have, so the card shows that instead.
 */
function showGroundAirport(f) {
  routeRequest?.abort();
  activeRoute = null;
  clearDestination();

  const el = els.dRoute;
  el.replaceChildren();

  if (f.airport) {
    el.className = 'route';

    const ports = document.createElement('span');
    ports.className = 'ports';
    ports.textContent = portLabel(f.airport);
    ports.title = portTitle(f.airport);

    const codes = document.createElement('span');
    codes.className = 'codes';
    codes.textContent = [f.airport.icao, f.airport.iata].filter(Boolean).join(' · ');

    el.append(ports, codes);
  } else {
    // Between airports, or at a field too small to be in the table.
    el.className = 'route muted';
    el.textContent = 'Havalimanı belirlenemedi';
  }

  el.hidden = false;
}

function loadRoute(callsign) {
  routeRequest?.abort();
  activeRoute = null;
  els.dRoute.hidden = true;

  // The list has usually asked for this already, so selecting a flight fills
  // the card immediately rather than after a round trip.
  if (routeCache.has(callsign)) {
    showRoute(callsign, routeCache.get(callsign));
    return;
  }

  const controller = new AbortController();
  routeRequest = controller;
  fetchRoute(callsign, { signal: controller.signal })
    .then((result) => {
      routeCache.set(callsign, result);
      applyRouteToRows(callsign);
      showRoute(callsign, result);
    })
    .catch((err) => {
      if (err?.name !== 'AbortError') showRoute(callsign, null);
    });
}

function selectFlight(icao24, flyTo) {
  const f = flights.find((x) => x.icao24 === icao24);
  if (!f) return;
  const changed = activeIcao !== icao24;
  activeIcao = icao24;
  renderList();

  if (f.onGround) {
    // No network call behind this one, so it can be re-read every poll: a
    // taxiing aircraft does cross between airports' thresholds.
    showGroundAirport(f);
  } else if (changed) {
    // Only on a genuine change of selection: each poll re-runs selectFlight to
    // refresh the numbers, and refetching the route every 30s would be waste.
    loadRoute(f.callsign);
    returnBasemap();
  }

  els.dCallsign.textContent = f.callsign;
  // Registration and type both describe the airframe, so they share a line.
  els.dOrigin.textContent =
    [f.registration, f.model || f.type].filter(Boolean).join(' · ') || '—';
  els.dAlt.textContent = f.onGround
    ? 'Yerde'
    : Math.round(f.altitudeM * 3.281).toLocaleString('tr-TR') + ' ft';
  els.dSpeed.textContent = Math.round(f.speedMs * 1.944) + ' kt';
  els.dHeading.textContent = Math.round(f.heading) + '°';
  els.dPos.textContent = f.lat.toFixed(2) + ', ' + f.lon.toFixed(2);
  els.detail.classList.add('visible');

  if (flyTo && f.onGround) {
    // Close enough to read the stand, steep enough to see the layout, over
    // imagery that actually draws the apron.
    borrowSatellite();
    const p = project(icao24) || { lon: f.lon, lat: f.lat, alt: 0 };
    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0), 1),
      {
        offset: new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(f.heading - 150),
          Cesium.Math.toRadians(-55),
          900
        ),
        duration: 1.6,
      }
    );
  } else if (flyTo) {
    // Approach from the side rather than straight down: a top-down camera
    // projects the altitude leg to a single point, so height reads as zero.
    // flyToBoundingSphere frames the aircraft itself, so the range below is
    // the actual distance to it rather than a height above the ground.
    const p = project(icao24) || { lon: f.lon, lat: f.lat, alt: f.altitudeM };
    const target = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt);
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 1), {
      offset: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(f.heading - 150),
        Cesium.Math.toRadians(-22),
        70000
      ),
      duration: 1.4,
    });
  }
}

// Click-to-select on the globe itself.
const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
handler.setInputAction((movement) => {
  const picked = viewer.scene.pick(movement.position);
  if (Cesium.defined(picked) && picked.id && picked.id.id) {
    selectFlight(picked.id.id, false);
  }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// ---------- Deep link from the tracker ----------
// takip.html links here with ?ucus=<callsign> so "look at it on the globe"
// lands on that flight rather than on the fleet. The selection waits for the
// aircraft to appear in the feed: the link may be opened before the first
// poll answers, and it may be opened while the aircraft is still on a stand.
let pendingCallsign = parseFlightNumber(
  new URLSearchParams(location.search).get('ucus')
)?.callsign ?? null;

function applyDeepLink() {
  if (!pendingCallsign) return;

  const f = flights.find((x) => x.callsign.toUpperCase() === pendingCallsign);
  if (!f) return;
  pendingCallsign = null;

  // A parked aircraft lives in a layer no visit starts on, so selecting it
  // without switching would highlight a row nobody can see.
  setListMode(f.onGround ? 'ground' : 'air');
  selectFlight(f.icao24, true);
}

// ---------- Polling ----------
async function poll() {
  try {
    const data = await fetchFleet({ prefix: CALLSIGN_PREFIX });
    flights = data;
    updateEntities();
    renderList();
    applyDeepLink();
    if (activeIcao && visibleFlights().some((f) => f.icao24 === activeIcao)) {
      selectFlight(activeIcao, false);
    } else {
      dropSelectionIfHidden();
    }

    const grounded = flights.filter((f) => f.onGround).length;
    const airborne = flights.length - grounded;
    // The counts are of everything the feed reported, not of what the layer
    // switch happens to be showing: the pill is the state of the fleet.
    setStatus(
      'live',
      grounded
        ? `${airborne} havada · ${grounded} yerde`
        : `${airborne} uçuş · canlı`
    );
    els.updated.textContent = 'Son güncelleme: ' + fmtTime();
  } catch (err) {
    console.error('OpenSky fetch failed:', err);
    setStatus('error', 'Veri alınamadı');
    // Surfaced on screen because the status pill alone says nothing useful,
    // and on phones there are no devtools to read the console with.
    els.updated.textContent = 'Hata: ' + (err?.message || String(err));
  }
}

poll();
setInterval(poll, POLL_INTERVAL_MS);
