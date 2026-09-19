import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';
import { fetchFleet } from './flights.js';

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

// Esri's "Light Gray Canvas" — a clean, low-contrast basemap that needs no
// API key. (CARTO's key-less tiles were used here first, but they now come
// back stamped with an "API KEY REQUIRED" watermark.)
//
// Esri splits this style in two: the base has no place names, the reference
// layer carries the labels. Note the {z}/{y}/{x} order — Esri addresses tiles
// by row then column, not the usual x/y.
const ESRI_CANVAS = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas';
const ESRI_CREDIT = 'Esri, HERE, Garmin, © OpenStreetMap contributors';

for (const layer of ['World_Light_Gray_Base', 'World_Light_Gray_Reference']) {
  viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: `${ESRI_CANVAS}/${layer}/MapServer/tile/{z}/{y}/{x}`,
      credit: ESRI_CREDIT,
      maximumLevel: 16,
    })
  );
}

viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#eef0f3');
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
viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#dfe3e8');
// 200km was the old floor, which put the camera so far out that 11km of
// altitude was ~4% of the frame — height could never read. Letting the camera
// in to 20km is what makes the altitude legs legible.
viewer.scene.screenSpaceCameraController.minimumZoomDistance = 20000;
viewer.scene.screenSpaceCameraController.maximumZoomDistance = 25000000;

viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(28, 36, 5000000),
});

// ---------- Aircraft icon ----------
function buildPlaneIcon() {
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.translate(size / 2, size / 2);
  ctx.fillStyle = '#ff6a13';
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
  return canvas.toDataURL('image/png');
}
const PLANE_ICON = buildPlaneIcon();

// ---------- State ----------
const entities = new Map(); // icao24 -> { plane, leg, shadow }
const fleet = new Map();    // icao24 -> { flight, receivedAt }
let flights = [];
let activeIcao = null;

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
  if (!rec) return undefined;

  const points = rec.history.map((h) =>
    Cesium.Cartesian3.fromDegrees(h.lon, h.lat, h.alt)
  );
  const head = airPosition(icao24);
  if (head) points.push(head);

  return points.length >= 2 ? points : undefined;
}

function coursePositions(icao24) {
  const rec = icao24 && fleet.get(icao24);
  if (!rec) return undefined;

  const f = rec.flight;
  if (f.speedMs < COURSE_MIN_SPEED_MS) return undefined;

  const from = project(icao24);
  if (!from) return undefined;

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
};

els.closeDetail.addEventListener('click', () => {
  activeIcao = null;
  els.detail.classList.remove('visible');
  renderList();
});

function setStatus(state, text) {
  els.statusDot.className = 'status-dot' + (state ? ' ' + state : '');
  els.statusText.textContent = text;
}

function fmtTime(d = new Date()) {
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const ACCENT = Cesium.Color.fromCssColorString('#ff6a13');

function createEntities(icao24) {
  // Positions are callbacks rather than fixed values so every frame re-reads
  // the dead-reckoned estimate and the aircraft glides instead of stepping.
  const plane = viewer.entities.add({
    id: icao24,
    position: new Cesium.CallbackProperty(() => airPosition(icao24), false),
    billboard: {
      image: PLANE_ICON,
      width: 26,
      height: 26,
      rotation: 0,
      alignedAxis: Cesium.Cartesian3.UNIT_Z,
      // Nearer aircraft sit larger in frame, which is most of what sells
      // depth once the camera is tilted.
      scaleByDistance: new Cesium.NearFarScalar(3.0e5, 1.3, 1.2e7, 0.6),
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
      color: Cesium.Color.fromCssColorString('#8a8f98').withAlpha(0.55),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
  });

  return { plane, leg, shadow, trail };
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
    show: new Cesium.CallbackProperty(
      () => Boolean(activeIcao && fleet.has(activeIcao)),
      false
    ),
  },
});

function updateEntities() {
  const seen = new Set();

  const now = Date.now();

  flights.forEach((f) => {
    seen.add(f.icao24);

    const previous = fleet.get(f.icao24);
    const history = previous ? previous.history : [];
    history.push({ lon: f.lon, lat: f.lat, alt: f.altitudeM, t: now });
    while (
      history.length > TRAIL_MAX_POINTS ||
      (history.length > 1 && now - history[0].t > TRAIL_MAX_AGE_MS)
    ) {
      history.shift();
    }
    fleet.set(f.icao24, { flight: f, receivedAt: now, history });

    let group = entities.get(f.icao24);
    if (!group) {
      group = createEntities(f.icao24);
      entities.set(f.icao24, group);
    }
    group.plane.billboard.rotation = Cesium.Math.toRadians(-f.heading);
  });

  // Remove aircraft that dropped out of the feed.
  for (const [icao, group] of entities) {
    if (!seen.has(icao)) {
      viewer.entities.remove(group.plane);
      viewer.entities.remove(group.leg);
      viewer.entities.remove(group.shadow);
      viewer.entities.remove(group.trail);
      entities.delete(icao);
      fleet.delete(icao);
    }
  }
}

function renderList() {
  els.count.textContent = flights.length;

  if (flights.length === 0) {
    els.list.replaceChildren(Object.assign(document.createElement('div'), {
      className: 'empty-state',
      textContent: `Şu anda havada ${CALLSIGN_PREFIX} çağrı işaretli uçuş görünmüyor, ya da veri henüz gelmedi.`,
    }));
    return;
  }

  els.list.replaceChildren();
  flights
    .slice()
    .sort((a, b) => a.callsign.localeCompare(b.callsign))
    .forEach((f) => {
      const row = document.createElement('div');
      row.className = 'flight-row' + (f.icao24 === activeIcao ? ' active' : '');

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
      origin.textContent = f.registration || '';
      info.append(cs, origin);

      const metrics = document.createElement('div');
      metrics.className = 'metrics';
      metrics.append(
        'FL' + Math.round((f.altitudeM * 3.281) / 100),
        document.createElement('br'),
        Math.round(f.speedMs * 1.944) + ' kt'
      );

      row.append(dot, info, metrics);
      row.addEventListener('click', () => selectFlight(f.icao24, true));
      els.list.appendChild(row);
    });
}

function selectFlight(icao24, flyTo) {
  const f = flights.find((x) => x.icao24 === icao24);
  if (!f) return;
  activeIcao = icao24;
  renderList();

  els.dCallsign.textContent = f.callsign;
  els.dOrigin.textContent = f.registration || '—';
  els.dAlt.textContent = Math.round(f.altitudeM * 3.281).toLocaleString('tr-TR') + ' ft';
  els.dSpeed.textContent = Math.round(f.speedMs * 1.944) + ' kt';
  els.dHeading.textContent = Math.round(f.heading) + '°';
  els.dPos.textContent = f.lat.toFixed(2) + ', ' + f.lon.toFixed(2);
  els.detail.classList.add('visible');

  if (flyTo) {
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

// ---------- Polling ----------
async function poll() {
  try {
    const data = await fetchFleet({ prefix: CALLSIGN_PREFIX });
    flights = data;
    updateEntities();
    renderList();
    if (activeIcao && flights.some((f) => f.icao24 === activeIcao)) {
      selectFlight(activeIcao, false);
    }
    setStatus('live', flights.length + ' uçuş · canlı');
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
