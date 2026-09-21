// Generates the home-screen icons for the tracker page.
//
// They exist because notifications on iOS only work once the page has been
// added to the home screen, and a web app without an icon does not get added.
// The shape is the same polygon the globe draws its aircraft with
// (buildPlaneIcon in src/main.js), so the two pages look like one product.
//
// Written by hand rather than with a library: this runs once per icon change
// and a build-time image dependency would outlive its usefulness by years.
//
//   node tools/make-icons.mjs
//
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

// The aircraft silhouette, in the 48px coordinate space of buildPlaneIcon.
const PLANE = [
  [0, -16], [5, -4], [18, 3], [18, 8], [5, 4], [4, 15], [9, 19], [9, 23],
  [0, 20], [-9, 23], [-9, 19], [-4, 15], [-5, 4], [-18, 8], [-18, 3], [-5, -4],
];

const BG = [0xff, 0x6a, 0x13];
const FG = [0xff, 0xff, 0xff];

function inside(x, y) {
  let hit = false;
  for (let i = 0, j = PLANE.length - 1; i < PLANE.length; j = i++) {
    const [xi, yi] = PLANE[i];
    const [xj, yj] = PLANE[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      hit = !hit;
    }
  }
  return hit;
}

// The silhouette is 36 units wide and 39 tall and it does not sit on the
// origin — the nose is at -16, the tail at +23. Mapping the icon to a window
// of SPAN units centred on the shape's own middle is what keeps the wingtips
// and the tail off the edges.
const SPAN = 54;
const SHAPE_CENTRE_Y = 3.5;

/** 4x4 supersampling: the wings are thin, and aliased wings read as dirt. */
function coverage(px, py, size) {
  const scale = SPAN / size;
  let hits = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const x = (px + (sx + 0.5) / 4 - size / 2) * scale;
      const y = (py + (sy + 0.5) / 4 - size / 2) * scale + SHAPE_CENTRE_Y;
      if (inside(x, y)) hits++;
    }
  }
  return hits / 16;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size) {
  // One filter byte (0 = none) per scanline, then RGB triples.
  const raw = Buffer.alloc(size * (1 + size * 3));
  let at = 0;
  for (let y = 0; y < size; y++) {
    raw[at++] = 0;
    for (let x = 0; x < size; x++) {
      const a = coverage(x, y, size);
      for (let c = 0; c < 3; c++) {
        raw[at++] = Math.round(BG[c] * (1 - a) + FG[c] * a);
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: truecolour, no alpha (iOS paints alpha black)

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [180, 512]) {
  const file = new URL(`../public/icon-${size}.png`, import.meta.url);
  writeFileSync(file, png(size));
  console.log('wrote', file.pathname);
}
