import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';
import { fetchFleet } from './opensky.js';

// No Cesium ion account required: we skip ion imagery/terrain entirely
// and use a free, token-less basemap + a flat ellipsoid terrain model.
Cesium.Ion.defaultAccessToken = undefined;

// `||` here is deliberate: a blank env var falls back to the default.
const CALLSIGN_PREFIX = import.meta.env.VITE_CALLSIGN_PREFIX?.trim() || 'PGT';
const POLL_INTERVAL_MS = Number(import.meta.env.VITE_POLL_INTERVAL_MS) || 25000;

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

// Light, clean CARTO "Positron" basemap — no API key needed.
viewer.imageryLayers.addImageryProvider(
  new Cesium.UrlTemplateImageryProvider({
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c', 'd'],
    credit: '© OpenStreetMap contributors © CARTO',
    maximumLevel: 19,
  })
);

viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#eef0f3');
viewer.scene.globe.enableLighting = false;
viewer.scene.globe.showGroundAtmosphere = false;
viewer.scene.skyAtmosphere.show = false;
viewer.scene.skyBox.show = false;
viewer.scene.sun.show = false;
viewer.scene.moon.show = false;
viewer.scene.fog.enabled = false;
viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#dfe3e8');
viewer.scene.screenSpaceCameraController.minimumZoomDistance = 200000;
viewer.scene.screenSpaceCameraController.maximumZoomDistance = 25000000;

viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(32, 38, 9000000),
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
const entities = new Map(); // icao24 -> Cesium.Entity
let flights = [];
let activeIcao = null;

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

function updateEntities() {
  const seen = new Set();

  flights.forEach((f) => {
    seen.add(f.icao24);
    const position = Cesium.Cartesian3.fromDegrees(f.lon, f.lat, f.altitudeM);

    let entity = entities.get(f.icao24);
    if (!entity) {
      entity = viewer.entities.add({
        id: f.icao24,
        position,
        billboard: {
          image: PLANE_ICON,
          width: 26,
          height: 26,
          rotation: 0,
          alignedAxis: Cesium.Cartesian3.UNIT_Z,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      entities.set(f.icao24, entity);
    } else {
      entity.position = position;
    }
    entity.billboard.rotation = Cesium.Math.toRadians(-f.heading);
  });

  // Remove aircraft that dropped out of the feed.
  for (const [icao, entity] of entities) {
    if (!seen.has(icao)) {
      viewer.entities.remove(entity);
      entities.delete(icao);
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
      origin.textContent = f.originCountry || '';
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
  els.dOrigin.textContent = f.originCountry || '—';
  els.dAlt.textContent = Math.round(f.altitudeM * 3.281).toLocaleString('tr-TR') + ' ft';
  els.dSpeed.textContent = Math.round(f.speedMs * 1.944) + ' kt';
  els.dHeading.textContent = Math.round(f.heading) + '°';
  els.dPos.textContent = f.lat.toFixed(2) + ', ' + f.lon.toFixed(2);
  els.detail.classList.add('visible');

  if (flyTo) {
    const entity = entities.get(icao24);
    if (entity) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(f.lon, f.lat, f.altitudeM + 800000),
        duration: 1.1,
      });
    }
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
